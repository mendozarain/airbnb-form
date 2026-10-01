import { BadRequestException, Injectable } from "@nestjs/common";
import { chromium } from "playwright";
import { requiredEnv } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";
import { expectedGoogleAccount } from "./browser-use.client.js";

const LEGACY_STORAGE_KEY = "google/storage-state.json";
const SESSION_PREFIX = "google/sessions/";
const HEALTH_KEY = "google/session-health.json";
const ACTIVE_POINTER_KEY = "google_session_active";
const PENDING_POINTER_KEY = "google_session_pending";

export type StorageState = {
  cookies: Array<Record<string, unknown>>;
  origins: Array<Record<string, unknown>>;
};
type SessionPointer = {
  key: string;
  version: string;
  savedAt: string;
  source: "legacy" | "manual" | "automatic" | "runner_refresh";
  accountEmail?: string;
};

export type SessionSnapshot = {
  state: StorageState;
  pointer: SessionPointer;
  pointerUpdatedAt: Date | null;
};

export type SessionHealth = {
  checkedAt: string;
  valid: boolean;
  message: string;
  currentUrl?: string;
};

@Injectable()
export class GoogleSessionService {
  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService
  ) {}

  async status() {
    const [snapshot, pending, health] = await Promise.all([
      this.loadStorageStateWithVersion(),
      this.readPointer(PENDING_POINTER_KEY),
      this.storage.getJson<SessionHealth>(HEALTH_KEY)
    ]);
    const expired = Boolean(snapshot && health && !health.valid);

    return {
      connected: Boolean(snapshot) && !expired,
      hasStorageState: Boolean(snapshot || pending),
      pendingVerification: Boolean(pending),
      expired,
      connectedAt: snapshot?.pointer.savedAt,
      accountEmail: snapshot?.pointer.accountEmail,
      lastCheck: health
    };
  }

  async loadStorageState() {
    return (await this.loadStorageStateWithVersion())?.state ?? null;
  }

  async loadStorageStateWithVersion(): Promise<SessionSnapshot | null> {
    let record = await this.prisma.appSetting.findUnique({ where: { key: ACTIVE_POINTER_KEY } });
    let pointer = parsePointer(record?.value);
    if (!pointer) {
      const legacy = await this.storage.head(LEGACY_STORAGE_KEY);
      if (!legacy) return null;
      pointer = {
        key: LEGACY_STORAGE_KEY,
        version: `legacy-${legacy.metadata.savedAt ?? legacy.lastModified?.toISOString() ?? "unknown"}`,
        savedAt: legacy.metadata.savedAt ?? legacy.lastModified?.toISOString() ?? new Date().toISOString(),
        source: "legacy"
      };
      try {
        record = await this.prisma.appSetting.create({
          data: { key: ACTIVE_POINTER_KEY, value: pointer as never }
        });
      } catch {
        record = await this.prisma.appSetting.findUnique({ where: { key: ACTIVE_POINTER_KEY } });
        pointer = parsePointer(record?.value) ?? pointer;
      }
    }
    const state = await this.storage.getJson<StorageState>(pointer.key);
    return state ? { state, pointer, pointerUpdatedAt: record?.updatedAt ?? null } : null;
  }

  async saveUpload(value: unknown) {
    assertStorageState(value);
    const pointer = await this.storeVersion(value, "manual");
    await this.prisma.appSetting.upsert({
      where: { key: PENDING_POINTER_KEY },
      create: { key: PENDING_POINTER_KEY, value: pointer as never },
      update: { value: pointer as never }
    });
    return {
      connected: Boolean(await this.loadStorageStateWithVersion()),
      connectedAt: pointer.savedAt,
      pendingVerification: true
    };
  }

  async check() {
    const pendingRecord = await this.prisma.appSetting.findUnique({ where: { key: PENDING_POINTER_KEY } });
    const pending = parsePointer(pendingRecord?.value);
    const active = await this.loadStorageStateWithVersion();
    const pointer = pending ?? active?.pointer;
    const storageState = pointer ? await this.storage.getJson<StorageState>(pointer.key) : null;
    if (!storageState) {
      const health: SessionHealth = {
        checkedAt: new Date().toISOString(),
        valid: false,
        message: "No Google storage state has been uploaded yet."
      };
      await this.writeHealth(health);
      return health;
    }

    const result = await this.verifyStorageState(storageState);
    if (result.health.valid && result.refreshed) {
      if (pending && pendingRecord) {
        const verified = await this.storeVersion(result.refreshed, "manual", expectedGoogleAccount());
        const promoted = await this.promotePointer(verified, active, pendingRecord.updatedAt);
        if (!promoted) {
          return {
            checkedAt: new Date().toISOString(),
            valid: false,
            message: "The session changed during verification. Run Check session again."
          };
        }
      } else if (active) {
        await this.refreshActiveState(result.refreshed, active);
      }
    }
    if (!pending || result.health.valid) await this.writeHealth(result.health);
    return result.health;
  }

  async verifyStorageState(storageState: StorageState) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: storageState as never });
    const page = await context.newPage();
    try {
      await page.goto(requiredEnv("GOOGLE_FORM_URL"), {
        waitUntil: "domcontentloaded",
        timeout: 30_000
      });
      const currentUrl = page.url();
      const bodyText = await page
        .locator("body")
        .innerText({ timeout: 10_000 })
        .catch(() => "");
      const authenticated =
        !currentUrl.includes("accounts.google.com") && !currentUrl.includes("ServiceLogin");
      const expectedForm = isConfiguredGoogleForm(currentUrl);
      const correctAccount = bodyText.toLowerCase().includes(expectedGoogleAccount());
      const hasUploadControl =
        (await page.locator('input[type="file"]').count()) > 0 || /Add file|Attach Valid Id/i.test(bodyText);
      const valid = authenticated && expectedForm && correctAccount && hasUploadControl;
      const message = !authenticated
        ? "Google redirected to login. Automatic recovery or a fresh manual session is required."
        : !correctAccount
          ? `Google is not signed in as ${expectedGoogleAccount()}.`
          : !expectedForm || !hasUploadControl
            ? "The expected PMO form upload controls were not available."
            : `Google session is valid for the PMO form as ${expectedGoogleAccount()}.`;
      return {
        health: { checkedAt: new Date().toISOString(), valid, currentUrl, message },
        refreshed: valid ? ((await context.storageState({ indexedDB: true })) as StorageState) : undefined
      };
    } finally {
      await browser.close();
    }
  }

  async saveRecoveredState(value: StorageState, expected: SessionSnapshot | null) {
    assertStorageState(value);
    if (await this.readPointer(PENDING_POINTER_KEY)) return false;
    const pointer = await this.storeVersion(value, "automatic", expectedGoogleAccount());
    const promoted = await this.compareAndSwapActive(pointer, expected);
    if (!promoted) await this.storage.delete(pointer.key).catch(() => undefined);
    return promoted;
  }

  async refreshActiveState(value: StorageState, expected: SessionSnapshot) {
    const pointer = await this.storeVersion(value, "runner_refresh", expected.pointer.accountEmail);
    const promoted = await this.compareAndSwapActive(pointer, expected);
    if (!promoted) await this.storage.delete(pointer.key).catch(() => undefined);
    return promoted;
  }

  async markHealthy(message: string) {
    await this.writeHealth({ checkedAt: new Date().toISOString(), valid: true, message });
  }

  async markUnhealthy(message: string, currentUrl?: string) {
    await this.writeHealth({
      checkedAt: new Date().toISOString(),
      valid: false,
      message,
      currentUrl
    });
  }

  private async promotePointer(
    pointer: SessionPointer,
    active: SessionSnapshot | null,
    pendingUpdatedAt: Date
  ) {
    const promoted = await this.compareAndSwapActive(pointer, active);
    if (!promoted) {
      await this.storage.delete(pointer.key).catch(() => undefined);
      return false;
    }
    await this.prisma.appSetting.deleteMany({
      where: { key: PENDING_POINTER_KEY, updatedAt: pendingUpdatedAt }
    });
    return true;
  }

  private async compareAndSwapActive(pointer: SessionPointer, expected: SessionSnapshot | null) {
    if (expected?.pointerUpdatedAt) {
      const updated = await this.prisma.appSetting.updateMany({
        where: { key: ACTIVE_POINTER_KEY, updatedAt: expected.pointerUpdatedAt },
        data: { value: pointer as never }
      });
      return updated.count === 1;
    }
    try {
      await this.prisma.appSetting.create({
        data: { key: ACTIVE_POINTER_KEY, value: pointer as never }
      });
      return true;
    } catch {
      return false;
    }
  }

  private async storeVersion(value: StorageState, source: SessionPointer["source"], accountEmail?: string) {
    const savedAt = new Date().toISOString();
    const version = crypto.randomUUID();
    const key = `${SESSION_PREFIX}${savedAt.replace(/[:.]/g, "-")}-${version}.json`;
    await this.storage.put(key, JSON.stringify(value), {
      contentType: "application/json",
      metadata: { savedAt, version, source }
    });
    return {
      key,
      version,
      savedAt,
      source,
      ...(accountEmail ? { accountEmail } : {})
    } satisfies SessionPointer;
  }

  private async readPointer(key: string) {
    const setting = await this.prisma.appSetting.findUnique({ where: { key } });
    return parsePointer(setting?.value);
  }

  private async writeHealth(health: SessionHealth) {
    await this.storage.put(HEALTH_KEY, JSON.stringify(health), {
      contentType: "application/json",
      metadata: { checkedAt: health.checkedAt, valid: String(health.valid) }
    });
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

function parsePointer(value: unknown): SessionPointer | null {
  if (!value || typeof value !== "object") return null;
  const pointer = value as Partial<SessionPointer>;
  if (
    typeof pointer.key !== "string" ||
    typeof pointer.version !== "string" ||
    typeof pointer.savedAt !== "string" ||
    !["legacy", "manual", "automatic", "runner_refresh"].includes(pointer.source ?? "")
  ) {
    return null;
  }
  return pointer as SessionPointer;
}

function assertStorageState(value: unknown): asserts value is StorageState {
  if (!value || typeof value !== "object")
    throw new BadRequestException("Upload valid Playwright storage-state JSON");
  const state = value as Partial<StorageState>;
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw new BadRequestException("This file is not Playwright storage-state JSON");
  }
}
