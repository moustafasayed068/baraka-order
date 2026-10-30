// Turns one results folder (k6 CSV + monitor CSV + SQL outputs) into a Markdown report.
// Usage: node loadtest/scripts/report.mjs loadtest/results/<stamp> > report.md
import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { join } from "node:path";

const dir = process.argv[2];
const peaks = readdirSync(dir).map((f) => f.match(/^k6-(\d+)\.csv\.gz$/)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
const q = (arr, p) => { if (!arr.length) return NaN; const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const mx = (a) => a.reduce((m, x) => (x > m ? x : m), -Infinity);
const f0 = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en") : "–");
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(2) + "%" : "–");

async function readK6(file) {
  const rl = createInterface({ input: createReadStream(file).pipe(createGunzip()) });
  let cols;
  const ep = new Map(); // name -> {d:[], fail:0, n:0}
  const buckets = new Map(); // 30s -> {reqs, fail, d:[], vus}
  const biz = { created: 0, rejected: {}, server: 0, dbl: 0, rt: [], rtMsgs: 0, rtJoin: [0, 0], board: [] };
  let t0 = Infinity, t1 = 0;
  for await (const line of rl) {
    if (!cols) { cols = line.split(","); continue; }
    const c = line.split(",");
    const m = c[0], ts = Number(c[1]), v = Number(c[2]);
    const get = (k) => c[cols.indexOf(k)];
    if (m === "http_req_duration" || m === "http_req_failed") {
      const name = get("name");
      if (name === "setup") continue;
      t0 = Math.min(t0, ts); t1 = Math.max(t1, ts);
      const e = ep.get(name) ?? { d: [], fail: 0, n: 0 }; ep.set(name, e);
      const b = Math.floor(ts / 30) * 30, bk = buckets.get(b) ?? { reqs: 0, fail: 0, d: [], vus: 0 }; buckets.set(b, bk);
      if (m === "http_req_duration") { e.d.push(v); bk.d.push(v); bk.reqs++; }
      else { e.n++; if (v === 1) { e.fail++; bk.fail++; } }
    } else if (m === "vus") {
      const b = Math.floor(ts / 30) * 30, bk = buckets.get(b) ?? { reqs: 0, fail: 0, d: [], vus: 0 }; buckets.set(b, bk);
      bk.vus = Math.max(bk.vus, v);
    } else if (m === "orders_created") biz.created += v;
    else if (m === "orders_rejected") { const k = get("extra_tags")?.match(/error=([^&]+)/)?.[1] ?? "?"; biz.rejected[k] = (biz.rejected[k] ?? 0) + v; }
    else if (m === "orders_server_error") biz.server += v;
    else if (m === "double_tap_mismatch") biz.dbl += v;
    else if (m === "rt_broadcast_latency") biz.rt.push(v);
    else if (m === "rt_messages") biz.rtMsgs += v;
    else if (m === "rt_join_ok") biz.rtJoin[v ? 0 : 1]++;
    else if (m === "kitchen_board_size") biz.board.push(v);
  }
  return { ep, buckets, biz, secs: t1 - t0 };
}

function readMonitor(file) {
  if (!existsSync(file)) return null;
  const rows = readFileSync(file, "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
  const comp = new Map(); let maxConn = 0, maxActive = 0, maxLock = 0;
  const conns = new Map();
  for (const [ts, c, cpu, mem, extra] of rows) {
    if (c === "pg_conn") { const [, n] = extra.split("="); conns.set(ts, (conns.get(ts) ?? 0) + Number(n)); if (extra.startsWith("active=")) maxActive = Math.max(maxActive, Number(n)); continue; }
    if (c === "pg_lock_waits") { maxLock = Math.max(maxLock, Number(extra)); continue; }
    const e = comp.get(c) ?? { cpu: [], mem: [] }; comp.set(c, e);
    if (cpu) e.cpu.push(Number(cpu)); if (mem) e.mem.push(Number(mem));
  }
  for (const n of conns.values()) maxConn = Math.max(maxConn, n);
  return { comp, maxConn, maxActive, maxLock };
}

const out = [];
out.push(`# Baraka Order load test — ${dir}\n`);
for (const peak of peaks) {
  const { ep, buckets, biz, secs } = await readK6(join(dir, `k6-${peak}.csv.gz`));
  let total = 0, fails = 0; let all = [];
  for (const e of ep.values()) { total += e.d.length; fails += e.fail; all = all.concat(e.d); }
  out.push(`## PEAK = ${peak} concurrent customers\n`);
  out.push(`Requests ${f0(total)} in ${f0(secs)} s (avg ${(total / secs).toFixed(1)} req/s), failed ${pct(fails, total)}; overall p50 ${f0(q(all, .5))} ms, p95 ${f0(q(all, .95))} ms, p99 ${f0(q(all, .99))} ms.\n`);
  out.push(`Orders created ${biz.created}, server errors ${biz.server}, rejected ${JSON.stringify(biz.rejected)}, double-tap mismatches ${biz.dbl}.\n`);
  out.push(`Realtime: ${biz.rtMsgs} broadcasts received, join ok ${biz.rtJoin[0]}/${biz.rtJoin[0] + biz.rtJoin[1]}, latency p50 ${f0(q(biz.rt, .5))} ms, p95 ${f0(q(biz.rt, .95))} ms, p99 ${f0(q(biz.rt, .99))} ms, max ${f0(mx(biz.rt))} ms. Kitchen board size p50 ${f0(q(biz.board, .5))}, max ${f0(mx(biz.board))}.\n`);
  out.push(`| Endpoint | Requests | Failed | p50 ms | p95 ms | p99 ms | max ms |\n|---|---:|---:|---:|---:|---:|---:|`);
  for (const [name, e] of [...ep].sort((a, b) => b[1].d.length - a[1].d.length))
    out.push(`| ${name} | ${f0(e.d.length)} | ${pct(e.fail, e.n)} | ${f0(q(e.d, .5))} | ${f0(q(e.d, .95))} | ${f0(q(e.d, .99))} | ${f0(mx(e.d))} |`);
  out.push(`\n| t (30 s buckets) | VUs (all) | req/s | p95 ms | failed |\n|---|---:|---:|---:|---:|`);
  const ks = [...buckets.keys()].sort(); const start = ks[0];
  for (const k of ks) { const b = buckets.get(k); out.push(`| +${k - start}s | ${b.vus} | ${(b.reqs / 30).toFixed(1)} | ${f0(q(b.d, .95))} | ${pct(b.fail, b.reqs)} |`); }
  const mon = readMonitor(join(dir, `monitor-${peak}.csv`));
  if (mon) {
    out.push(`\nPostgres connections max ${mon.maxConn} (active max ${mon.maxActive}), lock waits max ${mon.maxLock}.\n`);
    out.push(`| Component | CPU avg % | CPU max % | Mem max MB |\n|---|---:|---:|---:|`);
    for (const [c, e] of mon.comp) out.push(`| ${c} | ${f0(e.cpu.reduce((s, x) => s + x, 0) / e.cpu.length)} | ${f0(mx(e.cpu))} | ${f0(mx(e.mem))} |`);
  }
  for (const f of [`integrity-${peak}.txt`, `top-queries-${peak}.txt`]) if (existsSync(join(dir, f))) out.push(`\n\`\`\`\n${readFileSync(join(dir, f), "utf8").trim()}\n\`\`\``);
  out.push("");
}
console.log(out.join("\n"));
