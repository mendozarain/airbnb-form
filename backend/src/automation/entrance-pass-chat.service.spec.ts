import { jest } from "@jest/globals";
import { HostexApiError, HostexUncertainSendError } from "../hostex/hostex.client.js";
import { EntrancePassChatService, entrancePassMessage } from "./entrance-pass-chat.service.js";

const resolved = <T>(value: T) => jest.fn<(...args: unknown[]) => Promise<T>>().mockResolvedValue(value);

function fixture() {
  const delivery = {
    id: "delivery-1",
    submissionId: "submission-1",
    conversationId: "tenant-chat",
    message: entrancePassMessage("Visitor of Tenant", "visitor@example.com"),
    status: "failed",
    emailSentAt: new Date(),
    lastAttemptAt: new Date("2026-09-11T01:00:00.500Z"),
    createdAt: new Date("2026-09-11T01:00:00Z"),
    baselineMessageIds: ["old-message"]
  };
  const prisma = {
    submission: {
      findUnique: resolved({
        guestEmail: "visitor@example.com",
        purpose: "Visitor of Tenant",
        invite: {
          booking: { id: "booking-1", conversationId: "tenant-chat", guestEmail: "visitor@example.com" }
        }
      }),
      findFirst: resolved<{ guestEmail: string } | null>({ guestEmail: "tenant@example.com" })
    },
    entrancePassDelivery: {
      create: resolved(delivery),
      update: resolved(delivery),
      updateMany: resolved({ count: 1 }),
      findFirst: resolved<typeof delivery | null>(null),
      findUnique: resolved(null),
      findUniqueOrThrow: resolved(delivery),
      findMany: resolved([delivery])
    }
  };
  const hostex = {
    sendMessage: resolved({ requestId: "request-1" }),
    getConversation: resolved({
      messages: [
        {
          id: "old-message",
          sender_role: "host",
          content: delivery.message,
          created_at: "2026-09-10T00:00:00Z"
        }
      ]
    })
  };
  return { service: new EntrancePassChatService(prisma as never, hostex as never), prisma, hostex, delivery };
}

