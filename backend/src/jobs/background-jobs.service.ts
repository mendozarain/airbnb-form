import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AdminJob } from "./job-names.js";
import { JobDispatcher } from "./job.dispatcher.js";

const ACTIVE_WINDOW_MS = 20 * 60_000;

export type BackgroundJobView = {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed";
  result: unknown;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

@Injectable()
export class BackgroundJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: JobDispatcher
  ) {}

  // Starts an admin action in the background. A second click while one is active returns the same job.
  async start(kind: AdminJob, data?: Record<string, unknown>) {
    const active = await this.prisma.backgroundJob.findFirst({
      where: {
        kind,
        status: { in: ["queued", "running"] },
        createdAt: { gt: new Date(Date.now() - ACTIVE_WINDOW_MS) }
      },
      orderBy: { createdAt: "desc" }
    });
    if (active) return { jobId: active.id, status: active.status, alreadyRunning: true };

    const job = await this.prisma.backgroundJob.create({ data: { kind } });
    await this.dispatcher.enqueue(kind, { backgroundJobId: job.id, data });
    return { jobId: job.id, status: job.status };
  }

  async get(id: string): Promise<BackgroundJobView> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException("Job not found");
    const job = await this.prisma.backgroundJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException("Job not found");
    return {
      id: job.id,
      kind: job.kind,
      status: job.status as BackgroundJobView["status"],
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt
    };
  }

  async track(id: string, work: () => Promise<unknown>) {
    const claimed = await this.prisma.backgroundJob.updateMany({
      where: { id, status: "queued" },
      data: { status: "running", startedAt: new Date() }
    });
    if (!claimed.count) return;
    try {
      const result = await work();
      await this.prisma.backgroundJob.update({
        where: { id },
        data: {
          status: "succeeded",
          result: (result ?? null) as never,
          finishedAt: new Date()
        }
      });
    } catch (error) {
      await this.prisma.backgroundJob.update({
        where: { id },
        data: {
          status: "failed",
          error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
          finishedAt: new Date()
        }
      });
    }
  }
}
