import { jest } from "@jest/globals";
import { SubmissionStatus } from "../generated/prisma/enums.js";
import { AutomationService } from "./automation.service.js";

describe("AutomationService", () => {
  it("returns an expired-auth submission to the queue and starts recovery", async () => {
    const submission = {
      guestEmail: "guest@example.com",
      buildingCode: "D",
      unitNumber: "714",
      checkIn: new Date("2026-09-20"),
      checkOut: new Date("2026-09-21"),
      purpose: "Tenant",
      ownerName: "Owner",
      ownerContact: "0400000000",
      guests: []
    };
    const prisma = {
      submission: {
        findFirst: resolved({ id: "submission-1" }),
        findUnique: eyeballResolved(submission),
        updateMany: resolved({ count: 1 }),
        update: resolved({})
      },
      automationRun: {
        findFirst: resolved({ id: "run-1" }),
        update: resolved({}),
        create: resolved({})
      },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations))
    };
    const runner = {
      submit: resolved({
        ok: false,
        failureKind: "authentication_expired",
        error: "Google redirected to login"
      })
    };
    const recovery = {
      maintain: resolved(undefined),
      queueMayRun: resolved(true),
      recoverIfNeeded: resolved({ recovered: true })
    };
    const service = new AutomationService(
      prisma as never,
      {} as never,
      runner as never,
      {} as never,
      {} as never,
      {} as never,
      recovery as never,
      {} as never
    );

    await service.processQueue();

    expect(prisma.automationRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({ status: "waiting_for_google_session" })
    });
    expect(prisma.submission.update).toHaveBeenCalledWith({
      where: { id: "submission-1" },
      data: { status: SubmissionStatus.QUEUED }
    });
    expect(prisma.automationRun.create).toHaveBeenCalledWith({
      data: { submissionId: "submission-1", status: "queued" }
    });
    expect(recovery.recoverIfNeeded).toHaveBeenCalledWith("Google redirected to login");
  });

  it("resends an entrance pass after its email was already sent", async () => {
    const template = { subject: "Entrance pass", html: "<p>Attached</p>" };
    const prisma = {
      submission: {
        findUnique: resolved({
          guestEmail: "guest@example.com",
          purpose: "Viewing",
          status: SubmissionStatus.SUBMITTED_EMAIL_SENT,
          runs: [{ id: "run-1", screenshotStorageKey: "screenshots/pass.png" }]
        }),
        updateMany: resolved({ count: 1 }),
        update: resolved({})
      },
      automationRun: {
        update: resolved({})
      },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations))
    };
    const storage = { head: resolved({ size: 1234, contentType: "image/png" }) };
    const email = { sendEntrancePass: resolved({ messageId: "message-1" }) };
    const settings = { getEmailTemplate: resolved(template) };
    const passImages = {
      createUrl: jest.fn(() => "https://dev.example.com/api/entrance-pass/signed-token")
    };
    const service = new AutomationService(
      prisma as never,
      storage as never,
      {} as never,
      settings as never,
      email as never,
      passImages as never,
      { maintain: resolved(undefined), queueMayRun: resolved(true) } as never,
      {
        prepare: resolved({ id: "delivery-1" }),
        emailSent: resolved(undefined),
        emailFailed: resolved(undefined)
      } as never
    );

    await expect(service.retryEmail("submission-1")).resolves.toEqual({
      ok: true,
      status: "submitted_email_sent"
    });
    expect(prisma.submission.updateMany).toHaveBeenCalledWith({
      where: {
        id: "submission-1",
        status: {
          in: [SubmissionStatus.SUBMITTED_EMAIL_FAILED, SubmissionStatus.SUBMITTED_EMAIL_SENT]
        }
      },
      data: { status: SubmissionStatus.SUBMITTED }
    });
    expect(email.sendEntrancePass).toHaveBeenCalledWith(
      "guest@example.com",
      template,
      "https://dev.example.com/api/entrance-pass/signed-token"
    );
    expect(settings.getEmailTemplate).toHaveBeenCalledWith("Viewing");
    expect(prisma.submission.update).toHaveBeenCalledWith({
      where: { id: "submission-1" },
      data: { status: SubmissionStatus.SUBMITTED_EMAIL_SENT }
    });
  });
});

