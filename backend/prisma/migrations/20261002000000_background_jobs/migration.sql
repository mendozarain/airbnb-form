CREATE TABLE "background_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "result" JSONB,
  "error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3),
  CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "background_jobs_kind_created_at_idx" ON "background_jobs"("kind", "created_at");
