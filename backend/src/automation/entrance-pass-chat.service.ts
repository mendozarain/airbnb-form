import { ConflictException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { HostexApiError, HostexClient } from "../hostex/hostex.client.js";
import { JobDispatcher } from "../jobs/job.dispatcher.js";
import { PrismaService } from "../prisma/prisma.service.js";

export function entrancePassMessage(purpose: string, recipient: string, tenantEmail?: string | null) {
  const inbox = "Please check your inbox and spam/junk folder.";
  if (purpose === "Tenant") {
    return `We’ve sent your check-in instructions and registration form (entrance pass) to your email. ${inbox}`;
  }
  if (purpose === "Viewing") {
    return `We’ve sent your registration form (entrance pass) and directions for your upcoming visit to your email. ${inbox}`;
  }
  if (tenantEmail && recipient.trim().toLowerCase() === tenantEmail.trim().toLowerCase()) {
    return `We’ve sent your visitor’s registration form (entrance pass) and directions to your email. ${inbox}`;
  }
  return "We’ve sent your visitor’s registration form (entrance pass) and directions to the email address they entered in the form. Please ask them to check their inbox and spam/junk folder.";
}

@Injectable()
export class EntrancePassChatService {
  private readonly logger = new Logger(EntrancePassChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hostex: HostexClient,
    @Optional() private readonly jobs?: JobDispatcher
  ) {}

  async prepare(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { invite: { include: { booking: true } } }
    });
    if (!submission) throw new NotFoundException("Submission not found");
    const booking = submission.invite.booking;
    if (!booking?.conversationId) {
      throw new ConflictException(
        "Email blocked: link this registration to its booking with a platform conversation, then retry email."
      );
    }
    const pending = await this.prisma.entrancePassDelivery.findFirst({
      where: { submissionId, status: "waiting_email" }
    });
    if (pending) {
      throw new ConflictException(
        "A previous email outcome was not recorded. Check email provider history before sending another email."
      );
    }
    const tenant =
      submission.purpose === "Visitor of Tenant"
        ? await this.prisma.submission.findFirst({
            where: { purpose: "Tenant", invite: { bookingId: booking.id } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { guestEmail: true }
          })
        : null;
    return this.prisma.entrancePassDelivery.create({
      data: {
        submissionId,
        conversationId: booking.conversationId,
        recipient: submission.guestEmail,
        message: entrancePassMessage(submission.purpose, submission.guestEmail, tenant?.guestEmail)
      }
    });
  }

  async emailFailed(id: string) {
    await this.prisma.entrancePassDelivery.update({
      where: { id },
      data: { status: "email_failed", lastError: "Email failed; no chat confirmation sent." }
    });
  }

  // Email is already accepted. Never propagate chat/storage errors into email retry handling.
  async emailSent(id: string) {
    try {
      const ready = await this.prisma.entrancePassDelivery.updateMany({
        where: { id, status: "waiting_email", emailSentAt: null },
        data: { status: "queued", emailSentAt: new Date() }
      });
      if (ready.count) await this.send(id);
    } catch {
      this.logger.error(`Could not finish chat confirmation ${id}; inspect its delivery history.`);
      await this.jobs?.enqueue("chat.queue", { delaySeconds: 60 });
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processQueue() {
    if (process.env.ENABLE_BACKGROUND_WORKERS === "false") return;
    // An interrupted non-idempotent send must never be automatically replayed.
    await this.prisma.entrancePassDelivery.updateMany({
      where: { status: "sending", lastAttemptAt: { lt: new Date(Date.now() - 10 * 60_000) } },
      data: { status: "unknown", lastError: "Chat send was interrupted. Check delivery before retrying." }
    });
    const queued = await this.prisma.entrancePassDelivery.findMany({
      where: { status: "queued", emailSentAt: { not: null } },
      orderBy: { createdAt: "asc" },
      take: 20
    });
    for (const delivery of queued) {
      await this.send(delivery.id).catch(() => this.logger.error(`Could not process chat ${delivery.id}`));
    }
  }

  async retry(submissionId: string, id: string) {
    const delivery = await this.get(submissionId, id);
    if (delivery.status !== "failed") {
      throw new ConflictException(
        "Only a confirmed chat failure can be retried. Check unknown delivery first."
      );
    }
    return this.send(id, true);
  }

  async reconcile(submissionId: string, id: string) {
    const delivery = await this.get(submissionId, id);
    if (delivery.status !== "unknown") return { status: delivery.status };
    // Identical confirmations from overlapping sends cannot safely identify this attempt.
    const overlap = await this.prisma.entrancePassDelivery.findFirst({
      where: {
        id: { not: id },
        conversationId: delivery.conversationId,
        message: delivery.message,
        OR: [
          { status: { in: ["sending", "unknown"] } },
          { sentAt: { gte: delivery.lastAttemptAt ?? delivery.createdAt } }
        ]
      }
    });
    if (overlap) return { status: "unknown" };
    const conversation = await this.hostex.getConversation(delivery.conversationId);
    const match = conversation.messages.find(
      (message) =>
        message.sender_role === "host" &&
        message.id &&
        !delivery.baselineMessageIds.includes(message.id) &&
        message.content === delivery.message &&
        message.created_at &&
        delivery.lastAttemptAt &&
        new Date(message.created_at).getTime() >= Math.floor(delivery.lastAttemptAt.getTime() / 1000) * 1000
    );
    if (match?.id) {
      const used = await this.prisma.entrancePassDelivery.findUnique({
        where: { confirmedMessageId: match.id }
      });
      if (!used) {
        await this.prisma.entrancePassDelivery.updateMany({
          where: { id, status: "unknown" },
          data: {
            status: "confirmed",
            confirmedMessageId: match.id,
            sentAt: new Date(match.created_at!),
            lastError: null
          }
        });
        return { status: "confirmed" };
      }
    }
    // Absence from a possibly paginated conversation does not prove non-delivery.
    return { status: "unknown" };
  }

  private async get(submissionId: string, id: string) {
    const delivery = await this.prisma.entrancePassDelivery.findFirst({ where: { id, submissionId } });
    if (!delivery) throw new NotFoundException("Chat delivery not found");
    return delivery;
  }

  private async send(id: string, retry = false) {
    const claim = await this.prisma.entrancePassDelivery.updateMany({
      where: { id, status: retry ? "failed" : "queued", emailSentAt: { not: null } },
      data: { status: "sending", lastAttemptAt: new Date(), lastError: null }
    });
    if (!claim.count) return { status: "already_claimed" };
    const delivery = await this.prisma.entrancePassDelivery.findUniqueOrThrow({ where: { id } });
    let attempted = false;
    try {
      const conversation = await this.hostex.getConversation(delivery.conversationId);
      await this.prisma.entrancePassDelivery.update({
        where: { id },
        data: {
          baselineMessageIds: conversation.messages.flatMap((message) => (message.id ? [message.id] : []))
        }
      });
      attempted = true;
      await this.hostex.sendMessage(delivery.conversationId, delivery.message);
      await this.prisma.entrancePassDelivery.update({
        where: { id },
        data: { status: "sent", sentAt: new Date(), lastError: null }
      });
      return { status: "sent" };
    } catch (error) {
      const status = attempted && !(error instanceof HostexApiError) ? "unknown" : "failed";
      await this.prisma.entrancePassDelivery.update({
        where: { id },
        data: {
          status,
          lastError:
            status === "unknown"
              ? "Chat delivery is uncertain. Check delivery before retrying."
              : "Platform chat failed. Retry chat to send the confirmation without resending the email."
        }
      });
      return { status };
    }
  }
}
