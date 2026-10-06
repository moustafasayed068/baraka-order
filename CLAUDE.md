@AGENTS.md

# El Baraka Order — project brief

Online ordering system for **El Baraka Fried Chicken** (البركة فرايد تشيكن), a broasted-chicken chain in Egypt with 10 branches (7 Alexandria, 3 Cairo). Goal: cut the double wait (queue to order + wait for food) and run delivery through one system instead of phone + paper.

Built by Mostafa as a product to sell to the restaurant. Pilot one branch first, but the system must support all branches from day one.

## Surfaces (one Next.js app, separate routes)

| Route | Who | Purpose |
|---|---|---|
| `/` and `/b/[branch]` | Customers | Menu, cart, checkout, order tracking (pickup + delivery). Mobile-first PWA. |
| `/kitchen` | Kitchen staff (tablet) | Live order board: New → Preparing → Ready → Collected / Out for delivery |
| `/screen` | TV above pickup window | Preparing / Ready order numbers, no interaction |
| `/rider` | Delivery riders (phone) | Assigned orders, call customer, open Google Maps, Picked up / Delivered / Problem |
| `/admin` | Owner + branch managers | Dashboard, menu editor, branches, delivery zones, riders, orders, cash reports, call-centre order entry |

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Supabase: Postgres, Auth, Realtime (live order updates), Storage (food photos)
- Hosting: Vercel
- Payments (phase 2): Paymob — card, mobile wallets, InstaPay. Launch with cash / pay-at-pickup only.
- SMS OTP (phase 2): for first-time **delivery** customers only.
- Later: wrap the PWA with Capacitor for Google Play / App Store, add push notifications.

## Language & look

- Arabic first, RTL by default; English toggle. All UI strings in an i18n dictionary (`ar`, `en`). Menu items store both names.
- Use logical CSS (start/end), never left/right.
- Brand: poster red `#D9161C`, mustard yellow `#FFC72C`, warm paper `#FFF7EC`, dark ink `#2A1210`. Display font Lalezar, body font IBM Plex Sans Arabic.
- Kitchen and pickup screens use a dark theme with large type.
- Reference demo (single-file prototype of the look and flow): https://claude.ai/artifact/4pUzUysAacwiWdVPKX4fVP

## Customer flow

1. Opens via QR (branch encoded in URL) or Facebook/Linktree link. No account, no app install.
2. Chooses **Pickup** or **Delivery**.
   - Pickup: branch from QR or a branch picker.
   - Delivery: GPS pin or pick area from list + street, building, floor, apartment, landmark. System finds the branch whose zone covers it; if none, offer pickup. Show zone delivery fee, minimum order, longer ETA. Saved addresses (Home/Work) on the device.
3. Top bar: branch, live kitchen load ("6 orders, ~15 min").
4. Menu tabs: Meals / Fatta & rice / Extras. Item sheet with size or sauce options + quantity. Sold-out items greyed out.
5. Cart: edit quantities, combo upsell (55 EGP) if a meal has no combo.
6. Checkout: name, mobile (Egyptian format `01[0125]xxxxxxxx`, remembered on device), pickup time (ASAP / +15 / +30), payment (pay at pickup / cash on delivery now; online later).
7. Tracking page with big order number, orders ahead, ETA, live status:
   - Pickup: Received → Preparing → Ready (vibrate + sound) → Collected
   - Delivery: Received → Preparing → Out for delivery (rider name + call) → Delivered
8. Edge cases: branch closed (show hours, allow scheduling for opening), item sold out mid-cart (block before submit), payment failure (retry or switch to cash), no-show after ~30 min (staff marks "not collected").

## Kitchen flow (`/kitchen`)

- Branch PIN login. New orders arrive with a sound.
- Columns: New / Preparing / Ready. Ticket shows number, name, Pickup/Delivery tag, area (delivery), items with options, paid or "collect cash", elapsed time (amber ≥ 8 min, red ≥ 12 min).
- Actions: Start → Ready → Collected (pickup) or Assign rider (delivery).
- Toggle items sold out for this branch.

## Pickup screen (`/screen`)

Two columns: Preparing / Ready ("Ready, please collect"). New ready numbers flash with a chime. Footer: "Order from your phone" + branch QR + hotline 16099. Pickup orders only.

