import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDir = join(import.meta.dir, "..", ".local", "chrome-google-session");
const outputPath = join(import.meta.dir, "..", "google-storage-state.json");
const formUrl = "https://docs.google.com/forms/d/e/1FAIpQLSf6-1HjScV8dy7WUlzoE10gLDGKoZH_4Ad4-37V93Jkf-_p4w/viewform?usp=header";
const port = 9222;

if (!existsSync(chromePath)) {
  throw new Error("Google Chrome was not found at the default macOS path.");
}

await mkdir(profileDir, { recursive: true });

const chrome = spawn(chromePath, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  formUrl
], {
  detached: true,
  stdio: "ignore"
});

chrome.unref();

console.log("Chrome opened with a dedicated local profile.");
console.log("Sign in to Google and make sure the PMO form loads.");
console.log("Then come back here and press Enter.");

const rl = createInterface({ input, output });
await rl.question("");
rl.close();

const target = await findFormTarget();
const cookies = await getCookies(target.webSocketDebuggerUrl);

const storageState = {
  cookies: cookies.map(normalizeCookie),
  origins: []
};

await writeFile(outputPath, JSON.stringify(storageState, null, 2));

console.log(`Saved ${storageState.cookies.length} cookies to ${outputPath}`);
console.log("Upload google-storage-state.json in Admin > Settings, then click Check session.");

async function findFormTarget() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  const targets: any[] = await response.json();
  const target = targets.find((item) => String(item.url).includes("docs.google.com/forms")) ?? targets.find((item) => item.type === "page");

  if (!target?.webSocketDebuggerUrl) {
    throw new Error("Could not find the Chrome tab. Keep Chrome open and try again.");
  }

  return target;
}

async function getCookies(webSocketUrl: string) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to Chrome DevTools.")), { once: true });
  });

  const response: any = await sendCdp(socket, "Network.getAllCookies");
  socket.close();
  return response.cookies ?? [];
}

function sendCdp(socket: WebSocket, method: string) {
  const id = Math.floor(Math.random() * 1_000_000);

  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data));

      if (message.id !== id) {
        return;
      }

      socket.removeEventListener("message", onMessage);

      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
    };

    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id, method }));
  });
}

function normalizeCookie(cookie: any) {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires ?? -1,
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure),
    sameSite: normalizeSameSite(cookie.sameSite)
  };
}

function normalizeSameSite(value: string | undefined) {
  if (value === "Strict" || value === "Lax" || value === "None") {
    return value;
  }

  return "Lax";
}
