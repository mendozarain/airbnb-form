import { BadRequestException, Injectable } from "@nestjs/common";
import { chromium } from "playwright";
import { requiredEnv } from "../config/env.js";
import { StorageService } from "../storage/storage.service.js";

const STORAGE_KEY = "google/storage-state.json";
const HEALTH_KEY = "google/session-health.json";

type StorageState = {
  cookies: Array<Record<string, unknown>>;
  origins: Array<Record<string, unknown>>;
};

export type SessionHealth = {
  checkedAt: string;
  valid: boolean;
  message: string;
  currentUrl?: string;
};

@Injectable()
export class GoogleSessionService {
  constructor(private readonly storage: StorageService) {}

  async status() {
    const [stored, health] = await Promise.all([
      this.storage.head(STORAGE_KEY),
      this.storage.getJson<SessionHealth>(HEALTH_KEY)
    ]);
    const expired = Boolean(stored && health && !health.valid);

    return {
      connected: Boolean(stored) && !expired,
      hasStorageState: Boolean(stored),
      expired,
      connectedAt: stored?.metadata.savedAt,
      lastCheck: health
    };
  }

  loadStorageState() {
    return this.storage.getJson<StorageState>(STORAGE_KEY);
  }

  async saveUpload(value: unknown) {
    assertStorageState(value);
    const savedAt = new Date().toISOString();
    await this.saveStorageState(value, savedAt);
    await this.writeHealth({
      checkedAt: savedAt,
      valid: true,
      message: "Storage state uploaded. Run Check session to verify it."
    });
    return { connected: true, connectedAt: savedAt };
  }

  async check() {
    const storageState = await this.loadStorageState();
    if (!storageState) {
      const health: SessionHealth = {
        checkedAt: new Date().toISOString(),
        valid: false,
        message: "No Google storage state has been uploaded yet."
      };
      await this.writeHealth(health);
      return health;
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ storageState: storageState as any });
    const page = await context.newPage();
    try {
      await page.goto(requiredEnv("GOOGLE_FORM_URL"), { waitUntil: "domcontentloaded" });
      const currentUrl = page.url();
      const valid = !currentUrl.includes("accounts.google.com") && !currentUrl.includes("ServiceLogin");
      const health: SessionHealth = {
        checkedAt: new Date().toISOString(),
        valid,
        currentUrl,
        message: valid
          ? "Google session is valid for the PMO form."
          : "Google redirected to login. Upload a fresh local browser session."
      };

      if (valid) {
        await this.saveStorageState(
          await context.storageState({ indexedDB: true }),
          new Date().toISOString()
        );
      }
      await this.writeHealth(health);
      return health;
    } finally {
      await browser.close();
    }
  }

  private async saveStorageState(value: StorageState, savedAt: string) {
    await this.storage.put(STORAGE_KEY, JSON.stringify(value), {
      contentType: "application/json",
      metadata: { savedAt }
    });
  }

  private async writeHealth(health: SessionHealth) {
    await this.storage.put(HEALTH_KEY, JSON.stringify(health), {
      contentType: "application/json",
      metadata: { checkedAt: health.checkedAt, valid: String(health.valid) }
    });
  }
}

function assertStorageState(value: unknown): asserts value is StorageState {
  if (!value || typeof value !== "object")
    throw new BadRequestException("Upload valid Playwright storage-state JSON");
  const state = value as Partial<StorageState>;
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw new BadRequestException("This file is not Playwright storage-state JSON");
  }
}
