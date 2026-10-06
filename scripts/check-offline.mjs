// Checks the installable app in a real (headless) Chrome with a throwaway profile.
// Browser "offline mode" doesn't cut off the service worker, so this test really stops the server instead:
//   1. npm run build && npx next start -p 3100
//   2. node scripts/check-offline.mjs warm      (visits the menu while the server is up)
//   3. stop the server
//   4. node scripts/check-offline.mjs offline   (the menu must still open; other pages show the offline screen)
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const phase = process.argv[2];
const base = process.argv[3] ?? "http://localhost:3100";
const chrome = process.env.CHROME_PATH ?? "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const profile = join(tmpdir(), "baraka-sw-check");
if (phase === "warm") rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: profile });
const ok = (label, pass, extra = "") => { console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && extra ? ` — ${extra}` : ""}`); if (!pass) process.exitCode = 1; };
const text = (page) => page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
try {
  const page = await browser.newPage();
  if (phase === "warm") {
    await page.goto(`${base}/b/mokattam`, { waitUntil: "networkidle0" });
    const active = await page.evaluate(async () => {
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10_000))]);
      return reg?.active?.state ?? "none";
    });
    ok(`service worker active (${active})`, active === "activated");
    await page.reload({ waitUntil: "networkidle0" }); // controlled by the worker now, so the menu gets saved
    ok("page controlled by the worker", await page.evaluate(() => !!navigator.serviceWorker.controller));
    ok("offline screen pre-saved", await page.evaluate(async () => !!(await caches.match("/offline.html"))));
    await page.goto(`${base}/t/00000000000000000000000000000000`, { waitUntil: "load" });
    ok("order tracking is never saved (private)", !(await page.evaluate(async () => !!(await caches.match(location.href)))));
  } else if (phase === "offline") {
    await page.goto(`${base}/b/mokattam`, { waitUntil: "load" }).catch(() => {});
    ok("branch menu opens with the server down", (await text(page)).includes("ربع فرخة بروستد"), (await text(page)).slice(0, 60));
    await page.goto(`${base}/b/smouha`, { waitUntil: "load" }).catch(() => {});
    ok("never-visited page shows the offline screen with the hotline", (await text(page)).includes("16099"), (await text(page)).slice(0, 60));
  } else {
    console.error("usage: check-offline.mjs warm|offline [base-url]");
    process.exitCode = 2;
  }
} finally {
  await browser.close();
}
