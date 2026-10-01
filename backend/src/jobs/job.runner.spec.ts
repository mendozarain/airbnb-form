import { jest } from "@jest/globals";
import { AiReviewService } from "../ai-review/ai-review.service.js";
import { AutomationService } from "../automation/automation.service.js";
import { EntrancePassChatService } from "../automation/entrance-pass-chat.service.js";
import { HostexService } from "../hostex/hostex.service.js";
import { CalendarService } from "../pricing/calendar.service.js";
import { PricingService } from "../pricing/pricing.service.js";
import { GoogleSessionRecoveryService } from "../settings/google-session-recovery.service.js";
import { GoogleSessionService } from "../settings/google-session.service.js";
import { JobRunner } from "./job.runner.js";

const fn = () => jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);

function fixture(overrides: { queued?: number; pending?: number; mayRun?: boolean } = {}) {
  const services = new Map<unknown, Record<string, ReturnType<typeof fn>>>([
    [AutomationService, { processQueue: fn(), cleanup: fn() }],
    [AiReviewService, { processQueue: fn() }],
    [EntrancePassChatService, { processQueue: fn() }],
    [
      HostexService,
      { processWebhookEvents: fn(), processDeliveryQueue: fn(), scheduledReservationSync: fn(), syncNow: fn() }
    ],
    [CalendarService, { hourlyFallback: fn(), sync: fn() }],
    [PricingService, { automaticPricing: fn(), apply: fn() }],
    [GoogleSessionRecoveryService, { queueMayRun: fn(), markResolved: fn(), retry: fn() }],
    [GoogleSessionService, { check: fn() }]
  ]);
  services.get(GoogleSessionRecoveryService)!.queueMayRun.mockResolvedValue(overrides.mayRun ?? true);
  const dispatcher = { enqueue: fn(), registerLocalHandler: jest.fn() };
  const background = {
    track: jest.fn<(id: string, work: () => Promise<unknown>) => Promise<void>>(async (_id, work) => {
      await work();
    })
  };
  const prisma = {
    submission: {
      count: jest
        .fn<(args: { where: { status: string } }) => Promise<number>>()
        .mockImplementation(({ where }) =>
          Promise.resolve(where.status === "QUEUED" ? (overrides.queued ?? 0) : (overrides.pending ?? 0))
        )
    }
  };
  const moduleRef = { get: (token: unknown) => services.get(token) };
  const runner = new JobRunner(moduleRef as never, dispatcher as never, background as never, prisma as never);
  return { runner, services, dispatcher, background };
}

describe("JobRunner", () => {
  it("routes wake-up jobs to the existing service methods", async () => {
    const { runner, services } = fixture();
    await runner.run({ job: "hostex.webhooks" });
    await runner.run({ job: "hostex.deliveries" });
    await runner.run({ job: "calendar.dailySync" });
    await runner.run({ job: "pricing.automatic" });
    await runner.run({ job: "automation.cleanup" });

    expect(services.get(HostexService)!.processWebhookEvents).toHaveBeenCalledTimes(1);
    expect(services.get(HostexService)!.processDeliveryQueue).toHaveBeenCalledTimes(1);
    expect(services.get(CalendarService)!.hourlyFallback).toHaveBeenCalledTimes(1);
    expect(services.get(PricingService)!.automaticPricing).toHaveBeenCalledTimes(1);
    expect(services.get(AutomationService)!.cleanup).toHaveBeenCalledTimes(1);
  });

  it("re-enqueues the automation drain while submissions are still queued and Google is usable", async () => {
    const { runner, dispatcher, services } = fixture({ queued: 2 });
    await runner.run({ job: "automation.queue", hop: 3 });

    expect(services.get(AutomationService)!.processQueue).toHaveBeenCalledTimes(1);
    expect(dispatcher.enqueue).toHaveBeenCalledWith("automation.queue", { hop: 4, delaySeconds: 2 });
  });

  it("does not chain while Google recovery is blocking the queue, or past the hop limit", async () => {
    const blocked = fixture({ queued: 2, mayRun: false });
    await blocked.runner.run({ job: "automation.queue" });
    expect(blocked.dispatcher.enqueue).not.toHaveBeenCalled();

    const exhausted = fixture({ queued: 2 });
    await exhausted.runner.run({ job: "automation.queue", hop: 25 });
    expect(exhausted.dispatcher.enqueue).not.toHaveBeenCalled();
  });

  it("chains the AI review drain while checks are pending", async () => {
    const { runner, dispatcher } = fixture({ pending: 1 });
    await runner.run({ job: "aiReview.queue" });
    expect(dispatcher.enqueue).toHaveBeenCalledWith("aiReview.queue", { hop: 1, delaySeconds: 2 });
  });

  it("reconcile covers a missed webhook and wakes the submission queues", async () => {
    const { runner, dispatcher, services } = fixture();
    await runner.run({ job: "hostex.reconcile" });

    const hostex = services.get(HostexService)!;
    expect(hostex.scheduledReservationSync).toHaveBeenCalled();
    expect(hostex.processWebhookEvents).toHaveBeenCalled();
    expect(hostex.processDeliveryQueue).toHaveBeenCalled();
    expect(dispatcher.enqueue).toHaveBeenCalledWith("aiReview.queue");
    expect(dispatcher.enqueue).toHaveBeenCalledWith("automation.queue");
  });

  it("tracks admin jobs and passes their data through", async () => {
    const { runner, background, services } = fixture();
    await runner.run({
      job: "admin.pricingApply",
      backgroundJobId: "job-1",
      data: { runId: "run-1", actor: { id: "user-1", email: "admin@example.com" } }
    });
    await runner.run({ job: "admin.calendarSync", backgroundJobId: "job-2", data: { start: "2026-10-01", end: "2026-10-31" } });

    expect(background.track).toHaveBeenCalledWith("job-1", expect.any(Function));
    expect(services.get(PricingService)!.apply).toHaveBeenCalledWith("run-1", { id: "user-1", email: "admin@example.com" });
    expect(services.get(CalendarService)!.sync).toHaveBeenCalledWith("2026-10-01", "2026-10-31");
  });

  it("marks the Google session resolved after a valid check", async () => {
    const { runner, services } = fixture();
    services.get(GoogleSessionService)!.check.mockResolvedValue({ valid: true });
    await runner.run({ job: "admin.googleCheck", backgroundJobId: "job-3" });
    expect(services.get(GoogleSessionRecoveryService)!.markResolved).toHaveBeenCalled();
  });
});
