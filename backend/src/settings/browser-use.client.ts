import { Injectable } from "@nestjs/common";
import { chromium } from "playwright";
import { requiredEnv } from "../config/env.js";

const API_URL = "https://api.browser-use.com/api/v4";
const EXPECTED_GOOGLE_ACCOUNT = "mendozarhainne@gmail.com";
const MAX_RUNS = 2;
const INCIDENT_TIMEOUT_MS = 3 * 60_000;

type BrowserUseRun = {
  id: string;
  status?: string;
  sessionId?: string;
  error?: unknown;
  output?: unknown;
};

type BrowserUseBrowser = {
  id: string;
  cdpUrl?: string;
};

export type RecoveredBrowserState = {
  storageState: {
    cookies: Array<Record<string, unknown>>;
    origins: Array<Record<string, unknown>>;
  };
  accountEmail: string;
};

@Injectable()
export class BrowserUseClient {
  configured() {
    return browserUseEnvNames().every((name) => Boolean(process.env[name]?.trim()));
  }

  async recoverGoogleSession(heartbeat?: () => Promise<void>): Promise<RecoveredBrowserState> {
    if (!this.configured()) throw new Error("Browser Use recovery configuration is incomplete");

    const deadline = Date.now() + INCIDENT_TIMEOUT_MS;
    let lastError = "Browser Use did not complete the Google sign-in";

    for (let attempt = 1; attempt <= MAX_RUNS && Date.now() < deadline; attempt += 1) {
      try {
        return await this.runOnce(deadline, heartbeat);
      } catch (error) {
        lastError = sanitizeBrowserUseError(error);
      }
    }

    throw new Error(lastError);
  }

  private async runOnce(deadline: number, heartbeat?: () => Promise<void>) {
    const run = await this.request<BrowserUseRun>("/runs", {
      method: "POST",
      body: JSON.stringify(buildRecoveryRunRequest())
    });
    let browser: BrowserUseBrowser | undefined;
    let sessionId = run.sessionId;
    let terminal = false;

    try {
      let current = run;
      let nextHeartbeatAt = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (Date.now() >= nextHeartbeatAt) {
          await heartbeat?.();
          nextHeartbeatAt = Date.now() + 20_000;
        }
        if (isSuccessfulRun(current.status) || isFailedRun(current.status)) {
          terminal = true;
          const full = await this.request<BrowserUseRun>(`/runs/${encodeURIComponent(run.id)}`);
          current = { ...current, ...full };
          if (isFailedRun(current.status)) throw new Error(browserUseRunError(current));
          break;
        }
        await delay(2_000);
        current = await this.request<BrowserUseRun>(`/runs/${encodeURIComponent(run.id)}/status`);
      }

      if (!terminal) throw new Error("Browser Use recovery timed out after three minutes");
      sessionId = current.sessionId ?? sessionId;
      if (!sessionId) throw new Error("Browser Use completed without an agent session");

      browser = await this.findBrowser(sessionId);
      if (!browser?.cdpUrl) throw new Error("Browser Use completed without an active browser session");
      return await exportVerifiedState(browser.cdpUrl, expectedGoogleAccount());
    } finally {
      if (!terminal) {
        await this.request(`/runs/${encodeURIComponent(run.id)}/cancel`, { method: "POST" }).catch(
          () => undefined
        );
      }
      if (!browser && sessionId) {
        browser = await this.findBrowser(sessionId).catch(() => undefined);
      }
      if (browser) {
        await this.request(`/browsers/${encodeURIComponent(browser.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ action: "stop" })
        }).catch(() => undefined);
      }
    }
  }

  private async findBrowser(sessionId: string) {
    const response = await this.request<{ items?: BrowserUseBrowser[] }>(
      `/browsers?agentSessionId=${encodeURIComponent(sessionId)}&filterBy=active&pageSize=10`
    );
    return response.items?.find((item) => item.cdpUrl) ?? response.items?.[0];
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "X-Browser-Use-API-Key": requiredEnv("BROWSER_USE_API_KEY"),
        ...init.headers
      },
      signal: AbortSignal.timeout(30_000)
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Browser Use API failed (${response.status}): ${safeApiMessage(body)}`);
    }
    return body as T;
  }
}