## Rider flow (`/rider`)

Phone + PIN login, tied to a branch. List of assigned orders: customer, address, landmark, total, cash to collect. Buttons: Call, Open in Google Maps, Picked up (customer sees "Out for delivery"), Delivered (adds to shift cash total), Problem (no answer / wrong address / refused).

## Admin (`/admin`)

- Roles: owner (all branches), branch manager (one branch).
- Dashboard: orders, revenue, average prep time, average delivery time, best sellers, orders by hour, orders by area; today / this week; per branch.
- Menu: names (ar/en), descriptions, prices, options, photos, hide/show. Changes go live on all branches.
- Branches: hours, pause online orders, pause delivery only, print QR codes.
- Delivery zones per branch: area name, fee, minimum order.
- Riders: add/remove, assign to branch. End-of-shift cash report per rider.
- Orders: search by number or phone, history.
- Call-centre entry: staff type hotline orders into the same system so they reach the kitchen screen.

## Data model (starting point)

- `branches` (id, slug, name_ar, name_en, city, address, maps_url, hours, accepts_orders, accepts_delivery)
- `categories`, `menu_items` (name_ar/en, desc_ar/en, base_price, photo, active), `item_options` (sizes, sauces, with price)
- `branch_item_status` (branch_id, item_id, sold_out)
- `delivery_zones` (branch_id, name_ar/en, fee, min_order, optional polygon)
- `customers` (phone, name, verified_at), `addresses`
- `orders` (number per branch per day, branch_id, type pickup|delivery, status, customer, address snapshot, items snapshot, subtotal, delivery_fee, total, payment_method, payment_status, pickup_time, rider_id, timestamps for each status)
- `order_items`
- `staff` (role owner|manager|kitchen|cashier|callcentre, branch_id), `riders`
- Use Supabase Row Level Security. Customers create orders through a server route that recalculates prices server-side (never trust client prices).

## Seed data (from El Baraka's 2026 take-away menu)

Meals:
- ربع فرخة بروستد / Quarter Broasted Chicken: 140 — ورك بروستد + بطاطس + عيش + ثومية صغيرة + كاتشب
- وجبة ستربس / Strips Meal: 3 pcs 155, 5 pcs 215 — بطاطس + عيش + ثومية + كاتشب
- وجبة البركة / El Baraka Meal: 240 — نص فرخة بروستد + بطاطس + عيش + ثومية + كول سلو + كاتشب

Fatta & rice (sauce choice: باربكيو + ثومية / رانش / سويت تشيلي / تشيزي):
- فتة البركة / El Baraka Fatta: 165 — رز بسمتي + صوص + ستربس + كول سلو
- بسمتيو / Basmatio Bowl: 110
- كومبو / Combo: 55 — باكت بطاطس + مشروب

Extras: قطعة ستربس 40, أرز بسمتي 30, باكيت بطاطس 40, تشيزي فرايز 60, ثومية كبير 20, كول سلو 20, صوص باربيكيو 30, صوص شيدر 40, صوص رانش 30, صوص سويت تشيلي 30, عيش كيزر 5, مشروب 25, مياه 10.

Dine-in prices are slightly higher (quarter 150, strips 165/225, Baraka meal 255, fatta 175, basmatio 115). The system orders take-away/delivery only for now.

Branches — Alexandria: بحري (19 ش 26 يوليو، على البحر)، كامب شيزار، سموحة، الإذاعة (30 ش الإذاعة باكوس)، المحروسة (طريق الجيش)، سيدي بشر (ش العيسوي)، المندرة (طريق الجيش). Cairo: المهندسين (45 ش البطل أحمد عبدالعزيز)، المقطم (ش 9 امتداد ميدان النافورة)، مساكن الشيراتون (43 ش أنقرة).

Hours: take-away and delivery 9:00 AM–4:00 AM; dine-in Alexandria 10 AM–2 AM, Cairo 10 AM–4 AM. Hotline 16099.

Delivery zones, fees and minimum order: **not known yet**. Seed clearly marked sample zones per branch, editable in admin.

## Defaults

- No customer accounts; name + phone. OTP only for first delivery order (phase 2).
- Order-ready alerts in the open web page (sound + vibration). SMS/WhatsApp later.
- Cash only at launch; Paymob when the restaurant's merchant account is approved.
- Order numbers restart daily per branch, starting at 101.

