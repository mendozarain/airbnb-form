import { jest } from "@jest/globals";
import { HostexDeliveryStatus, InviteStatus, SubmissionStatus } from "../generated/prisma/enums.js";
import { InvitesService } from "./invites.service.js";

describe("InvitesService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.OWNER_NAME = "Host";
    process.env.OWNER_CONTACT = "0400000000";
    process.env.PUBLIC_APP_URL = "https://cozy.example";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("copies the admin-selected invite purpose into the guest submission", async () => {
    const invite = {
      id: "invite-1",
      purpose: "Tenant",
      checkIn: new Date("2026-08-01T00:00:00.000Z"),
      checkOut: new Date("2026-08-02T00:00:00.000Z"),
      status: InviteStatus.OPEN,
      expiresAt: new Date("2099-08-01T00:00:00.000Z")
    };
    const transaction = {
      submission: {
        create: resolved({ id: "submission-1" })
      },
      automationRun: {
        create: resolved({})
      },
      guest: {
        create: resolved({ id: "guest-1" })
      },
      guestFile: {
        create: resolved({})
      },
      invite: {
        update: resolved({})
      }
    };
    const prisma = {
      invite: {
        findUnique: resolved(invite)
      },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction)
      )
    };
    const service = new InvitesService(
      prisma as never,
      {} as never,
      { record: resolved({}) } as never,
      { isAutoQueueEnabled: resolved(true), isAiIdCheckEnabled: resolved(true) } as never
    );

    await expect(
      service.submit("public-token", {
        guestEmail: "guest@example.com",
        guests: [{ fullName: "Guest One", age: 10 }],
        acceptedRules: true
      })
    ).resolves.toEqual({ submissionId: "submission-1", status: "queued" });

    expect(transaction.submission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inviteId: "invite-1",
        guestEmail: "guest@example.com",
        purpose: "Tenant",
        status: SubmissionStatus.QUEUED
      })
    });
    expect(transaction.automationRun.create).toHaveBeenCalledWith({
      data: { submissionId: "submission-1", status: "queued" }
    });
  });

  it("holds an ID-required submission for AI review before Auto Queue", async () => {
    const invite = {
      id: "invite-1",
      purpose: "Tenant",
      checkIn: new Date("2026-08-01T00:00:00.000Z"),
      checkOut: new Date("2026-08-02T00:00:00.000Z"),
      status: InviteStatus.OPEN,
      expiresAt: new Date("2099-08-01T00:00:00.000Z")
    };
    const transaction = {
      submission: { create: resolved({ id: "submission-1" }) },
      submissionAiReview: { create: resolved({}) },
      automationRun: { create: resolved({}) },
      guest: { create: resolved({ id: "guest-1" }) },
      guestFile: { create: resolved({}) },
      invite: { update: resolved({}) }
    };
    const prisma = {
      invite: { findUnique: resolved(invite) },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction)
      )
    };
    const storage = {
      head: resolved({
        size: 1024,
        contentType: "image/jpeg",
        metadata: { originalName: "id.jpg" }
      })
    };
    const settings = {
      isAutoQueueEnabled: resolved(true),
      isAiIdCheckEnabled: resolved(true)
    };
    const service = new InvitesService(
      prisma as never,
      storage as never,
      { record: resolved({}) } as never,
      settings as never
    );

    await expect(
      service.submit("public-token", {
        guestEmail: "guest@example.com",
        guests: [{ fullName: "Guest One", age: 16, idFileKey: "ids/invite-1/id.jpg" }],
        acceptedRules: true
      })
    ).resolves.toEqual({ submissionId: "submission-1", status: "ai_check_pending" });

    expect(transaction.submission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: SubmissionStatus.AI_CHECK_PENDING })
    });
    expect(transaction.submissionAiReview.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ submissionId: "submission-1", status: "PENDING" })
    });
    expect(transaction.automationRun.create).not.toHaveBeenCalled();
  });

  it("regenerates without sending and suppresses an existing scheduled delivery", async () => {
    const oldInvite = {
      id: "invite-old",
      bookingId: "booking-1",
      purpose: "Tenant",
      checkIn: new Date("2026-08-10T00:00:00.000Z"),
      checkOut: new Date("2026-08-12T00:00:00.000Z"),
      status: InviteStatus.OPEN,
      expiresAt: new Date("2026-08-09T00:00:00.000Z"),
      hostexAutomation: { id: "automation-1" }
    };
    const created = {
      id: "invite-new",
      bookingId: "booking-1",
      purpose: "Tenant",
      expiresAt: new Date("2026-08-17T00:00:00.000Z")
    };
    const transaction = {
      invite: { update: resolved({}), create: resolved(created) },
      hostexBookingAutomation: { update: resolved({}) }
    };
    const prisma = {
      invite: { findUnique: resolved(oldInvite) },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction)
      )
    };
    const audit = { record: resolved({}) };
    const service = new InvitesService(prisma as never, {} as never, audit as never, {} as never);

    const result = await service.regenerate("invite-old", { expiresAt: "2026-08-17T00:00:00.000Z" });

    expect(transaction.invite.update).toHaveBeenCalledWith({
      where: { id: "invite-old" },
      data: expect.objectContaining({
        status: InviteStatus.REVOKED,
        revokedReason: "Regenerated by admin"
      })
    });
    expect(transaction.hostexBookingAutomation.update).toHaveBeenCalledWith({
      where: { id: "automation-1" },
      data: expect.objectContaining({ status: HostexDeliveryStatus.CANCELLED })
    });
    expect(transaction.invite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bookingId: "booking-1",
        parentInviteId: "invite-old",
        purpose: "Tenant"
      })
    });
    expect(result).toMatchObject({ id: "invite-new", expiresAt: "2026-08-17T00:00:00.000Z" });
  });

  it("returns gone for a revoked public URL", async () => {
    const prisma = {
      invite: {
        findUnique: resolved({
          status: InviteStatus.REVOKED,
          expiresAt: new Date("2099-01-01T00:00:00.000Z"),
          revokedAt: new Date()
        })
      }
    };
    const service = new InvitesService(
      prisma as never,
      {} as never,
      { record: resolved({}) } as never,
      {} as never
    );

    await expect(service.getPublic("revoked-token")).rejects.toMatchObject({ status: 410 });
  });
});

function resolved<T>(value: T) {
  return jest.fn<() => Promise<T>>().mockResolvedValue(value);
}