describe("entrance pass chat", () => {
  it("uses the agreed wording without revealing addresses", () => {
    expect(entrancePassMessage("Tenant", "a@example.com")).toBe(
      "We’ve sent your check-in instructions and registration form (entrance pass) to your email. Please check your inbox and spam/junk folder."
    );
    expect(entrancePassMessage("Viewing", "a@example.com")).toContain(
      "directions for your upcoming visit to your email"
    );
    expect(entrancePassMessage("Visitor of Tenant", " A@Example.com ", "a@example.com")).toContain(
      "directions to your email"
    );
    for (const tenant of [undefined, null, "different@example.com"]) {
      const message = entrancePassMessage("Visitor of Tenant", "a@example.com", tenant);
      expect(message).toContain("email address they entered in the form");
      expect(message).not.toContain("a@example.com");
    }
  });

  it("routes through the originating booking and compares only the latest Tenant form", async () => {
    const { service, prisma } = fixture();
    await service.prepare("submission-1");
    expect(prisma.submission.findFirst).toHaveBeenCalledWith({
      where: { purpose: "Tenant", invite: { bookingId: "booking-1" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { guestEmail: true }
    });
    expect(prisma.entrancePassDelivery.create).toHaveBeenCalledWith({
      data: {
        submissionId: "submission-1",
        conversationId: "tenant-chat",
        recipient: "visitor@example.com",
        message: expect.stringContaining("email address they entered in the form")
      }
    });
    prisma.submission.findFirst.mockResolvedValue(null);
    await service.prepare("submission-1");
    expect(prisma.entrancePassDelivery.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        message: expect.stringContaining("email address they entered in the form")
      })
    });
  });

  it("blocks a missing booking conversation before creating a send", async () => {
    const { service, prisma } = fixture();
    prisma.submission.findUnique.mockResolvedValue({
      guestEmail: "v@example.com",
      purpose: "Viewing",
      invite: { booking: null }
    } as never);
    await expect(service.prepare("submission-1")).rejects.toThrow("Email blocked");
    expect(prisma.entrancePassDelivery.create).not.toHaveBeenCalled();
  });

  it("creates a separate record for each intentional email send", async () => {
    const { service, prisma } = fixture();
    await service.prepare("submission-1");
    await service.prepare("submission-1");
    expect(prisma.entrancePassDelivery.create).toHaveBeenCalledTimes(2);
  });

  it("does not send chat for failed email", async () => {
    const { service, hostex, prisma } = fixture();
    await service.emailFailed("delivery-1");
    expect(hostex.sendMessage).not.toHaveBeenCalled();
    expect(prisma.entrancePassDelivery.update).toHaveBeenCalledWith({
      where: { id: "delivery-1" },
      data: expect.objectContaining({ status: "email_failed" })
    });
  });

  it("sends a confirmation after email acceptance and atomically prevents repeat sends", async () => {
    const { service, hostex, prisma, delivery } = fixture();
    await service.emailSent("delivery-1");
    expect(hostex.sendMessage).toHaveBeenCalledWith("tenant-chat", delivery.message);
    prisma.entrancePassDelivery.updateMany.mockResolvedValue({ count: 0 });
    await service.processQueue();
    expect(hostex.sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "keeps chat failure separate from accepted email (uncertain: %s)",
    async (uncertain) => {
      const { service, hostex, prisma } = fixture();
      hostex.sendMessage.mockRejectedValue(
        uncertain ? new HostexUncertainSendError(new Error("timeout")) : new HostexApiError("denied", 403)
      );
      await expect(service.emailSent("delivery-1")).resolves.toBeUndefined();
      expect(prisma.entrancePassDelivery.update).toHaveBeenLastCalledWith({
        where: { id: "delivery-1" },
        data: expect.objectContaining({ status: uncertain ? "unknown" : "failed" })
      });
    }
  );

  it("does not requeue an email receipt already processed", async () => {
    const { service, prisma, hostex } = fixture();
    prisma.entrancePassDelivery.updateMany.mockResolvedValue({ count: 0 });
    await service.emailSent("delivery-1");
    expect(hostex.sendMessage).not.toHaveBeenCalled();
    expect(prisma.entrancePassDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: "delivery-1", status: "waiting_email", emailSentAt: null },
      data: { status: "queued", emailSentAt: expect.any(Date) }
    });
  });

  it("does not propagate a chat storage failure into the email workflow", async () => {
    const { service, prisma } = fixture();
    prisma.entrancePassDelivery.updateMany.mockRejectedValue(new Error("Database unavailable"));
    await expect(service.emailSent("delivery-1")).resolves.toBeUndefined();
  });

  it("retries only confirmed failures without an email dependency", async () => {
    const { service, hostex, prisma, delivery } = fixture();
    prisma.entrancePassDelivery.findFirst.mockResolvedValue(delivery);
    await expect(service.retry("submission-1", "delivery-1")).resolves.toEqual({ status: "sent" });
    expect(hostex.sendMessage).toHaveBeenCalledTimes(1);
    prisma.entrancePassDelivery.findFirst.mockResolvedValue({ ...delivery, status: "unknown" });
    await expect(service.retry("submission-1", "delivery-1")).rejects.toThrow("Check unknown delivery first");
    expect(hostex.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not mistake old identical messages for confirmation or retry unknown delivery", async () => {
    const { service, prisma, hostex, delivery } = fixture();
    prisma.entrancePassDelivery.findFirst.mockResolvedValueOnce({ ...delivery, status: "unknown" });
    await expect(service.reconcile("submission-1", "delivery-1")).resolves.toEqual({ status: "unknown" });
    expect(hostex.sendMessage).not.toHaveBeenCalled();
  });

  it("confirms a new matching host message with a timestamp from this attempt", async () => {
    const { service, prisma, hostex, delivery } = fixture();
    prisma.entrancePassDelivery.findFirst.mockResolvedValueOnce({ ...delivery, status: "unknown" });
    hostex.getConversation.mockResolvedValue({
      messages: [
        {
          id: "new-message",
          sender_role: "host",
          content: delivery.message,
          created_at: "2026-09-11T01:00:00Z"
        }
      ]
    });
    await expect(service.reconcile("submission-1", "delivery-1")).resolves.toEqual({ status: "confirmed" });
    expect(hostex.sendMessage).not.toHaveBeenCalled();
  });
});