## Build order

1. Project setup, Supabase schema + seed, RLS policies + role tests, security headers, i18n + RTL, brand theme.
2. Customer menu, cart, checkout (pickup), tracking page with realtime.
3. Kitchen board + pickup TV screen with realtime.
4. Delivery: zones, address entry, branch matching, delivery tracking.
5. Rider page.
6. Admin: auth/roles, menu editor, branches, zones, riders, orders, dashboard, cash report, call-centre entry.
7. PWA (installable, icons, offline menu shell), QR code generator.
8. Paymob + SMS OTP (phase 2), then Capacitor apps.

After each step: run it locally, test the full flow in the browser on phone width and desktop, then commit.

## Security (required, build it in from step 1)

Treat every request from the browser as untrusted. The customer site is public, so assume people will try fake orders, price tampering, reading other people's orders, and spamming.

### Secrets
- Supabase `service_role` key, Paymob secret/HMAC keys and SMS keys live only in server env vars. Never import them into client components, never prefix with `NEXT_PUBLIC_`.
- `.env.local` in `.gitignore`; ship `.env.example` with empty values. Add a check that fails the build if a server secret is referenced from client code.

### Authentication & roles
- Staff (owner, manager, cashier, callcentre) log in with Supabase Auth (email + password). Owner and managers must enable 2FA (TOTP).
- Roles and branch stored in a `staff` table, read in RLS via `auth.uid()`. Never trust a role sent from the client.
- Kitchen tablets and TV screens: a manager "pairs" the device once (enters a branch PIN while logged in), which issues a long-lived device token limited to that branch and that screen type. Device tokens can be revoked from admin.
- Riders: phone + PIN. PINs hashed (bcrypt/argon2), never stored plain. Lock after 5 wrong attempts for 15 min.
- Session expiry: staff 12 h, device tokens until revoked, rider per shift (16 h).

### Database (Supabase RLS)
- RLS enabled on **every** table, deny by default. Write a policy file and keep it in migrations.
- Customers (anonymous) can only read: active menu, branches, zones, sold-out flags. They cannot read `orders`, `customers` or `addresses` directly.
- Kitchen device: read/update orders of its own branch only, and only the status fields.
- Rider: read only orders assigned to them; update only status fields `picked_up_at`, `delivered_at`, `problem`.
- Manager: own branch only. Owner: everything.
- Price, total, payment status and rider assignment are never writable by customers.
- Add automated tests that log in as each role and confirm what it can and cannot read/write.

### Placing an order (server route only)
- `POST /api/orders` validates with zod: item ids exist and are active, options belong to the item, quantity 1–20, max 30 lines, phone format, name length, address fields length, branch open and accepting this order type, item not sold out at that branch, delivery address inside a zone of that branch, minimum order met.
- Server recalculates every price, the delivery fee and the total from the database. Ignore any price sent by the client.
- Idempotency key from the client (UUID per checkout) so a double tap or a retry never creates two orders.
- Order numbers come from a database function that locks per branch per day (Africa/Cairo date), so two orders at the same second never get the same number.

### Order tracking privacy
- Tracking link uses a random unguessable token (`/t/{32-char token}`), never the order number or id. The token is the only way a customer sees their order.
- Realtime for customers goes through that token (server-filtered channel or Supabase broadcast keyed by token), not direct table subscriptions.
- The TV screen shows numbers only. Kitchen shows first name only. Full phone and address are visible only to the assigned rider, the branch manager and the owner.
- Mask phone numbers in lists (`010•••••678`).

### Abuse & fake orders
- Rate limits (Upstash Redis or a Postgres table): order creation 5 per phone per hour and 20 per IP per hour; OTP sends 3 per phone per hour; login attempts as above.
- Max 3 active (unfinished) orders per phone.
- Delivery: first order from a phone needs SMS OTP (phase 2). Until OTP is live, first-time delivery orders show a "call to confirm" flag in the kitchen.
- Blocklist: managers can block a phone number after repeated no-shows or fake orders.
- Honeypot field + basic bot check on checkout. No CAPTCHA unless abuse appears.

