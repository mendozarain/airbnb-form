import { jest } from "@jest/globals";
import { SubmissionStatus } from "../generated/prisma/enums.js";
import { AutomationService } from "./automation.service.js";

describe("AutomationService", () => {
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
      passImages as never
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
