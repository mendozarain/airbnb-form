import { CreateScheduleCommand, SchedulerClient } from "@aws-sdk/client-scheduler";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { isBrowserJob, type JobMessage, type JobName } from "./job-names.js";

type LocalHandler = (message: JobMessage) => Promise<void>;

const SQS_MAX_DELAY_SECONDS = 900;

export type EnqueueOptions = Omit<JobMessage, "job"> & { delaySeconds?: number };

// Sends a job to SQS when a queue is configured (AWS). Without one (local development) the job runs in-process
// shortly after, so the app behaves the same without any infrastructure. Never throws: a lost wake-up is
// recovered by the scheduled reconcile, so a failed enqueue must not fail the request that triggered it.
@Injectable()
export class JobDispatcher {
  private readonly logger = new Logger(JobDispatcher.name);
  private localHandler?: LocalHandler;
  private sqs?: SQSClient;
  private scheduler?: SchedulerClient;

  registerLocalHandler(handler: LocalHandler) {
    this.localHandler = handler;
  }

  async enqueue(job: JobName, options: EnqueueOptions = {}) {
    const { delaySeconds = 0, ...rest } = options;
    const message: JobMessage = { job, ...rest };
    try {
      const queueUrl = this.queueUrlFor(job);
      if (!queueUrl) {
        this.runLocally(message, delaySeconds);
        return;
      }
      await this.queueClient().send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(message),
          DelaySeconds: Math.min(Math.max(Math.round(delaySeconds), 0), SQS_MAX_DELAY_SECONDS)
        })
      );
    } catch (error) {
      this.logger.error(`Could not enqueue ${job}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Wakes a job at a specific time (retry backoff). Short delays use an SQS delay; longer ones a one-time
  // EventBridge Scheduler schedule that deletes itself after it fires.
  async wakeAt(job: JobName, at: Date) {
    const delaySeconds = Math.max(0, Math.ceil((at.getTime() - Date.now()) / 1000));
    const roleArn = process.env.SCHEDULER_ROLE_ARN;
    const targetArn = this.queueArnFor(job);
    if (delaySeconds <= SQS_MAX_DELAY_SECONDS || !roleArn || !targetArn) {
      await this.enqueue(job, { delaySeconds });
      return;
    }
    try {
      await this.schedulerClient().send(
        new CreateScheduleCommand({
          Name: `wake-${job.replace(/\./g, "-")}-${randomUUID()}`,
          ScheduleExpression: `at(${at.toISOString().slice(0, 19)})`,
          ScheduleExpressionTimezone: "UTC",
          FlexibleTimeWindow: { Mode: "OFF" },
          ActionAfterCompletion: "DELETE",
          Target: {
            Arn: targetArn,
            RoleArn: roleArn,
            Input: JSON.stringify({ job } satisfies JobMessage)
          }
        })
      );
    } catch (error) {
      this.logger.error(`Could not schedule ${job}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private runLocally(message: JobMessage, delaySeconds: number) {
    const handler = this.localHandler;
    if (!handler) return;
    const timer = setTimeout(() => {
      handler(message).catch((error) =>
        this.logger.error(`${message.job} failed: ${error instanceof Error ? error.message : String(error)}`)
      );
    }, Math.max(delaySeconds, 0) * 1000);
    timer.unref?.();
  }

  private queueUrlFor(job: JobName) {
    return (isBrowserJob(job) ? process.env.BROWSER_QUEUE_URL : process.env.JOBS_QUEUE_URL)?.trim() || undefined;
  }

  private queueArnFor(job: JobName) {
    return (isBrowserJob(job) ? process.env.BROWSER_QUEUE_ARN : process.env.JOBS_QUEUE_ARN)?.trim() || undefined;
  }

  private queueClient() {
    return (this.sqs ??= new SQSClient({}));
  }

  private schedulerClient() {
    return (this.scheduler ??= new SchedulerClient({}));
  }
}
