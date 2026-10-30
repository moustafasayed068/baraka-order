// Breakpoint test: raise the arrival rate on ONE path until it degrades. Finds max sustainable req/s per path.
// STAGING ONLY.   TARGET=menu|orders|track|home  MAX_RATE=300  STEP_S=30  k6 run breakpoint.js
// Stops early when p95 > 2 s or more than 5% of requests fail.
import http from "k6/http";
import { check } from "k6";
import exec from "k6/execution";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:3000";
const SB = __ENV.SUPABASE_URL || "http://127.0.0.1:54321";
const ANON = __ENV.ANON_KEY;
const TARGET = __ENV.TARGET || "menu";
const MAX = Number(__ENV.MAX_RATE || 300);
const STEP = Number(__ENV.STEP_S || 30);
const RUN_ID = __ENV.RUN_ID || String(Date.now() % 100000);
const steps = [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1].map((f) => ({ duration: `${STEP}s`, target: Math.max(1, Math.round(MAX * f)) }));

export const options = {
  setupTimeout: "60s",
  summaryTrendStats: ["med", "p(95)", "p(99)", "max", "count"],
  scenarios: { bp: { executor: "ramping-arrival-rate", startRate: 1, timeUnit: "1s", preAllocatedVUs: 200, maxVUs: 3000, stages: steps } },
  thresholds: {
    http_req_duration: [{ threshold: "p(95)<2000", abortOnFail: true, delayAbortEval: "20s" }],
    http_req_failed: [{ threshold: "rate<0.05", abortOnFail: true, delayAbortEval: "20s" }],
  },
};

export function setup() {
  const h = { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } };
  const branches = http.get(`${SB}/rest/v1/branches?select=slug&order=sort`, h).json().map((b) => b.slug);
  const items = http.get(`${SB}/rest/v1/menu_items?select=id,item_options(id)&active=eq.true`, h).json();
  // tracking tokens to poll: place a few real orders first
  const tokens = [];
  if (TARGET === "track") for (let i = 0; i < 20; i++) tokens.push(order(branches[i % 10], items, i).json("token"));
  return { branches, items, tokens };
}

let seq = 0;
function order(branch, items, n) {
  const it = items[n % items.length];
  const phone = `012${String((exec.vu.idInTest * 1000003 + seq++ * 7919 + Number(RUN_ID) * 13) % 1e8).padStart(8, "0")}`;
  const ip = `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
  return http.post(`${BASE}/api/orders`, JSON.stringify({
    branch, idempotencyKey: crypto.randomUUID(), type: "pickup", name: `LT${RUN_ID} Customer`, phone, paymentMethod: "cash",
    pickupInMin: 0, lines: [{ itemId: it.id, optionId: it.item_options.length ? it.item_options[0].id : null, qty: 1 }], website: "", fillMs: 9000,
  }), { headers: { "Content-Type": "application/json", Origin: BASE, "X-Forwarded-For": ip }, tags: { name: "POST /api/orders" } });
}

export default function (d) {
  const n = exec.scenario.iterationInTest;
  let r;
  if (TARGET === "menu") r = http.get(`${BASE}/b/${d.branches[n % 10]}`, { tags: { name: "GET /b/[branch]" } });
  else if (TARGET === "home") r = http.get(`${BASE}/`, { tags: { name: "GET /" } });
  else if (TARGET === "track") r = http.get(`${BASE}/api/track/${d.tokens[n % d.tokens.length]}`, { tags: { name: "GET /api/track/[token]" } });
  else r = order(d.branches[n % 10], d.items, n);
  check(r, { ok: (x) => x.status === 200 || x.status === 201 });
}

export function handleSummary(data) {
  return { [`${__ENV.OUT_DIR || "."}/breakpoint-${TARGET}.json`]: JSON.stringify(data, null, 1) };
}