function resolved<T>(value: T) {
  return jest.fn<() => Promise<T>>().mockResolvedValue(value);
}

function eyeballResolved<T>(value: T) {
  return jest.fn<() => Promise<T>>().mockResolvedValue(value);
}

describe("email and platform confirmation integration", () => {
  function fixture() {
    const submission = {
      guestEmail: "form@example.com",
      purpose: "Visitor of Tenant",
      status: SubmissionStatus.SUBMITTED_EMAIL_FAILED,
      buildingCode: "D",
      unitNumber: "714",
      checkIn: new Date("2026-09-20"),
      checkOut: new Date("2026-09-21"),
      ownerName: "Owner",
      ownerContact: "0400000000",
      guests: [],
      runs: [{ id: "run-1", screenshotStorageKey: "pass.png" }]
    };
    const prisma = {
      submission: {
        findUnique: resolved(submission),
        findFirst: resolved({ id: "submission-1" }),
        updateMany: resolved({ count: 1 }),
        update: resolved({})
      },
      automationRun: { findFirst: resolved({ id: "run-1" }), update: resolved({}), create: resolved({}) },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations))
    };
    const email = { sendEntrancePass: resolved({ messageId: "email-1" }) };
    const chat = {
      prepare: resolved({ id: "delivery-1" }),
      emailSent: resolved(undefined),
      emailFailed: resolved(undefined)
    };
    const runner = { submit: resolved({ ok: true, screenshotKey: "pass.png" }) };
    const service = new AutomationService(
      prisma as never,
      { head: resolved({ size: 1 }) } as never,
      runner as never,
      { getEmailTemplate: resolved({ subject: "Visit", html: "Visit" }) } as never,
      email as never,
      { createUrl: () => "https://example.com/pass" } as never,
      { maintain: resolved(undefined), queueMayRun: resolved(true) } as never,
      chat as never
    );
    return { service, prisma, email, chat, runner };
  }

  it.each(["automatic", "retry"])("notifies after successful %s email", async (mode) => {
    const { service, email, chat } = fixture();
    if (mode === "automatic") await service.processQueue();
    else await service.retryEmail("submission-1");
    expect(email.sendEntrancePass).toHaveBeenCalledWith(
      "form@example.com",
      expect.anything(),
      "https://example.com/pass"
    );
    expect(chat.emailSent).toHaveBeenCalledWith("delivery-1");
    expect(chat.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      email.sendEntrancePass.mock.invocationCallOrder[0]
    );
    expect(email.sendEntrancePass.mock.invocationCallOrder[0]).toBeLessThan(
      chat.emailSent.mock.invocationCallOrder[0]
    );
  });

  it.each(["automatic", "retry"])("does not email when %s send has no booking conversation", async (mode) => {
    const { service, email, chat, prisma } = fixture();
    chat.prepare.mockRejectedValue(new Error("Email blocked: link booking"));
    if (mode === "automatic") await service.processQueue();
    else await expect(service.retryEmail("submission-1")).rejects.toThrow("Email blocked");
    expect(email.sendEntrancePass).not.toHaveBeenCalled();
    expect(chat.emailSent).not.toHaveBeenCalled();
    expect(prisma.submission.update).toHaveBeenCalledWith({
      where: { id: "submission-1" },
      data: { status: SubmissionStatus.SUBMITTED_EMAIL_FAILED }
    });
  });

  it.each(["automatic", "retry"])("does not confirm a failed %s email", async (mode) => {
    const { service, email, chat } = fixture();
    email.sendEntrancePass.mockRejectedValue(new Error("Email failed"));
    if (mode === "automatic") await service.processQueue();
    else await expect(service.retryEmail("submission-1")).rejects.toThrow("Email failed");
    expect(chat.emailSent).not.toHaveBeenCalled();
    expect(chat.emailFailed).toHaveBeenCalledWith("delivery-1");
  });
});
