ALTER TYPE "submission_status" ADD VALUE IF NOT EXISTS 'ai_check_pending';
ALTER TYPE "submission_status" ADD VALUE IF NOT EXISTS 'ai_checking';
ALTER TYPE "submission_status" ADD VALUE IF NOT EXISTS 'ai_review_required';

CREATE TYPE "ai_review_status" AS ENUM ('pending', 'checking', 'passed', 'rejected', 'review_required');

CREATE TABLE "submission_ai_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "submission_id" UUID NOT NULL,
    "status" "ai_review_status" NOT NULL DEFAULT 'pending',
    "model" TEXT NOT NULL,
    "results" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "checked_at" TIMESTAMPTZ(3),
    "notification_sent_at" TIMESTAMPTZ(3),
    "notification_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "submission_ai_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "submission_ai_reviews_submission_id_key" ON "submission_ai_reviews"("submission_id");
CREATE INDEX "submission_ai_reviews_status_created_at_idx" ON "submission_ai_reviews"("status", "created_at");

ALTER TABLE "submission_ai_reviews"
ADD CONSTRAINT "submission_ai_reviews_submission_id_fkey"
FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "hostex_booking_automations" AS automation
SET "due_at" = ((invite."check_in" - INTERVAL '1 day')::date + TIME '07:00') AT TIME ZONE 'Asia/Manila',
    "updated_at" = CURRENT_TIMESTAMP
FROM "invites" AS invite
WHERE automation."invite_id" = invite."id"
  AND automation."status" IN ('scheduled', 'retry_wait', 'blocked');

UPDATE "invites" AS invite
SET "expires_at" = automation."due_at" + INTERVAL '7 days'
FROM "hostex_booking_automations" AS automation
WHERE automation."invite_id" = invite."id"
  AND invite."status" = 'open'
  AND automation."status" IN ('scheduled', 'retry_wait', 'blocked');
