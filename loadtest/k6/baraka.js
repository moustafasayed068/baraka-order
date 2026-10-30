// Baraka Order load test: customers, kitchen tablets, TV screens, riders, staff dashboard and Realtime listeners.
// STAGING ONLY. Run through loadtest/run.sh, which refuses non-local targets unless explicitly allowed.
//
//   PEAK=100 BASE_URL=http://127.0.0.1:3000 SUPABASE_URL=http://127.0.0.1:54321 ANON_KEY=... k6 run baraka.js
//
// Env:
//   PEAK            peak concurrent customer sessions (default 100)
//   STAGE           seconds per ramp step (default 60); hold at peak = 3 × STAGE
//   ORDER_RATE      share of customer sessions that place an order (default 0.35)
//   RUN_ID          tag written into synthetic customer names so integrity checks find this run's orders
//   ADMIN_COOKIE    cookie header of a signed-in owner (aal2), from loadtest/scripts/staff-session.mjs (optional)
//   RT_SHARE        Realtime listeners as a share of PEAK (default 0.5; each joins its branch topic)
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";
import { WebSocket } from "k6/experimental/websockets";
import exec from "k6/execution";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:3000";
const SB = __ENV.SUPABASE_URL || "http://127.0.0.1:54321";
const ANON = __ENV.ANON_KEY;
const PEAK = Number(__ENV.PEAK || 100);
const STAGE = Number(__ENV.STAGE || 60);
const ORDER_RATE = Number(__ENV.ORDER_RATE || 0.35);
const RUN_ID = __ENV.RUN_ID || String(Date.now() % 100000);
const RT_SHARE = Number(__ENV.RT_SHARE || 0.5);
const BRANCHES = 10;

if (!ANON) throw new Error("ANON_KEY is required");

// ---------- metrics ----------
const ordersCreated = new Counter("orders_created");
const ordersRejected = new Counter("orders_rejected");
const ordersError = new Counter("orders_server_error");
const doubleTapMismatch = new Counter("double_tap_mismatch");
const kitchenMoves = new Counter("kitchen_moves");
const riderMoves = new Counter("rider_moves");
const rtLatency = new Trend("rt_broadcast_latency", true);
const rtMessages = new Counter("rt_messages");
const rtJoinOk = new Rate("rt_join_ok");
const boardSize = new Trend("kitchen_board_size");
const bizErrors = new Rate("business_errors");

// ---------- load shape: increase gradually ----------
const ramp = [
  { duration: `${STAGE}s`, target: Math.round(PEAK * 0.25) },
  { duration: `${STAGE}s`, target: Math.round(PEAK * 0.5) },
  { duration: `${STAGE}s`, target: PEAK },
  { duration: `${STAGE * 3}s`, target: PEAK },
  { duration: `${Math.round(STAGE / 2)}s`, target: 0 },
];
const total = ramp.reduce((s, r) => s + parseInt(r.duration), 0);

export const options = {
  setupTimeout: "120s",
  discardResponseBodies: false,
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max", "count"],
  scenarios: {
    customers: { executor: "ramping-vus", exec: "customer", startVUs: 0, stages: ramp, gracefulRampDown: "20s" },
    kitchen: { executor: "constant-vus", exec: "kitchen", vus: BRANCHES, duration: `${total}s` },
    screens: { executor: "constant-vus", exec: "screen", vus: BRANCHES, duration: `${total}s` },
    riders: { executor: "constant-vus", exec: "rider", vus: BRANCHES, duration: `${total}s` },
    staff: { executor: "constant-vus", exec: "staff", vus: 5, duration: `${total}s` },
    realtime: {
      executor: "ramping-vus", exec: "realtime", startVUs: 0, gracefulRampDown: "5s",
      stages: ramp.map((r) => ({ duration: r.duration, target: Math.max(1, Math.round(r.target * RT_SHARE)) })),
    },
  },
  thresholds: {
    // reporting only; the run never aborts so the full curve is recorded
    "http_req_failed{scenario:customers}": [{ threshold: "rate<0.01", abortOnFail: false }],
    "http_req_duration{name:POST /api/orders}": ["p(95)<1000"],
    "http_req_duration{name:GET /b/[branch]}": ["p(95)<2000"],
    "http_req_duration{name:GET /api/track/[token]}": ["p(95)<500"],
    rt_join_ok: ["rate>0.99"],
  },
};

