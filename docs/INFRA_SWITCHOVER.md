# Infra switch-over: what to set when you buy each upgrade

Everything below is already in the code and **off**. With none of these variables set, the backend and the
apps behave exactly as today. Each upgrade is: set a few Render environment variables → save (Render
redeploys) → check → done. Rollback = remove the variables.

Where to look after every step:

- `https://<api>/api/health?infra=1` → `infra`: `instance`, `redis` (`off` / `ok` / `down`), `dbType`
  (`supabase` / `render` / `other`), `dbMs` (last DB ping), `media` (`db` / `s3`).
- Admin → `GET /api/admin/metrics/perf` → `infra`: the same plus a fresh measured `db.roundTripMs`,
  `mediaStorage`, `publicUrls`, `edgeCache`, `trustCloudflare`.

Suggested order: **1 → 2 → 3 → 4** (each one is independent; this order gives the biggest win first).

---

## 1. Render Standard + Postgres in Oregon

1. Backend → Settings → Instance type **Standard**. Set `KEEPALIVE=false` (paid instances never sleep).
2. Database move: follow **docs/DB_MIGRATION_RUNBOOK.md** (create Render Postgres in Oregon → copy →
   `verify_db_copy.js` PASS → `DATABASE_URL` = Internal URL).

| Variable | Value | Effect |
|---|---|---|
| `DATABASE_URL` | Render **Internal** Database URL | DB in the same region (no SSL needed on the private network) |
| `DB_SSL` | leave unset (`auto`) | `auto`: SSL for hosts with a dot, none for the Render internal host. `disable` / `require` / `verify` (+ `DB_SSL_CA`) to force |
| `DB_POOL_MAX` | e.g. `20` | per instance; instances × value must stay under the DB plan's connection limit |

Verify: `/api/health?infra=1` → `infra.dbType: "render"`, `infra.dbMs` a few ms. Rollback: runbook section 6.

## 2. Two instances + Redis

1. Create a Redis (Render Key Value in **Oregon**, or Redis Cloud for a pilot). Copy its URL (`redis://` or `rediss://`).
2. Set `REDIS_URL=<url>` and `REDIS_ENABLED=true`. Save, wait for the deploy.
3. Check `/api/health?infra=1` → `infra.redis: "ok"`; admin metrics → `redis.ready: true`. Watch for a day.
4. Backend → Settings → Scaling → **2** instances. Check the `X-Instance` response header alternates, and live
   order updates still reach the customer, the rider and the store apps.

Rollback: scale back to 1 (then optionally unset `REDIS_ENABLED`).

## 3. Own domain + Cloudflare (free plan)

Example domain `zenvy.in` → API `api.zenvy.in`, admin `admin.zenvy.in`.

**Before the next app store build** (the apps only move to hosts they were built to trust):
add the API host to `expo.extra.trustedApiHosts` in each app's `app.json`
(`customer-mobile`, `delivery-boy-app`, `restaurant-mobile`, `vendor-app`, `auto-driver-app`), e.g.
`["hostelbites-backend-jwmt.onrender.com", "api.zenvy.in"]` — or set `EXPO_PUBLIC_TRUSTED_API_HOSTS=api.zenvy.in`
for the build. A `*.zenvy.in` entry trusts every subdomain. Builds without it simply stay on the onrender
address, which keeps working.

Steps:

1. Cloudflare → Add site `zenvy.in` (Free) → change the nameservers at your registrar to Cloudflare's.
2. Render → `hostelbites-backend` → Settings → Custom Domains → add `api.zenvy.in`;
   `hostelbites-admin` → add `admin.zenvy.in`. Render shows a CNAME target for each.
3. Cloudflare → DNS: `CNAME api → hostelbites-backend-jwmt.onrender.com`, `CNAME admin → <admin>.onrender.com`,
   both **DNS only (grey cloud)** until Render shows the domains as verified with a certificate.
4. Cloudflare → SSL/TLS → **Full (strict)**. Then switch both records to **Proxied (orange cloud)**.
   Network → **WebSockets: On**. Security → keep **Bot Fight Mode off** for the API (it challenges the apps).
5. Backend environment:

| Variable | Value | Effect |
|---|---|---|
| `PUBLIC_API_URL` | `https://api.zenvy.in` | new media / avatar / signed links use it; legal pages get a canonical link; `GET /api/config/endpoints` (and `/api/config`) advertise it → apps move on their next launch (after verifying it) |
| `PUBLIC_SOCKET_URL` | (optional) | separate socket.io address; default = `PUBLIC_API_URL` |
| `PUBLIC_WEB_URL` | `https://admin.zenvy.in` | advertised to the apps and added to the CORS / socket allowed origins |
| `ALLOWED_ORIGINS` | (optional) `https://zenvy.in,...` | extra exact browser origins |
| `TRUST_CLOUDFLARE` | `1` (only once the orange cloud is on) | rate limits / logs use the real client IP (`CF-Connecting-IP`), accepted only from Cloudflare's own addresses |
| `TRUST_PROXY` | leave unset (1) | Express proxy hops |
| `EDGE_CACHE` | (optional) `1` | public catalogue reads get `public, max-age=0, s-maxage=15, stale-while-revalidate=60`; everything else under /api gets `private, no-store` (signed in) or `no-store` |
| `EDGE_CACHE_GROUPS` / `EDGE_CACHE_SMAXAGE` / `EDGE_CACHE_SWR` | defaults `catalog,campus,challenges,megaBasketFees,serviceability,vault` / `15` / `60` | what a CDN may share and for how long |

