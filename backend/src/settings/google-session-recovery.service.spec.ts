import { describe, expect, it, jest } from "@jest/globals";
import { GoogleSessionRecoveryService } from "./google-session-recovery.service.js";

describe("GoogleSessionRecoveryService", () => {
  it("does not call Browser Use when the existing session verifies", async () => {
    const snapshot = {
      state: { cookies: [], origins: [] },
      pointer: {
        key: "google/sessions/current.json",
        version: "current",
        savedAt: "2026-09-10T00:00:00.000Z",
        source: "manual"
      },
      pointerUpdatedAt: new Date("2026-09-10T00:00:00.000Z")
    };
    const prisma = {
      appSetting: {
        findUnique: jest.fn<() => Promise<null>>().mockResolvedValue(null),
        upsert: jest.fn<() => Promise<object>>().mockResolvedValue({})
      }
    };
    const browserUse = {
      configured: jest.fn(() => true),
      recoverGoogleSession: jest.fn()
    };
    const google = {
      loadStorageStateWithVersion: jest.fn<() => Promise<typeof snapshot>>().mockResolvedValue(snapshot),
      verifyStorageState: jest
        .fn<
          () => Promise<{
            health: { valid: boolean; checkedAt: string; message: string };
            refreshed: typeof snapshot.state;
          }>
        >()
        .mockResolvedValue({
          health: { valid: true, checkedAt: "2026-09-10T00:01:00.000Z", message: "Valid" },
          refreshed: snapshot.state
        }),
      refreshActiveState: jest
        .fn<(state: unknown, current: unknown) => Promise<boolean>>()
        .mockResolvedValue(true)
    };
    const service = new GoogleSessionRecoveryService(
      prisma as never,
      browserUse as never,
      google as never,
      {} as never
    );

    await expect(service.recoverIfNeeded("Google redirected to login")).resolves.toMatchObject({
      recovered: true
    });
    expect(browserUse.recoverGoogleSession).not.toHaveBeenCalled();
    expect(google.refreshActiveState).toHaveBeenCalledWith(snapshot.state, snapshot);
  });

  it("keeps a live recovery lease closed and allows an expired lease to resume", async () => {
    let value: unknown = {
      state: "recovering",
      leaseUntil: new Date(Date.now() + 60_000).toISOString(),
      alertDelivery: { attempts: 0 }
    };
    const prisma = {
      appSetting: {
        findUnique: jest
          .fn<() => Promise<{ value: unknown }>>()
          .mockImplementation(() => Promise.resolve({ value }))
      }
    };
    const service = new GoogleSessionRecoveryService(
      prisma as never,
      { configured: () => true } as never,
      {} as never,
      {} as never
    );

    await expect(service.queueMayRun()).resolves.toBe(false);
    value = {
      state: "recovering",
      leaseUntil: new Date(Date.now() - 60_000).toISOString(),
      alertDelivery: { attempts: 0 }
    };
    await expect(service.queueMayRun()).resolves.toBe(true);
  });
});
