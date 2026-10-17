# Zenvy Campus Events & Booking

Covers event discovery, individual, slot and team registration, free and pay-at-venue events, QR tickets with gate check-in, club organizer publishing, and admin approval.

- **Students** reach it only through **Others → Campus Events** in the customer app.
- **Admins** manage it at `/campus-events` in the admin dashboard; the gate scanner is at `/campus-events/scan`.
- It stays **off** until an admin switches it on.

## Pieces

| Part | Where |
|---|---|
| Backend module | `backend/modules/campusEvents/` (all tables are `Ce*`; the older Pulse `CampusEvent` table is separate and untouched) |
| Student API | `/api/campus-events/*` |
| Organizer API | `/api/campus-events/organizer/*` |
| Check-in API | `/api/campus-events/check-in/*` (admins, the event's organizer, granted staff) |
| Admin API | `/api/admin/campus-events/*` (every write is audited) |
| Razorpay webhook | `POST /api/campus-events/webhooks/razorpay` (raw body, signature checked, repeats ignored; returns 503 until configured) |
| Lifecycle job | `campusEvents.lifecycle`, every 60 s |
| Customer screens | `customer-mobile/modules/campusEvents/`, `customer-mobile/app/campus-events/` |
| Admin page | `admin-dashboard/src/app/campus-events/` |

Tables and indexes are created on boot. No manual migration is needed.

## Settings

**Admin switches** (GlobalConfig, in admin → Campus Events → Settings):
- `CAMPUS_EVENTS_ENABLED`: off by default. The server refuses to switch it on without a ticket secret.
- `CAMPUS_EVENTS_WALLET_ENABLED`: off by default. Turn it on only after legal or RBI review.
- `CAMPUS_EVENTS_ONLINE_PAY_ENABLED`: off by default. Needs the Razorpay keys first.
- `CAMPUS_EVENTS_SETTINGS`: hold, payment and offer minutes; unpaid-reservation limit (3); cancellation and refund defaults; invite and join-link expiry; announcements per day; retention days (180); price and capacity caps.

**Environment variables:**
- `CAMPUS_EVENTS_TICKET_SECRET`: at least 16 random characters. **Required before switching on.** Changing it invalidates every issued QR code.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`: only needed later, for online payment.
- `CAMPUS_EVENTS_DEV_ENABLE=1`: local development only; ignored in production.

## Launch steps (pilot: free and pay-at-venue events)
1. Set `CAMPUS_EVENTS_TICKET_SECRET` on Render.
2. Admin → Organizers: grant organizers one at a time, or bulk-grant the managers of verified clubs.
3. Organizers create events in the app (Others → Campus Events → Organizer) and submit them. Admin → Review queue approves them.
4. Grant check-in staff per event (Admin → Check-in staff).
5. Admin → Settings: switch on `CAMPUS_EVENTS_ENABLED`. Students on the latest app build then see the chip.

**Later, for online payment:**
1. Create a Razorpay account and complete KYC.
2. Add the three Razorpay keys on Render.
3. Add the webhook URL `https://<api>/api/campus-events/webhooks/razorpay` with the events `payment.captured`, `payment.failed`, `order.paid` and `refund.processed`.
4. Switch on online pay.

## Guarantees
- **Capacity** is enforced under a per-event lock plus database unique indexes, so places can't be overbooked even when several requests arrive at once.
- **Holds, payment windows and waitlist offers** expire automatically, and freed places go to the waitlist in order.
- **Check-in** admits a ticket exactly once. Results are VALID, ALREADY_USED, CANCELLED, INVALID or NOT_YET_VALID.
- **QR codes** carry a signed, opaque token with no personal data.
- **Payments:** prices are always computed by the server. A payment counts only when the provider's signed webhook confirms it. No card data is stored.
- **Privacy:** organizers and staff never see phone numbers or emails. Team rosters are visible only to members.

## Tests

```
cd backend
npm run test:events
```

66 tests cover the owner's 25 acceptance scenarios, race tests (with and without the in-process lock), payments and webhooks, teams, check-in, lifecycle and follow-ups.

## Limits (v1)
- **Check-in** works online only. The app takes a typed code; the admin web scanner also uses the camera in Chrome or Edge.
- **Rate limits** are shared across instances only when Redis is enabled.
- **Venue-cash refunds** are marked by hand.
- **Categories** are a fixed list.