6. Admin service environment: `NEXT_PUBLIC_API_URL=https://api.zenvy.in` and `NEXT_PUBLIC_SOCKET_URL=https://api.zenvy.in`
   → Manual Deploy (these are read at build time).
7. Optional CDN caching: only after `EDGE_CACHE=1`, add a Cloudflare **Cache Rule**: hostname equals
   `api.zenvy.in` AND URI path is one of `/api/users/restaurants`, `/api/restaurants`, `/api/campus/campuses`,
   `/api/features/challenges/active` → *Eligible for cache*, Edge TTL *use cache-control header*.
   Never "Cache Everything" on all of `/api`. Store / menu edits can then take up to `EDGE_CACHE_SMAXAGE`
   seconds to show; keep it small.
8. Play Console (optional): privacy / account-deletion URLs → `https://api.zenvy.in/legal/privacy` and
   `/legal/delete-account` (the onrender links keep working too).
9. Razorpay (only if online payment is configured): Dashboard → Webhooks → change the URL to
   `https://api.zenvy.in/api/campus-events/webhooks/razorpay` (the old URL keeps working; the signature
   check does not depend on the host). Cloudflare must not cache or challenge `POST` to that path (it doesn't
   by default; keep Bot Fight Mode off).

Verify:
- `curl -I https://api.zenvy.in/livez` → 200 with a `cf-ray` header.
- `https://api.zenvy.in/api/config/endpoints` → `{"apiBaseUrl":"https://api.zenvy.in",...}`.
- Open an app twice (the switch applies from the second launch); it keeps working; admin metrics show traffic.

How the apps move (all five, `endpointOverride.ts`): a few seconds after start they ask
`/api/config/endpoints`; a new address is saved only if it is https, on the trusted list, answers `/livez`
and advertises itself. It is used from the next launch. If it later stops answering while the built-in
address works, the app forgets it by itself. Old stored links that contain `hostelbites-backend-jwmt.onrender.com`
keep working: Render keeps that hostname alive next to the custom domain.

WebSockets through Cloudflare: supported on the free plan; Cloudflare closes connections idle for 100 s —
socket.io pings every 25 s, so nothing to change. Request bodies are capped at 100 MB (ours: 10 MB).

Rollback: unset `PUBLIC_API_URL` → the apps drop the override at their next check (they can still reach
the onrender address). Problems with Cloudflare itself: set the DNS records back to grey cloud and unset
`TRUST_CLOUDFLARE` / `EDGE_CACHE`.

## 4. Cloudflare R2 for photos

1. Cloudflare → R2 → create bucket `zenvy-media-private` (location hint: Western North America). **Public access off.**
2. Optional (faster public photos through the CDN): bucket `zenvy-media-public` → Settings → Public access →
   connect custom domain `media.zenvy.in`. ID cards / driver documents never go to this bucket.
3. R2 → Manage API tokens → **Object Read & Write**, limited to those bucket(s). Copy the Access Key ID and Secret.
4. Backend environment — credentials first (nothing changes yet), then the switch:

| Variable | Value | Effect |
|---|---|---|
| `R2_ACCOUNT_ID` | your Cloudflare account id | endpoint `https://<id>.r2.cloudflarestorage.com` (or `R2_ENDPOINT` for any S3-compatible store) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | from step 3 | |
| `R2_BUCKET` | `zenvy-media-private` | every object (private bucket) |
| `R2_PUBLIC_BUCKET` + `R2_PUBLIC_URL` | `zenvy-media-public` + `https://media.zenvy.in` | (optional) public photos stored there and served by a 302 to the CDN; ignored unless the public bucket differs from `R2_BUCKET` |
| `MEDIA_STORAGE` | `s3` | **new** uploads go to R2 (an R2 failure falls back to the database for that upload) |
| `MEDIA_PRIVATE_DELIVERY` | (optional) `redirect` | private photos: default = streamed by the backend after the usual owner / admin / signed-link check; `redirect` = 302 to a presigned R2 link valid `MEDIA_PRESIGN_TTL_S` (default 300) seconds |
| `R2_KEY_PREFIX` / `R2_REGION` | defaults `campus-media` / `auto` | |

Photo URLs never change (`/api/campus/media/<id>`): the row stays, only its bytes move.

5. Verify: `/api/health?infra=1` → `infra.media: "s3"`; upload a photo in the app → it shows; the object appears in R2.
6. Move the old photos (from the `backend` folder, with the same env, e.g. Render Shell):
   ```bash
   node scripts/migrate_media_to_r2.js                                # dry run: counts only
   node scripts/migrate_media_to_r2.js --apply                        # upload + read back + SHA-256 check
   node scripts/migrate_media_to_r2.js --apply --purge-after-verify   # a few days later: empty DB bytes
   ```
   Resumable (progress file, already-uploaded objects are skipped). Bytes are only removed from the database
   for rows whose R2 copy was read back and matched, and only with `--purge-after-verify`. Afterwards a
   `VACUUM FULL "CampusMedia";` in a quiet minute gives the disk space back.

Rollback: `MEDIA_STORAGE=db` (new uploads go to the database again; photos already in R2 keep being served
while the R2 variables stay). Full rollback: `node scripts/migrate_media_to_r2.js --to-db --apply`, then
remove the R2 variables.

Free tier: 10 GB stored, 1 M writes and 10 M reads per month, no egress fees.