// ---------- helpers ----------
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const jsonHeaders = (ip) => ({ "Content-Type": "application/json", Origin: BASE, "X-Forwarded-For": ip });
// synthetic client IP per VU+iteration: k6 runs from one machine, so without this the 20 orders/IP/hour limit
// would reject almost everything. The app trusts X-Forwarded-For off Vercel (audit F-16) — staging only.
const fakeIp = () => `10.${(exec.vu.idInTest >> 8) & 255}.${exec.vu.idInTest & 255}.${exec.vu.iterationInScenario % 250 + 1}`;
let phoneSeq = 0;
// unique synthetic phone per order (010 + 8 digits) so per-phone limits don't throttle the test
const fakePhone = () => `010${String((exec.vu.idInTest * 7919 + phoneSeq++ * 104729 + Number(RUN_ID) * 31) % 1e8).padStart(8, "0")}`;
const uuid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
});
const sbGet = (path) => http.get(`${SB}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }, tags: { name: "setup" } });
const cookieFrom = (res, name) => (res.cookies[name] && res.cookies[name][0] ? res.cookies[name][0].value : null);

// ---------- setup: read menu, pair devices, sign riders in ----------
export function setup() {
  const branches = sbGet("branches?select=id,slug,lat,lng,sort&order=sort").json();
  const items = sbGet("menu_items?select=id,slug,base_price,item_options(id)&active=eq.true").json();
  if (!branches.length || !items.length) throw new Error("no branches/menu: is the staging DB seeded?");
  const pair = (slug, kind) => {
    const r = http.post(`${BASE}/api/devices`, JSON.stringify({ branch: slug, pin: __ENV.BRANCH_PIN || "1234", kind }),
      { headers: jsonHeaders("10.255.0.1"), tags: { name: "setup" } });
    const c = cookieFrom(r, `bk_${kind}`);
    if (!c) throw new Error(`pairing ${kind} for ${slug} failed: ${r.status} ${r.body}`);
    return c;
  };
  const riderLogin = (b) => {
    const phone = `0100000${String(b.sort).padStart(2, "0")}01`;
    const r = http.post(`${BASE}/api/rider/session`, JSON.stringify({ phone, pin: __ENV.RIDER_PIN || "1234" }),
      { headers: jsonHeaders("10.255.0.2"), tags: { name: "setup" } });
    return cookieFrom(r, "bk_rider");
  };
  return {
    branches,
    items: items.map((i) => ({ id: i.id, slug: i.slug, price: i.base_price, options: i.item_options.map((o) => o.id) })),
    kitchen: branches.map((b) => pair(b.slug, "kitchen")),
    screen: branches.map((b) => pair(b.slug, "screen")),
    rider: branches.map(riderLogin),
    // one rider id per branch (sort order) for the kitchen's "assign" action; riders aren't readable with the anon key
    riderIds: (__ENV.RIDER_IDS || "").split(",").filter(Boolean),
  };
}

function cartLines(items, minTotal) {
  const n = Math.ceil(rnd(0, 3));
  const lines = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const it = pick(items);
    const qty = Math.ceil(rnd(0, 2));
    lines.push({ itemId: it.id, optionId: it.options.length ? pick(it.options) : null, qty });
    total += it.price * qty;
  }
  if (total < minTotal) { // delivery minimum: add a Baraka meal
    const meal = items.find((i) => i.slug === "baraka-meal") || items.reduce((a, b) => (a.price > b.price ? a : b));
    lines.push({ itemId: meal.id, optionId: meal.options.length ? meal.options[0] : null, qty: 1 });
  }
  return lines;
}

// ---------- customer session ----------
export function customer(data) {
  const b = pick(data.branches);
  const ip = fakeIp();
  group("browse", () => {
    const home = http.get(`${BASE}/`, { tags: { name: "GET /" } });
    check(home, { "home 200": (r) => r.status === 200 });
    sleep(rnd(1, 4));
    const menu = http.get(`${BASE}/b/${b.slug}`, { tags: { name: "GET /b/[branch]" } });
    check(menu, { "menu 200": (r) => r.status === 200 });
    sleep(rnd(5, 15)); // reading the menu, filling the cart
  });
  if (Math.random() > ORDER_RATE) return;

  const delivery = Math.random() < 0.25 && b.lat !== null;
  const body = {
    branch: b.slug, idempotencyKey: uuid(), type: delivery ? "delivery" : "pickup", name: `LT${RUN_ID} Customer`,
    phone: fakePhone(), paymentMethod: "cash", pickupInMin: delivery ? 0 : pick([0, 0, 15, 30]),
    lines: cartLines(data.items, delivery ? 140 : 0), website: "", fillMs: Math.round(rnd(8000, 60000)),
    ...(delivery ? { address: {
      street: "Synthetic load-test street", building: "1", floor: "2", apartment: "3", landmark: "",
      lat: b.lat + rnd(-0.02, 0.02), lng: b.lng + rnd(-0.02, 0.02),
    } } : {}),
  };
  const payload = JSON.stringify(body);
  const params = { headers: jsonHeaders(ip), tags: { name: "POST /api/orders" } };
  let res;
  if (Math.random() < 0.05) {
    // double tap: the same checkout sent twice at once must yield one order
    const [a, c] = http.batch([["POST", `${BASE}/api/orders`, payload, params], ["POST", `${BASE}/api/orders`, payload, params]]);
    if (a.status < 300 && c.status < 300 && a.json("token") !== c.json("token")) doubleTapMismatch.add(1);
    res = a.status < 300 ? a : c;
  } else {
    res = http.post(`${BASE}/api/orders`, payload, params);
  }
  if (res.status === 201 || res.status === 200) ordersCreated.add(1);
  else if (res.status >= 500 || res.status === 0) { ordersError.add(1, { status: String(res.status) }); bizErrors.add(1); return; }
  else { ordersRejected.add(1, { error: String(res.json("error") || res.status) }); bizErrors.add(res.status !== 429); return; }
  bizErrors.add(0);
  const token = res.json("token");

  http.get(`${BASE}/t/${token}`, { tags: { name: "GET /t/[token]" } });
  const polls = Math.ceil(rnd(2, 6)); // customer keeps the tracking page open
  for (let i = 0; i < polls; i++) {
    sleep(10);
    const t = http.get(`${BASE}/api/track/${token}`, { tags: { name: "GET /api/track/[token]" } });
    check(t, { "track 200": (r) => r.status === 200 });
  }
}

// ---------- kitchen tablet: refresh board and work orders forward ----------
const NEXT = { received: "start", preparing: "ready" };
export function kitchen(data) {
  const i = (exec.vu.idInTest - 1) % BRANCHES;
  const jar = { cookies: { bk_kitchen: data.kitchen[i] } };
  const res = http.get(`${BASE}/api/kitchen`, { ...jar, tags: { name: "GET /api/kitchen" } });
  if (!check(res, { "kitchen 200": (r) => r.status === 200 })) { sleep(3); return; }
  const orders = res.json();
  boardSize.add(orders.length);
  // work at most 6 tickets per refresh, oldest first, like a real line
  let moved = 0;
  for (const o of orders) {
    if (moved >= 6) break;
    let body = null;
    if (NEXT[o.status]) body = { orderId: o.id, action: NEXT[o.status] };
    else if (o.status === "ready" && o.type === "pickup") body = { orderId: o.id, action: "collected" };
    else if (o.status === "ready" && o.type === "delivery" && !o.rider_id && data.riderIds && data.riderIds[i]) body = { orderId: o.id, action: "assign", riderId: data.riderIds[i] };
    if (!body) continue;
    const r = http.post(`${BASE}/api/kitchen`, JSON.stringify(body), { ...jar, headers: jsonHeaders("10.255.1.1"), tags: { name: `POST /api/kitchen ${body.action}` } });
    if (r.status === 200) { kitchenMoves.add(1); moved++; }
  }
  sleep(3);
}

// ---------- TV screen ----------
export function screen(data) {
  const i = (exec.vu.idInTest - 1) % BRANCHES;
  const res = http.get(`${BASE}/api/screen`, { cookies: { bk_screen: data.screen[i] }, tags: { name: "GET /api/screen" } });
  check(res, { "screen 200": (r) => r.status === 200 });
  sleep(5);
}

// ---------- rider phone ----------
export function rider(data) {
  const i = (exec.vu.idInTest - 1) % BRANCHES;
  if (!data.rider[i]) { sleep(10); return; }
  const jar = { cookies: { bk_rider: data.rider[i] } };
  const res = http.get(`${BASE}/api/rider`, { ...jar, tags: { name: "GET /api/rider" } });
  if (res.status !== 200) { sleep(5); return; }
  for (const o of res.json("orders") || []) {
    const action = o.status === "ready" ? "picked_up" : o.status === "out_for_delivery" ? "delivered" : null;
    if (!action) continue;
    const r = http.post(`${BASE}/api/rider`, JSON.stringify({ orderId: o.id, action }), { ...jar, headers: jsonHeaders("10.255.2.1"), tags: { name: `POST /api/rider ${action}` } });
    if (r.status === 200) riderMoves.add(1);
  }
  sleep(5);
}

// ---------- staff: owner dashboard + orders list (real admin pages, signed-in owner session) ----------
export function staff() {
  const cookie = __ENV.ADMIN_COOKIE;
  if (!cookie) { sleep(30); return; }
  const h = { headers: { Cookie: cookie } };
  const week = Math.random() < 0.3;
  const d = http.get(`${BASE}/admin${week ? "?range=week" : ""}`, { ...h, redirects: 0, tags: { name: week ? "GET /admin?range=week" : "GET /admin (today)" } });
  check(d, { "dashboard 200": (r) => r.status === 200 });
  sleep(rnd(5, 10));
  const o = http.get(`${BASE}/admin/orders`, { ...h, redirects: 0, tags: { name: "GET /admin/orders" } });
  check(o, { "orders 200": (r) => r.status === 200 });
  sleep(rnd(10, 20));
}

// ---------- Realtime: an open tracking page listens to its branch topic ----------
export function realtime(data) {
  const b = data.branches[(exec.vu.idInTest - 1) % BRANCHES];
  const url = `${SB.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${ANON}&vsn=1.0.0`;
  const ws = new WebSocket(url);
  const topic = `realtime:branch:${b.id}`;
  let joined = false;
  ws.onopen = () => {
    ws.send(JSON.stringify({ topic, event: "phx_join", ref: "1", payload: { config: { broadcast: { self: false }, presence: { key: "" }, private: false }, access_token: ANON } }));
    ws.hb = setInterval(() => ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: "hb" })), 25000);
    setTimeout(() => { rtJoinOk.add(joined); clearInterval(ws.hb); ws.close(); }, rnd(45, 90) * 1000); // page stays open ~1 min
  };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.event === "phx_reply" && msg.ref === "1") joined = msg.payload && msg.payload.status === "ok";
    if (msg.event === "broadcast" && msg.payload && msg.payload.payload && msg.payload.payload.at) {
      rtMessages.add(1);
      rtLatency.add(Date.now() - Date.parse(msg.payload.payload.at));
    }
  };
  ws.onerror = () => { rtJoinOk.add(false); };
}

export function handleSummary(data) {
  const out = __ENV.OUT_DIR || ".";
  return { [`${out}/summary-${PEAK}.json`]: JSON.stringify(data, null, 1), stdout: textSummary(data) };
}

function textSummary(d) {
  const m = d.metrics;
  const line = (k) => {
    const v = m[k] && m[k].values;
    return v ? `${k}: ${JSON.stringify(v)}` : `${k}: n/a`;
  };
  return ["", `PEAK=${PEAK} RUN_ID=${RUN_ID}`, line("http_reqs"), line("http_req_failed"), line("http_req_duration"),
    line("orders_created"), line("orders_rejected"), line("orders_server_error"), line("double_tap_mismatch"),
    line("rt_broadcast_latency"), line("rt_messages"), line("rt_join_ok"), ""].join("\n");
}
