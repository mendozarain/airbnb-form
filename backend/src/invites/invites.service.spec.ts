import { jest } from "@jest/globals";
import { InviteStatus } from "../generated/prisma/enums.js";
import { InvitesService } from "./invites.service.js";

describe("InvitesService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.OWNER_NAME = "Host";
    process.env.OWNER_CONTACT = "0400000000";
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
    const service = new InvitesService(prisma as never, {} as never);

    await service.submit("public-token", {
      guestEmail: "guest@example.com",
      guests: [{ fullName: "Guest One", age: 10 }],
      acceptedRules: true
    });

    expect(transaction.submission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inviteId: "invite-1",
        guestEmail: "guest@example.com",
        purpose: "Tenant"
      })
    });
  });
});

function resolved<T>(value: T) {
  return jest.fn<() => Promise<T>>().mockResolvedValue(value);
}
