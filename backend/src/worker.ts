import "reflect-metadata";
import type { INestApplicationContext } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { loadSecrets } from "./config/secrets.js";
import { isJobName, type JobMessage } from "./jobs/job-names.js";

let context: Promise<INestApplicationContext> | undefined;

async function bootstrap() {
  await loadSecrets();
  const { WorkerModule } = await import("./worker.module.js");
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ["log", "warn", "error"] });
  return app;
}

function parse(body: string): JobMessage | null {
  try {
    const value = JSON.parse(body) as Partial<JobMessage>;
    return isJobName(value.job) ? (value as JobMessage) : null;
  } catch {
    return null;
  }
}

// Handles SQS records (wake-ups and admin jobs) and direct invocations from EventBridge Scheduler
// ({ "job": "hostex.reconcile" }). A failing record is reported so SQS retries only that one.
export async function handler(event: SQSEvent | JobMessage): Promise<SQSBatchResponse | void> {
  context ??= bootstrap().catch((error) => {
    context = undefined;
    throw error;
  });
  const { JobRunner } = await import("./jobs/job.runner.js");
  const runner = (await context).get(JobRunner);

  if (!("Records" in event)) {
    if (!isJobName(event.job)) throw new Error(`Unknown job ${String(event.job)}`);
    await runner.run(event);
    return;
  }

  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
  for (const record of event.Records) {
    const message = parse(record.body);
    if (!message) continue;
    try {
      await runner.run(message);
    } catch (error) {
      console.error(`Job ${message.job} failed`, error);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
