# El Baraka Order · البركة — اطلب واستلم

Online ordering, kitchen, pickup-screen, delivery and admin system for **El Baraka Fried Chicken**
(البركة فرايد تشيكن), a broasted-chicken chain in Egypt with 10 branches (7 Alexandria, 3 Cairo).

Customers order from their phone (QR at the door, Facebook or Linktree link, no account, no app install),
the kitchen sees the order instantly, the TV above the pickup window shows when it's ready, and riders
deliver with the address, a map link and the cash amount on their phone. Owner and branch managers run
everything from one admin panel. Arabic first (right-to-left), with an English toggle everywhere.

> Status: build steps 1–7 done and tested locally. Step 8 (online payment with Paymob, SMS codes,
> store apps) waits on the restaurant's merchant and SMS accounts. Cash on pickup / delivery works today.

---

## Contents

1. [What it does](#what-it-does)
2. [Screens and who uses them](#screens-and-who-uses-them)
3. [How an order flows](#how-an-order-flows)
4. [Security](#security)
5. [Tech stack](#tech-stack)
6. [Run it locally](#run-it-locally)
7. [Test accounts and PINs (local only)](#test-accounts-and-pins-local-only)
8. [Tests and checks](#tests-and-checks)
9. [Deploying to production](#deploying-to-production)
10. [Launch checklist](#launch-checklist)
11. [Project structure](#project-structure)
12. [Decisions and known limits](#decisions-and-known-limits)
13. [What's next](#whats-next)

---

## What it does

**For customers**
- Pickup or delivery from any of the 10 branches; menu with photos, sizes and sauce choices, sold-out items greyed out.
- Live kitchen load in the header ("6 orders in progress, about 15 min").
- Combo upsell (55 EGP) when a meal has no combo.
- Checkout with name and Egyptian mobile number (remembered on the phone); pickup ASAP / in 15 / in 30 min.
- Delivery: "use my location" finds the nearest branch that delivers that far; address form with saved
  Home / Work addresses; fixed delivery fee and minimum order per branch; rider name and call button when out.
- Live order tracking (private link) with orders ahead, estimated time, and sound + vibration when ready / out.
- Installable on the home screen; the menu still opens on a weak connection; offline screen shows hotline 16099.

**For the branch**
- Kitchen tablet: New → Preparing → Ready board, new-order alarm until acknowledged, overdue tickets turn amber/red,
  sold-out toggles, assign a rider, "not collected" after 30 min, call-to-confirm button for risky orders.
- Pickup TV: Preparing / Ready numbers (no names), chime and flash on new ready numbers, branch QR code.
- Rider phone: assigned orders with full address, call customer, open Google Maps, Picked up, Delivered
  (confirms cash), Problem (no answer / wrong address / refused), shift cash total.

**For the owner and managers (`/admin`)**
- Overview dashboard: orders, revenue, average prep and delivery time, best sellers, orders by hour, by branch.
- Orders: search by number or phone, by day and status; cancel with a reason; block a phone number.
- Phone orders: hotline staff type orders into the same system (same prices and checks as the website).
- Menu editor: names (ar/en), descriptions, prices, sizes/sauces, hide/show, photos (re-encoded, max 2 MB).
- Branches: hours, pause online orders or delivery, one-tap busy controls (+10 min), map location,
  delivery fee / minimum / range, kitchen PIN, paired devices (unpair remotely).
- Riders: add, edit, change PIN, deactivate; end-of-shift cash report with shortfalls flagged.
- Staff (owner): add managers, cashiers, call-centre staff with one-time passwords; see who has 2FA on.
- Printable QR stand cards per branch.

## Screens and who uses them

| Route | Who | Sign-in |
|---|---|---|
| `/`, `/b/[branch]` | Customers | none |
| `/t/[token]` | Customer tracking | the private link itself |
| `/kitchen` | Kitchen tablet | paired once with the branch PIN |
| `/screen` | TV above the pickup window | paired once with the branch PIN |
| `/rider` | Riders | phone + PIN (16-hour shift) |
| `/admin` | Owner, managers, cashiers, call centre | email + password; owner and managers also 2FA (authenticator app) |

Roles in the admin:

| Role | Sees |
|---|---|
| Owner | everything, all branches |
| Branch manager | overview, orders, phone orders, branch settings, riders, QR — own branch only |
| Cashier | orders (phones masked) and phone orders — own branch |
| Call centre | phone orders for any branch |

## How an order flows

```
Customer (phone)            Kitchen tablet              TV / Rider                 Customer tracking
────────────────            ──────────────              ──────────                 ─────────────────
places order  ───────────▶  New (alarm)                                            Received
                            Start ─────────────────────────────────────────────▶  Preparing
                            Ready ───────────▶  TV: number flashes (pickup)        Ready (sound + vibrate)
                                    or assign rider ─▶ Rider: Picked up ───────▶  On the way (rider name, call)
                            Collected                    Rider: Delivered ──────▶  Delivered
```

Order numbers restart at 101 every day per branch (business day flips at 06:00 Cairo time, so orders after
midnight count for the evening before). Everything updates live; screens fall back to refreshing every
10–15 seconds if the connection drops and show a red "offline" banner.

## Security

Built in from the start; every browser request is treated as untrusted.

- **Prices and totals are calculated on the server** from the database. Any price sent by a browser is ignored.
- **Database rules (Row Level Security) on every table**, deny by default. Customers can only read the public
  menu, branches and sold-out flags. Managers only see their own branch. Owner and managers only get their
  rights after 2FA — enforced inside the database, not just in the app.
- **Order checks** (one shared path for the website and the call centre): item exists and is active, option belongs
  to the item, quantity 1–20, max 30 lines, phone format, branch open and accepting that order type, not sold out,
  delivery within range, minimum order met, blocked phones refused.
- **Abuse limits**: 5 orders per phone per hour, 20 per network address per hour, 3 unfinished orders per phone,
  spam-trap field and a too-fast check on checkout. A double tap or retry never creates two orders.
- **Private tracking**: a random 32-character link per order; live updates are keyed by that link, never the order
  table. The TV shows numbers only; the kitchen shows first names only (and the phone only when it must call to
  confirm); full phone and address only for the assigned rider, the manager and the owner. Phone numbers are masked
  in cashier lists.
- **PINs and passwords**: kitchen/TV and rider PINs are hashed (bcrypt) and lock for 15 minutes after 5 wrong tries.
  Device and rider sessions can be revoked. Staff sessions end after 12 hours and live in HttpOnly cookies.
- **Web**: Content-Security-Policy with per-request nonces, HSTS, no framing, strict referrer and permissions
  policies (location only on customer pages), same-origin checks on every change.
- **Audit log** (insert-only): menu and price changes, branch and delivery settings, staff and rider changes,
  manual order changes, cancellations, blocked numbers, phone orders, cash handovers, staff logins.
- **Secrets**: the Supabase service key never reaches the browser; the build fails if a server secret appears in
  client code.
- **Photos**: JPG/PNG/WebP up to 2 MB, re-encoded on the server (strips hidden data, rejects fake images),
  owner-only upload.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router, Server Actions, Turbopack) + TypeScript + Tailwind CSS 4
- [Supabase](https://supabase.com): Postgres, Auth (with TOTP 2FA), Realtime (broadcast), Storage
- zod for validation, sharp for image re-encoding, qrcode for QR codes
- Vitest for unit and database-rule tests; puppeteer-core for the offline check
- Fonts: Lalezar (display) and IBM Plex Sans Arabic (text); brand red `#D9161C`, mustard `#FFC72C`, paper `#FFF7EC`

## Run it locally

Requirements: Node.js 20+, Docker Desktop (for the local Supabase).

```bash
npm install
npx supabase start          # first run downloads the Supabase images
npx supabase db reset       # creates the schema, rules and sample data (menu, 10 branches, test riders)
```

Create `.env.local` from `.env.example`. For local Supabase, `npx supabase status -o env` prints the keys:

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
```

```bash
npm run dev                 # http://localhost:3000, and http://<this PC's IP>:3000 for phones on the same Wi-Fi
```

Phones on the same Wi-Fi can open the site through the PC's address. If Windows Firewall blocks them, allow ports
3000 and 54321 for private networks. Location ("use my location") needs https, so test it at
`http://localhost:3000` on the PC or after deploying.

Create your own staff login:

```bash
node --env-file=.env.local scripts/create-staff.mjs you@example.com owner
node --env-file=.env.local scripts/create-staff.mjs manager@example.com manager mokattam "Branch manager"
```

The script prints a one-time password. Owners and managers set up 2FA (Google or Microsoft Authenticator) at first sign-in.

## Test accounts and PINs (local only)

The sample data (`supabase/seed.sql`) is for development only and must not be used in production:

- Kitchen / TV pairing PIN for every branch: `1234`
- Two test riders per branch: phone `0100000XX01` / `0100000XX02` (XX = branch number, e.g. Mokattam = 09), PIN `1234`
- Delivery settings are samples: fee 25 EGP, minimum 140 EGP, up to 7 km
- Branch map locations are approximate

Staff logins created with `create-staff.mjs` are written to `dev-accounts.local.txt` (git-ignored) when running against
a local database.

## Tests and checks

```bash
npm test               # unit tests: prices, opening hours after midnight, Cairo business day, distance, 2FA codes
npm run test:rls       # database rules: logs in as anonymous, manager (with and without 2FA) and owner (needs local Supabase)
npm run lint
npm run build          # also fails if a server secret leaks into browser code
```

Offline check in a real (headless) Chrome:

```bash
npm run build && npx next start -p 3100
node scripts/check-offline.mjs warm
# stop the server, then:
node scripts/check-offline.mjs offline
```

## Deploying to production

1. **Supabase**: create a project (paid plan recommended before full launch for daily backups / point-in-time recovery).
   Link and push the migrations: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
   Do **not** run `seed.sql` in production; enter the real menu, branches, PINs and riders in the admin instead.
   In the dashboard: enable TOTP MFA, set the session time-box to 12 hours, set the Site URL to your domain.
2. **Vercel**: import the repository and set the three environment variables above (production values; the service
   key is server-only — never prefix it with `NEXT_PUBLIC_`).
3. **Domain**: add the custom domain in Vercel (https is automatic).
4. **First owner**: run `scripts/create-staff.mjs` once against production (with production env values), sign in,
   set up 2FA, then add managers and staff from the admin.
5. Print QR stands from **Admin → Branch QR** after the real domain is live.

## Launch checklist

- [ ] All tests pass (`npm test`, `npm run test:rls`, build)
- [ ] Secrets set in Vercel only; none in the repository
- [ ] 2FA on for the owner and every manager (Admin → Staff shows who is missing it)
- [ ] Custom domain with https
- [ ] Real menu, photos, prices, branch hours, map locations, delivery fee / minimum / range entered and checked by the owner
- [ ] Real kitchen / TV PINs set per branch (the sample `1234` replaced)
- [ ] Kitchen tablet and TV paired, sound tested, staff trained; riders added with their own PINs
- [ ] QR stands printed for the pilot branch
- [ ] Privacy page (Arabic / English, Egypt Law 151 of 2020) — not built yet
- [ ] Error monitoring and backups on
- [ ] Rollback plan: managers know the one-tap "pause online orders" button

## Project structure

```
src/
  app/
    page.tsx, b/[branch]/        customer home and branch menu (Menu.tsx: cart, checkout, delivery)
    t/[token]/                   private order tracking
    kitchen/, screen/            kitchen board and pickup TV (paired devices)
    rider/                       rider sign-in and assigned orders
    admin/                       login, 2FA, and (panel)/ dashboard, orders, call, menu, branches, riders, staff, qr
    api/                         orders, tracking, devices, kitchen, screen, rider
    manifest.ts                  installable app
  lib/
    orders.ts                    the one order path (validation, prices, delivery, limits)
    pricing.ts, hours.ts, geo.ts pure logic with unit tests (logic.test.ts)
    db.ts, auth.ts               Supabase clients (public, service, staff session) and role guards
    i18n.ts                      every user-facing string in Arabic and English
  proxy.ts                       security headers, CSP nonce, staff session refresh
public/sw.js, offline.html       service worker and offline screen
supabase/migrations/             schema, rules (RLS), functions — the source of truth for the database
supabase/seed.sql                local sample data only
scripts/                         create-staff, make-icons, check-secrets, check-offline
tests/rls.test.ts                database-rule tests per role
```

## Decisions and known limits

- **Delivery uses one fixed fee per branch** (with minimum order and maximum distance) instead of named areas;
  the customer's location picks the nearest branch. More distance rings can be added per branch later.
- **Pickup and delivery use take-away prices**; dine-in prices aren't part of online ordering.
- **Payments**: cash only until Paymob is set up (step 8). The database already has payment status fields.
- **SMS**: first-time delivery customers get a "call to confirm" flag in the kitchen until SMS codes are added.
- Delivery time estimate is kitchen wait + a flat 25 minutes; prep estimate is a simple formula until there is real data.
- Kitchen device pairing uses the branch PIN alone; managers can unpair any device from the admin.
- Screen wake-lock (keeping tablets awake) only works over https, i.e. after deployment.

## What's next

- **Step 8 (phase 2)**: Paymob online payment (cards, wallets, InstaPay) with webhook-verified payments;
  SMS one-time codes for first delivery orders; Google Play / App Store apps (Capacitor) with push notifications.
- Privacy page, error monitoring (Sentry), "no orders during opening hours" alert, end-to-end tests (Playwright),
  80 mm kitchen receipt printing.
