import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { SubmissionStatus } from "../generated/prisma/enums.js";
import { AiReviewService } from "../ai-review/ai-review.service.js";
import { AutomationService } from "../automation/automation.service.js";
import { EntrancePassChatService } from "../automation/entrance-pass-chat.service.js";
import { HostexService } from "../hostex/hostex.service.js";
import { CalendarService } from "../pricing/calendar.service.js";
import { PricingService } from "../pricing/pricing.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { GoogleSessionRecoveryService } from "../settings/google-session-recovery.service.js";
import { GoogleSessionService } from "../settings/google-session.service.js";
import { BackgroundJobsService } from "./background-jobs.service.js";
import type { JobMessage } from "./job-names.js";
import { JobDispatcher } from "./job.dispatcher.js";

const MAX_HOPS = 25;

// Maps a job message to the existing service methods. Services are resolved lazily so feature modules can
// depend on JobDispatcher without an import cycle back to the runner.
@Injectable()
export class JobRunner implements OnModuleInit {
  private readonly logger = new Logger(JobRunner.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly dispatcher: JobDispatcher,
    private readonly background: BackgroundJobsService,
    private readonly prisma: PrismaService
  ) {}

  onModuleInit() {
    this.dispatcher.registerLocalHandler((message) => this.run(message));
  }

  async run(message: JobMessage) {
    this.logger.log(`Running ${message.job}`);
    const hop = message.hop ?? 0;

    if (message.backgroundJobId) {
      await this.background.track(message.backgroundJobId, () => this.runAdmin(message));
      return;
    }

    switch (message.job) {
      case "automation.queue": {
        await this.get(AutomationService).processQueue();
        await this.chainWhile(message, hop, async () => {
          const queued = await this.prisma.submission.count({ where: { status: SubmissionStatus.QUEUED } });
          return queued > 0 && (await this.get(GoogleSessionRecoveryService).queueMayRun());
        });
        return;
      }
      case "aiReview.queue": {
        await this.get(AiReviewService).processQueue();
        await this.chainWhile(message, hop, async () => {
          const pending = await this.prisma.submission.count({
            where: { status: SubmissionStatus.AI_CHECK_PENDING }
          });
          return pending > 0;
        });
        return;
      }
      case "chat.queue":
        await this.get(EntrancePassChatService).processQueue();
        return;
      case "hostex.webhooks":
        await this.get(HostexService).processWebhookEvents();
        return;
      case "hostex.deliveries":
        await this.get(HostexService).processDeliveryQueue();
        return;
      case "hostex.reconcile": {
        // Safety net for a missed webhook, a lost wake-up or a stuck row; also the 07:00 "invite is due" tick.
        const hostex = this.get(HostexService);
        await hostex.scheduledReservationSync();
        await hostex.processWebhookEvents();
        await hostex.processDeliveryQueue();
        await this.get(EntrancePassChatService).processQueue();
        await this.dispatcher.enqueue("aiReview.queue");
        await this.dispatcher.enqueue("automation.queue");
        return;
      }
      case "calendar.dailySync":
        await this.get(CalendarService).hourlyFallback();
        return;
      case "pricing.automatic":
        await this.get(PricingService).automaticPricing();
        return;
      case "automation.cleanup":
        await this.get(AutomationService).cleanup();
        return;
      default:
        this.logger.warn(`Ignoring unknown job ${message.job}`);
    }
  }

  private async runAdmin(message: JobMessage) {
    const data = message.data ?? {};
    switch (message.job) {
      case "admin.googleCheck": {
        const result = await this.get(GoogleSessionService).check();
        if (result.valid) {
          await this.get(GoogleSessionRecoveryService).markResolved();
        }
        return result;
      }
      case "admin.googleRecover": {
        const result = await this.get(GoogleSessionRecoveryService).retry();
        await this.dispatcher.enqueue("automation.queue");
        return result;
      }
      case "admin.hostexSync":
      case "admin.bookingsSync":
        return this.get(HostexService).syncNow();
      case "admin.calendarSync":
        return this.get(CalendarService).sync(String(data.start), String(data.end));
      case "admin.pricingApply":
        return this.get(PricingService).apply(
          String(data.runId),
          (data.actor as { id?: string | null; email?: string | null } | undefined) ?? undefined
        );
      default:
        throw new Error(`Unknown admin job ${message.job}`);
    }
  }

  // Each drain job handles one item; re-enqueue itself while more is waiting, bounded so a stuck row cannot loop.
  private async chainWhile(message: JobMessage, hop: number, hasMore: () => Promise<boolean>) {
    if (hop >= MAX_HOPS) return;
    if (await hasMore().catch(() => false)) {
      await this.dispatcher.enqueue(message.job, { hop: hop + 1, delaySeconds: 2 });
    }
  }

  private get<T>(token: new (...args: never[]) => T): T {
    return this.moduleRef.get(token, { strict: false });
  }
}
