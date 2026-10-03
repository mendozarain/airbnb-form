// Renders the Signal outline icons and illustrations used by the guest emails to PNG.
// Emails cannot use inline SVG (Gmail strips it), so the images are served from the frontend
// (frontend/public/email) and referenced by absolute URL. Re-run after changing the set:
//   node scripts/generate-email-icons.mjs
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as lucide from "lucide-react";
import { chromium } from "playwright";

const out = path.resolve("frontend/public/email");
fs.mkdirSync(path.join(out, "icons"), { recursive: true });

const INK = "#111111";
const SUNKEN = "#f3f2ef";
const YELLOW = "#fccb0f";
const GREEN = "#1fb156";

// name -> [lucide export, disc colour, stroke colour]
const icons = {
  "map-pin": ["MapPin"],
  wifi: ["Wifi"],
  key: ["KeyRound"],
  ticket: ["Ticket"],
  "door-open": ["DoorOpen"],
  users: ["Users"],
  bed: ["BedDouble"],
  stove: ["Flame"],
  hood: ["Fan"],
  tv: ["Tv"],
  speaker: ["Speaker"],
  mic: ["Mic"],
  car: ["Car"],
  clock: ["Clock"],
  mailbox: ["Mailbox"],
  pool: ["Waves"],
  power: ["Power"],
  help: ["CircleHelp"],
  "badge-check": ["BadgeCheck", GREEN, "#ffffff"]
};

const disc = (name, [exp, fill = SUNKEN, stroke = INK]) => {
  const icon = renderToStaticMarkup(
    createElement(lucide[exp], { size: 52, strokeWidth: 1.75, color: stroke })
  );
  // The lucide <svg> is nested at (26,26) inside a 96px canvas with a filled disc behind it.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="48" fill="${fill}"/>${icon.replace("<svg", '<svg x="22" y="22"')}</svg>`;
};

// A hand-drawn line illustration: Building D, a lit door for Unit 714, a key and a location pin.
const hero = `<svg xmlns="http://www.w3.org/2000/svg" width="1072" height="340" viewBox="0 0 1072 340">
  <rect width="1072" height="340" rx="48" fill="${SUNKEN}"/>
  <g fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M60 296h952"/>
    <rect x="388" y="72" width="296" height="224" rx="12" fill="#ffffff"/>
    <path d="M388 112h296"/>
    ${[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => `<rect x="${416 + c * 62}" y="${136 + r * 52}" width="34" height="30" rx="6"/>`).join("")).join("")}
    <rect x="478" y="236" width="116" height="60" rx="8" fill="${YELLOW}"/>
    <path d="M536 236v60"/>
    <circle cx="522" cy="268" r="3" fill="${INK}"/><circle cx="550" cy="268" r="3" fill="${INK}"/>
    <path d="M388 72l30-26h236l30 26"/>
    <path d="M214 296V196a14 14 0 0 1 14-14h40a14 14 0 0 1 14 14v100" fill="#ffffff"/>
    <path d="M214 224h68M214 256h68"/>
    <path d="M790 296V212a14 14 0 0 1 14-14h58a14 14 0 0 1 14 14v84" fill="#ffffff"/>
    <path d="M790 244h86"/>
  </g>
  <g fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="880" cy="128" r="26" fill="${YELLOW}"/><circle cx="880" cy="128" r="7"/>
    <path d="M906 128h96M966 128v22M988 128v16"/>
    <path d="M930 70l5 12 12 5-12 5-5 12-5-12-12-5 12-5z"/>
    <path d="M118 120a22 22 0 1 1 44 0c0 20-22 40-22 40s-22-20-22-40z" fill="#ffffff"/>
    <circle cx="140" cy="120" r="8"/>
  </g>
  <text x="536" y="101" text-anchor="middle" font-family="Menlo,Consolas,monospace" font-size="24" fill="${INK}">D · 714</text>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const shot = async (svg, file, width, height) => {
  await page.setViewportSize({ width, height });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width, height } });
};
for (const [name, spec] of Object.entries(icons)) {
  await shot(disc(name, spec), path.join(out, "icons", `${name}.png`), 96, 96);
  // White-disc variant for use on sunken panels, where a sunken disc would disappear.
  const [exp, fill = SUNKEN, stroke] = spec;
  await shot(disc(name, [exp, fill === SUNKEN ? "#ffffff" : fill, stroke]), path.join(out, "icons", `${name}-on-sunken.png`), 96, 96);
}
await shot(hero, path.join(out, "hero.png"), 1072, 340);
await browser.close();
console.log(`Wrote ${Object.keys(icons).length} icons and hero.png to ${out}`);