export function buildRecoveryRunRequest() {
  const integrationId = requiredEnv("BROWSER_USE_1PASSWORD_INTEGRATION_ID");
  const vaultId = requiredEnv("BROWSER_USE_1PASSWORD_VAULT_ID");
  const itemId = requiredEnv("BROWSER_USE_1PASSWORD_ITEM_ID");
  const source = (fieldId: string) => ({
    type: "onepassword",
    integrationId,
    vaultId,
    itemId,
    fieldId
  });

  return {
    task: [
      `Sign in to Google using only the 1Password item for ${expectedGoogleAccount()}.`,
      "Use the bound google_username and google_password secrets. If asked for an authenticator code, use google_one_time_password.",
      `After typing google_username, verify the field equals ${expectedGoogleAccount()} before clicking Next or entering a password. If it differs, stop immediately. Never print, report, or copy passwords or authenticator codes.`,
      "Do not use, select, or continue with any other Google account.",
      `Open ${requiredEnv("GOOGLE_FORM_URL")}. Confirm the signed-in account is ${expectedGoogleAccount()} and the form's file-upload control is available.`,
      "Do not attach a file, enter registration data, click Submit, or change account settings. Stop on the form."
    ].join(" "),
    model: "gpt-5.6-luna",
    maxCostUsd: 1,
    browserSettings: {
      profileId: requiredEnv("BROWSER_USE_PROFILE_ID"),
      proxyCountryCode: "au",
      record: false
    },
    secretBindings: [
      {
        alias: "google_username",
        source: source("username"),
        allowedDomains: ["accounts.google.com"]
      },
      {
        alias: "google_password",
        source: source("password"),
        allowedDomains: ["accounts.google.com"]
      },
      {
        alias: "google_one_time_password",
        source: source("one-time-password"),
        allowedDomains: ["accounts.google.com"]
      }
    ]
  };
}

async function exportVerifiedState(cdpUrl: string, accountEmail: string): Promise<RecoveredBrowserState> {
  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 20_000 });
  try {
    const context = browser.contexts()[0];
    if (!context) throw new Error("Browser Use browser did not expose a context");
    const pages = context.pages();
    const page = pages.find((candidate) => candidate.url().includes("docs.google.com/forms")) ?? pages[0];
    if (!page) throw new Error("Browser Use browser did not expose the PMO form");

    if (!page.url().includes("docs.google.com/forms")) {
      await page.goto(requiredEnv("GOOGLE_FORM_URL"), { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    const url = page.url();
    const bodyText = await page.locator("body").innerText({ timeout: 10_000 });
    const hasUploadControl =
      (await page.locator('input[type="file"]').count()) > 0 || /Add file|Attach Valid Id/i.test(bodyText);
    if (url.includes("accounts.google.com") || url.includes("ServiceLogin")) {
      throw new Error("Google still requires sign-in");
    }
    if (!isConfiguredGoogleForm(url) || !hasUploadControl) {
      throw new Error("Browser Use did not reach the expected PMO form upload page");
    }
    if (!bodyText.toLowerCase().includes(accountEmail.toLowerCase())) {
      throw new Error(`The PMO form was not authenticated as ${accountEmail}`);
    }
    return {
      storageState: await context.storageState({ indexedDB: true }),
      accountEmail
    };
  } finally {
    await browser.close();
  }
}

function isConfiguredGoogleForm(currentUrl: string) {
  try {
    const expected = new URL(requiredEnv("GOOGLE_FORM_URL"));
    const current = new URL(currentUrl);
    const expectedId = expected.pathname.match(/\/forms\/d\/e\/([^/]+)/)?.[1];
    return (
      current.hostname === "docs.google.com" &&
      Boolean(expectedId) &&
      current.pathname.includes(`/forms/d/e/${expectedId}/`)
    );
  } catch {
    return false;
  }
}

export function expectedGoogleAccount() {
  const configured = process.env.GOOGLE_ACCOUNT_EMAIL?.trim().toLowerCase();
  if (configured && configured !== EXPECTED_GOOGLE_ACCOUNT) {
    throw new Error(`GOOGLE_ACCOUNT_EMAIL must be ${EXPECTED_GOOGLE_ACCOUNT}`);
  }
  return EXPECTED_GOOGLE_ACCOUNT;
}

export function sanitizeBrowserUseError(error: unknown) {
  const raw = error instanceof Error ? error.message : "Browser Use recovery failed";
  return raw
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(token|password|secret|api[_ -]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
    .slice(0, 500);
}

function browserUseEnvNames() {
  return [
    "BROWSER_USE_API_KEY",
    "BROWSER_USE_1PASSWORD_INTEGRATION_ID",
    "BROWSER_USE_1PASSWORD_VAULT_ID",
    "BROWSER_USE_1PASSWORD_ITEM_ID",
    "BROWSER_USE_PROFILE_ID"
  ];
}

function safeApiMessage(value: unknown) {
  if (typeof value === "string") return sanitizeBrowserUseError(new Error(value));
  if (!value || typeof value !== "object") return "No error detail returned";
  const source = value as { message?: unknown; detail?: unknown; error?: unknown };
  const detail = source.message ?? source.detail ?? source.error;
  return sanitizeBrowserUseError(
    new Error(typeof detail === "string" ? detail : JSON.stringify(detail ?? value))
  );
}

function browserUseRunError(run: BrowserUseRun) {
  return `Browser Use run ${run.status ?? "failed"}: ${safeApiMessage(run.error ?? run.output)}`;
}

function isSuccessfulRun(status?: string) {
  return status === "completed" || status === "succeeded" || status === "success";
}

function isFailedRun(status?: string) {
  return ["failed", "cancelled", "canceled", "stopped", "timed_out"].includes(status ?? "");
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
