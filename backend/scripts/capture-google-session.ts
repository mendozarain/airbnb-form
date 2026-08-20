import "dotenv/config";
import { execFile } from "node:child_process";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { constants } from "node:fs";
import { access, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, type BrowserContext } from "playwright";

const execFileAsync = promisify(execFile);
const output = resolve("google-storage-state.json");
const formUrl = process.env.GOOGLE_FORM_URL;
const chromeProfile = process.env.GOOGLE_CHROME_PROFILE ?? "Default";

type ChromeCookieRow = {
  domain: string;
  name: string;
  value: string;
  encryptedValue: string;
  path: string;
  expiresUtc: string;
  hasExpires: number;
  isSecure: number;
  isHttpOnly: number;
  sameSite: number;
};
type PlaywrightCookie = Parameters<BrowserContext["addCookies"]>[0][number];

if (!formUrl) throw new Error("GOOGLE_FORM_URL is required");
try {
  const parsedUrl = new URL(formUrl);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
} catch {
  throw new Error("GOOGLE_FORM_URL must be a plain http(s) URL without Markdown brackets");
}

if (process.platform !== "darwin") {
  throw new Error("Everyday Chrome profile capture is currently supported on macOS only");
}

async function ensureChromeIsClosed() {
  try {
    await execFileAsync("/usr/bin/pgrep", ["-x", "Google Chrome"]);
  } catch {
    return;
  }
  throw new Error("Fully quit Google Chrome with Cmd+Q before capturing the session");
}

function isGoogleDomain(value: string) {
  const domain = value.replace(/^\./, "").toLowerCase();
  return (
    domain === "google.com" ||
    domain.endsWith(".google.com") ||
    /^google\.com\.[a-z.]+$/.test(domain) ||
    domain.endsWith(".googleusercontent.com")
  );
}

function decryptCookie(row: ChromeCookieRow, key: Buffer) {
  if (row.value) return row.value;
  const encrypted = Buffer.from(row.encryptedValue, "hex");
  const version = encrypted.subarray(0, 3).toString("ascii");
  if (!version.startsWith("v1")) {
    throw new Error(`Unsupported Chrome cookie encryption version ${version}`);
  }
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  const decrypted = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
  const domainHash = createHash("sha256").update(row.domain).digest();
  return (decrypted.subarray(0, 32).equals(domainHash) ? decrypted.subarray(32) : decrypted).toString(
    "utf8"
  );
}

function toPlaywrightCookie(row: ChromeCookieRow, key: Buffer): PlaywrightCookie | null {
  const expires = row.hasExpires
    ? Number(BigInt(row.expiresUtc) / 1_000_000n - 11_644_473_600n)
    : -1;
  if (expires > 0 && expires <= Date.now() / 1000) return null;

  const sameSite = row.sameSite === 2 ? "Strict" : row.sameSite === 0 ? "None" : "Lax";
  return {
    name: row.name,
    value: decryptCookie(row, key),
    domain: row.domain,
    path: row.path,
    expires,
    httpOnly: Boolean(row.isHttpOnly),
    secure: Boolean(row.isSecure),
    sameSite
  };
}

await ensureChromeIsClosed();

const chromeRoot = join(homedir(), "Library", "Application Support", "Google", "Chrome");
const cookieDatabase = join(chromeRoot, chromeProfile, "Cookies");
await access(cookieDatabase, constants.R_OK).catch(() => {
  throw new Error(`Chrome profile ${chromeProfile} does not have a readable cookie database`);
});

const [{ stdout: safeStoragePassword }, { stdout: cookieJson }] = await Promise.all([
  execFileAsync(
    "/usr/bin/security",
    ["find-generic-password", "-w", "-s", "Chrome Safe Storage"],
    { encoding: "utf8", maxBuffer: 1024 * 1024 }
  ),
  execFileAsync(
    "/usr/bin/sqlite3",
    [
      "-json",
      cookieDatabase,
      `SELECT host_key AS domain,
              name,
              value,
              hex(encrypted_value) AS encryptedValue,
              path,
              CAST(expires_utc AS TEXT) AS expiresUtc,
              has_expires AS hasExpires,
              is_secure AS isSecure,
              is_httponly AS isHttpOnly,
              samesite AS sameSite
         FROM cookies
        WHERE host_key = '.google.com'
           OR host_key LIKE '%.google.com'
           OR host_key GLOB '.google.com.*'
           OR host_key LIKE '%.googleusercontent.com'`
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
  )
]);

const key = pbkdf2Sync(safeStoragePassword.trim(), "saltysalt", 1003, 16, "sha1");
const rows = JSON.parse(cookieJson || "[]") as ChromeCookieRow[];
const cookies: PlaywrightCookie[] = [];
for (const row of rows) {
  try {
    const cookie = toPlaywrightCookie(row, key);
    if (cookie) cookies.push(cookie);
  } catch {
    // Skip unrelated Google cookies using a newer encryption format.
  }
}

const authenticatedCookieNames = new Set([
  "SID",
  "SAPISID",
  "__Secure-1PSID",
  "OSID",
  "__Secure-OSID"
]);
if (!cookies.some((cookie) => authenticatedCookieNames.has(cookie.name))) {
  throw new Error(`Chrome profile ${chromeProfile} does not contain decryptable Google authentication`);
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  await context.addCookies(cookies);
  const page = await context.newPage();
  await page.goto(formUrl, { waitUntil: "domcontentloaded" });
  if (!page.url().startsWith("https://docs.google.com/forms/")) {
    throw new Error(
      `Chrome profile ${chromeProfile} is not signed in to the PMO form. Open it in that profile first.`
    );
  }

  const storageState = await context.storageState({ indexedDB: true });
  const googleOnlyState = {
    cookies: storageState.cookies.filter((cookie) => isGoogleDomain(cookie.domain)),
    origins: storageState.origins.filter((origin) => isGoogleDomain(new URL(origin.origin).hostname))
  };
  await writeFile(output, `${JSON.stringify(googleOnlyState, null, 2)}\n`, { mode: 0o600 });
  console.log(`Saved ${googleOnlyState.cookies.length} Google cookies to ${output}`);
} finally {
  await browser.close();
}
