import { launch } from "@cloudflare/playwright";
import type { Env } from "./env";

const STORAGE_KEY = "google/storage-state.json";
const HEALTH_KEY = "google/session-health.json";

type SessionHealth = {
  checkedAt: string;
  valid: boolean;
  message: string;
  currentUrl?: string;
};

export async function getGoogleSessionStatus(env: Env) {
  const storage = await env.ID_BUCKET.get(STORAGE_KEY);
  const health = await readSessionHealth(env);
  const expired = Boolean(storage && health && !health.valid);

  return {
    connected: Boolean(storage) && !expired,
    hasStorageState: Boolean(storage),
    expired,
    connectedAt: storage?.customMetadata?.savedAt,
    lastCheck: health,
    email: {
      configured: Boolean(env.GMAIL_SMTP_USER && env.GMAIL_SMTP_APP_PASSWORD),
      mode: "gmail_smtp",
      workerReady: false
    }
  };
}

export async function loadGoogleStorageState(env: Env) {
  const object = await env.ID_BUCKET.get(STORAGE_KEY);

  if (!object) {
    return null;
  }

  return object.json<any>();
}

export async function saveUploadedGoogleStorageState(env: Env, storageState: unknown) {
  assertStorageState(storageState);

  const savedAt = new Date().toISOString();
  await env.ID_BUCKET.put(STORAGE_KEY, JSON.stringify(storageState), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { savedAt }
  });

  await writeSessionHealth(env, {
    checkedAt: savedAt,
    valid: true,
    message: "Storage state uploaded. Run Check session to verify Google still accepts it."
  });

  return { connected: true, connectedAt: savedAt };
}

export async function checkGoogleSession(env: Env) {
  const storageState = await loadGoogleStorageState(env);

  if (!storageState) {
    const health = {
      checkedAt: new Date().toISOString(),
      valid: false,
      message: "No Google storage state has been uploaded yet."
    };
    await writeSessionHealth(env, health);
    return health;
  }

  const browser = await launch(env.BROWSER);
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();

  try {
    await page.goto(env.GOOGLE_FORM_URL, { waitUntil: "domcontentloaded" });
    const currentUrl = page.url();
    const valid = !isGoogleLoginUrl(currentUrl);
    const health: SessionHealth = {
      checkedAt: new Date().toISOString(),
      valid,
      currentUrl,
      message: valid
        ? "Google session is valid for the PMO form."
        : "Google redirected to login. Upload a fresh local browser session."
    };

    if (valid) {
      const updatedStorageState = await context.storageState({ indexedDB: true });
      await env.ID_BUCKET.put(STORAGE_KEY, JSON.stringify(updatedStorageState), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { savedAt: new Date().toISOString() }
      });
    }

    await writeSessionHealth(env, health);
    return health;
  } finally {
    await browser.close();
  }
}

function assertStorageState(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("Upload a valid Playwright storageState JSON file.");
  }

  const state = value as { cookies?: unknown; origins?: unknown };
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw new Error("This JSON does not look like a Playwright storageState file.");
  }
}

function isGoogleLoginUrl(url: string) {
  return url.includes("accounts.google.com") || url.includes("ServiceLogin");
}

async function readSessionHealth(env: Env): Promise<SessionHealth | null> {
  const object = await env.ID_BUCKET.get(HEALTH_KEY);

  if (!object) {
    return null;
  }

  return object.json<SessionHealth>();
}

async function writeSessionHealth(env: Env, health: SessionHealth) {
  await env.ID_BUCKET.put(HEALTH_KEY, JSON.stringify(health), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { checkedAt: health.checkedAt, valid: String(health.valid) }
  });
}
