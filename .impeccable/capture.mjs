import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const routes = [
  ["worklist", "/cases"],
  ["detail", "/cases/CX-0417"],
  ["outreach", "/cases/CX-0409/outreach"],
  ["closure", "/cases/CX-0452/closure"],
  ["programme", "/programme"],
  ["notfound", "/nope"],
];

const browser = await chromium.launch({ channel: "msedge" });
const review = "C:/Users/User/Projects/nexyra/.impeccable/review";
const shots = "C:/Users/User/Projects/nexyra/docs/shots";
mkdirSync(review, { recursive: true });
mkdirSync(shots, { recursive: true });

for (const [name, path] of routes) {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktop.goto("http://localhost:4173" + path, { waitUntil: "networkidle" });
  await desktop.evaluate(() => document.fonts.ready);
  await desktop.waitForTimeout(500);
  await desktop.screenshot({ path: `${review}/${name}-desktop.png`, animations: "disabled" });
  await desktop.screenshot({ path: `${shots}/${name}.png`, animations: "disabled" });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto("http://localhost:4173" + path, { waitUntil: "networkidle" });
  await mobile.evaluate(() => document.fonts.ready);
  await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: `${review}/${name}-mobile.png`, animations: "disabled", fullPage: true });

  console.log(name, "ok");
  await desktop.close();
  await mobile.close();
}

await browser.close();