### Payments (Paymob, phase 2)
- Create the Paymob payment from the server with the server-calculated total.
- Mark an order paid **only** from Paymob's webhook after verifying the HMAC signature, and check amount and currency match the order. Never from the browser redirect.
- Webhook is idempotent (same transaction processed once). Log every webhook.
- Unpaid online orders expire after 15 min and never reach the kitchen.
- No card data ever touches our servers (use Paymob's hosted page / iframe).

### Web security
- HTTPS only (Vercel). Security headers: Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy, Permissions-Policy (allow geolocation on customer pages only), frame-ancestors 'none'.
- Never use `dangerouslySetInnerHTML` with user or admin content.
- Image uploads (admin only): jpg/png/webp, max 2 MB, re-encoded server-side, stored in a Supabase bucket with public read and staff-only write.
- CSRF: server actions/route handlers check origin; auth cookies `HttpOnly`, `Secure`, `SameSite=Lax`.
- Keep dependencies updated; run `npm audit` before each release.

### Audit & money
- `audit_log` table: price changes, menu changes, order cancellations, refunds, manual status changes, rider cash handovers, staff logins. Who, what, before/after, when. Insert-only.
- Cancelling a paid order requires a manager.
- Rider shift cash report must equal the sum of their delivered cash orders; differences flagged.

### Data protection
- Collect only name, phone and delivery address. No email, no birthdays.
- Privacy page (Arabic/English) explaining what's stored and why, in line with Egypt's Personal Data Protection Law (Law 151 of 2020). Marketing SMS only with an explicit opt-in checkbox.
- Delete or anonymise customer addresses not used for 12 months.
- Daily backups (Supabase point-in-time recovery on the paid plan before full launch).

## Making it work in a real restaurant

- **Time zone:** all "today", hours, daily order numbers and reports in Africa/Cairo (Egypt observes summer time). Opening hours that cross midnight (9 AM–4 AM) belong to the previous business day.
- **Kitchen and TV reliability:** auto-reconnect realtime after Wi-Fi drops and show a red "offline" banner; poll every 15 s as a fallback; keep the screen awake (Wake Lock API); a "tap to enable sound" button on first open because browsers block sound until a tap; play new-order sound until someone acknowledges it.
- **Customer tracking:** works after closing and reopening the browser (token saved on device); if realtime drops, poll every 10 s.
- **Loading, empty and error states** on every screen, in both languages. Friendly 404 and 500 pages.
- **Branch busy controls:** manager can raise the estimated wait or pause online orders in one tap.
- **Receipt / kitchen printing** (optional, later): 80 mm thermal printer from the kitchen tablet.
- **Monitoring:** Sentry (or similar) for errors on client and server; an alert if no orders are received during opening hours at an active branch; Vercel/Supabase usage alerts.
- **Accessibility:** large tap targets (≥ 44 px), visible focus, good contrast, works with screen zoom.
- **Performance:** menu page under 2 s on a mid-range Android over 4G; images resized and lazy-loaded.

## Testing before each release

- Unit tests: price calculation, zone matching, opening hours (including after midnight), order numbering.
- RLS tests per role (see above).
- End-to-end (Playwright): pickup order → kitchen → ready → collected; delivery order → assign rider → delivered; sold-out item blocked; closed branch; double-tap checkout creates one order; tampered price is ignored; another customer's tracking token cannot be guessed or read.
- Manual check on a real Android phone and an iPhone, Arabic and English.

## Launch checklist

- [ ] All RLS and e2e tests pass
- [ ] Secrets set in Vercel, none in the repo
- [ ] 2FA on owner and manager accounts
- [ ] Custom domain with HTTPS
- [ ] Real menu, photos, branch hours and delivery zones entered and checked by the owner
- [ ] Kitchen tablet and TV paired, sound tested, staff trained
- [ ] QR stands printed for the pilot branch
- [ ] Privacy page live
- [ ] Error monitoring and backups on
- [ ] Rollback plan: staff can switch the branch to "online orders paused" instantly

## Conventions

- Prices are integers in EGP. Server computes all totals.
- Keep all user-facing text in the i18n files; Egyptian Arabic tone ("اطلب واستلم من غير طابور").
- Mobile-first: test at 375px wide.
- Don't commit secrets; use `.env.local` and provide `.env.example`.
