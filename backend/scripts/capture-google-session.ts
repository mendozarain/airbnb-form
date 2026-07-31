import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const profileDir = resolve(".local/google-profile");
const output = resolve("google-storage-state.json");
const formUrl = process.env.GOOGLE_FORM_URL;
if (!formUrl) throw new Error("GOOGLE_FORM_URL is required");

await mkdir(profileDir, { recursive: true });
const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  channel: "chrome"
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(formUrl);

console.log("Sign in and make sure the PMO form loads, then close the browser window.");
await context.waitForEvent("close");

const browser = await chromium.launchPersistentContext(profileDir, { headless: true, channel: "chrome" });
await browser.storageState({ path: output, indexedDB: true });
await browser.close();
console.log(`Saved storage state to ${output}`);
