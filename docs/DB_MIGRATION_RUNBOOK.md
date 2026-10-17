# Database move: Supabase (Seoul) → Render Postgres (Oregon)

Why: the backend runs in Oregon and every query crosses the Pacific to Seoul (~150 ms per round trip).
A database in the same Render region answers in ~1–3 ms over Render's private network.

Nothing in the code has to change. The backend already:

- uses **no SSL** for the Render *internal* host (`dpg-xxxx-a`, no dot) and SSL for everything else (`DB_SSL=auto`, the default);
- shows the database kind and round trip in `GET /api/health?infra=1` → `infra.dbType` / `infra.dbMs`, and in
  `GET /api/admin/metrics/perf` → `infra.db` (`hostType`, `roundTripMs`, `pooler`, `ssl`).

Tools used below: `pg_dump`, `pg_restore`, `psql` (PostgreSQL client, same major version as the newer of
the two servers or newer) and `node backend/scripts/verify_db_copy.js` (read-only on both databases).

---

## 0. Before the day

1. Supabase dashboard → SQL editor: `select version();` → note the major version (e.g. 15 or 17).
2. Supabase → Database → size. Expect the dump to take about 1 minute per few hundred MB from a laptop.
3. Install the PostgreSQL client tools on your laptop (Windows: the PostgreSQL installer, tick only
   "Command Line Tools"). `pg_dump --version` must be ≥ the Supabase server's major version.
4. Pick a quiet window (e.g. 03:00–04:00 IST). The final copy needs the backend stopped for ~10–20 minutes.

## 1. Create the Render database (Oregon)

1. Render dashboard → **New → Postgres**.
2. Name `zenvy-db`, **Region: Oregon (US West)** — the same region as `hostelbites-backend`
   (backend → Settings → Region must say Oregon).
3. PostgreSQL version: the same major as Supabase, or newer.
4. Plan: a paid plan (backups / point-in-time recovery). Storage ≥ 2× the Supabase database size.
5. When it is "Available", open it and copy:
   - **Internal Database URL** `postgresql://USER:PASS@dpg-xxxx-a/DB` → for the backend (private network, no SSL).
   - **External Database URL** `postgresql://USER:PASS@dpg-xxxx-a.oregon-postgres.render.com/DB` → for your laptop (SSL).
6. Database → **Networking / Access control**: add your laptop's public IP so the external URL accepts you.

> If you ever sync `render.yaml` as a Blueprint: its `DATABASE_URL fromDatabase hostelbites-db` would
> overwrite the dashboard value. Today the dashboard value (Supabase) is used; keep it that way and change
> `DATABASE_URL` only in the dashboard (step 5).

## 2. Rehearsal (no downtime)

Do the whole copy once while the app is running, to learn the timings and see any restore errors.
Counts of busy tables will differ slightly because the app keeps writing — that is expected here.

```bash
# Supabase SESSION pooler (port 5432, not 6543): Supabase → Connect → Session pooler.
SRC="postgresql://postgres.<project-ref>:<password>@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require"
DST="postgresql://<user>:<password>@dpg-xxxx-a.oregon-postgres.render.com/<db>?sslmode=require"

pg_dump "$SRC" --schema=public --no-owner --no-acl --format=custom --file=zenvy_rehearsal.dump --verbose
pg_restore --dbname="$DST" --no-owner --no-acl --jobs=4 --verbose zenvy_rehearsal.dump
psql "$DST" -c "ANALYZE;"
cd backend && node scripts/verify_db_copy.js --source="$SRC" --target="$DST"
```

- The only acceptable `pg_restore` error is `schema "public" already exists`. Anything else: stop and fix.
- `verify_db_copy.js` prints one line per table (rows on each side, checksum of primary keys + `updatedAt`),
  then indexes and sequences. In a rehearsal a few busy tables may show FAIL (rows written meanwhile).

Then empty the target for the real copy: Render dashboard → the database → **Delete**, and create it again
(step 1) — or, keeping it, `psql "$DST" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`
(this only ever runs against the new Render database — double-check `$DST` before pressing Enter).

## 3. The real copy (maintenance window)

1. Render → `hostelbites-backend` → **Suspend** (guarantees no writes; the apps show "can't reach Zenvy"
   for the window). Background jobs stop with it.
2. Dump, restore, analyze (same commands, new file name):
   ```bash
   pg_dump "$SRC" --schema=public --no-owner --no-acl --format=custom --file=zenvy_final.dump --verbose
   pg_restore --dbname="$DST" --no-owner --no-acl --jobs=4 --verbose zenvy_final.dump
   psql "$DST" -c "ANALYZE;"
   ```
3. Verify — **must print `RESULT: PASS`**:
   ```bash
   cd backend && node scripts/verify_db_copy.js --source="$SRC" --target="$DST"
   ```
   The script never writes (read-only transactions + a statement guard). Exit code 0 = PASS.
   If it fails: do not continue. Resume the backend (still on Supabase), investigate, retry another day.
4. Keep `zenvy_final.dump` somewhere safe (it is the point-in-time copy of the old database).

## 4. Switch

1. Render → `hostelbites-backend` → Environment:
   - `DATABASE_URL` = the **Internal** Database URL (`...@dpg-xxxx-a/...`).
   - Leave `DB_SSL` unset (auto: no SSL on the internal host). Only if Render ever demands SSL internally:
     `DB_SSL=require`.
   - Keep `DB_POOL_MAX` within the plan's connection limit: (instances × `DB_POOL_MAX`) + ~10 for tools
     must stay under it (e.g. 2 instances × 20 = 40).
2. **Resume** the service (a deploy starts with the new variable).
3. Check:
   - `https://hostelbites-backend-jwmt.onrender.com/api/health?infra=1` → `"nexus":"connected"`, `infra.dbType: "render"`,
     `infra.dbMs` a few ms (was ~150+).
   - Admin → `GET /api/admin/metrics/perf` → `infra.db.hostType: "render"`, `roundTripMs` small.
   - Place a test order end to end; open the admin dashboard; check yesterday's orders are there.

## 5. Keep Supabase read-only for one week

Supabase → SQL editor:

```sql
ALTER DATABASE postgres SET default_transaction_read_only = on;
```

Nothing can write there by accident (a stale deploy, a script with the old URL). Do not delete or pause the
project for a week. After a calm week: download a last backup, then pause / delete the Supabase project.

## 6. Rollback

- **Within the first minutes (no real writes on Render yet):** set `DATABASE_URL` back to the Supabase URL,
  then in Supabase `ALTER DATABASE postgres SET default_transaction_read_only = off;`. Done.
- **After real traffic on Render** (orders written there): the Supabase copy is stale. Repeat sections 3–4
  in the other direction: suspend the backend, `ALTER DATABASE postgres SET default_transaction_read_only = off;`
  on Supabase, empty its `public` schema, dump Render (`pg_dump "$DST" ...`), restore into Supabase,
  `verify_db_copy.js --source="$DST" --target="$SRC"` → PASS, switch `DATABASE_URL` back, resume.

## Notes

- Uploaded photos live in the `CampusMedia` table (unless media was moved to R2, see INFRA_SWITCHOVER.md),
  so the dump can be large; moving media to R2 first makes this copy smaller and faster.
- `verify_db_copy.js` options: `--tables=A,B` (only these), `--skip=A,B`, `--json` (machine-readable).
  It also runs against two SQLite files (`sqlite:<path>`), which is how it is tested (`npm run test:infra`).
