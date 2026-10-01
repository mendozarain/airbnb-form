// Scheduled and wake-up jobs: each one drains work that is already recorded in Postgres, so a duplicate or
// late message is harmless.
export const WAKE_JOBS = [
  "automation.queue",
  "automation.cleanup",
  "aiReview.queue",
  "chat.queue",
  "hostex.webhooks",
  "hostex.deliveries",
  "hostex.reconcile",
  "calendar.dailySync",
  "pricing.automatic"
] as const;

// Admin actions that outlive an API Gateway request. Each is tracked by a BackgroundJob row.
export const ADMIN_JOBS = [
  "admin.googleCheck",
  "admin.googleRecover",
  "admin.hostexSync",
  "admin.bookingsSync",
  "admin.calendarSync",
  "admin.pricingApply"
] as const;

export type WakeJob = (typeof WAKE_JOBS)[number];
export type AdminJob = (typeof ADMIN_JOBS)[number];
export type JobName = WakeJob | AdminJob;

export type JobMessage = {
  job: JobName;
  backgroundJobId?: string;
  data?: Record<string, unknown>;
  // How many times a drain job has re-enqueued itself; bounds self-chaining.
  hop?: number;
};

// Jobs that launch Chromium run on the browser worker (large memory, one at a time).
const BROWSER_JOBS: ReadonlySet<JobName> = new Set<JobName>([
  "automation.queue",
  "admin.googleCheck",
  "admin.googleRecover"
]);

export function isBrowserJob(job: JobName) {
  return BROWSER_JOBS.has(job);
}

export function isJobName(value: unknown): value is JobName {
  return (
    typeof value === "string" &&
    ([...WAKE_JOBS, ...ADMIN_JOBS] as readonly string[]).includes(value)
  );
}
