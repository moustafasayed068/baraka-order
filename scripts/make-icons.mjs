// Generates the app icons in public/icons from one SVG (run again if the brand mark changes).
// node scripts/make-icons.mjs
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const RED = "#D9161C", YELLOW = "#FFC72C";
// Brand mark: yellow "البركة" on poster red. `pad` keeps it inside the safe zone for maskable icons.
const svg = (size, pad) => Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="${RED}"/>
  <text x="50" y="${58 + pad * 0.1}" font-family="Arial, Tahoma, sans-serif" font-weight="700" font-size="${30 - pad * 0.5}"
        fill="${YELLOW}" text-anchor="middle" direction="rtl">البركة</text>
</svg>`);

mkdirSync("public/icons", { recursive: true });
const out = [
  ["icon-192.png", 192, 0],
  ["icon-512.png", 512, 0],
  ["maskable-512.png", 512, 12],
  ["apple-touch-icon.png", 180, 0],
];
for (const [name, size, pad] of out) await sharp(svg(size, pad)).png().toFile(`public/icons/${name}`);
await sharp(svg(48, 0)).png().toFile("src/app/icon.png");
console.log("icons written:", out.map((o) => o[0]).join(", "), "+ src/app/icon.png");
