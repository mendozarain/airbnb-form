CREATE TABLE "entrance_pass_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "submission_id" UUID NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'waiting_email',
  "email_sent_at" TIMESTAMPTZ(3),
  "sent_at" TIMESTAMPTZ(3),
  "last_attempt_at" TIMESTAMPTZ(3),
  "baseline_message_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "confirmed_message_id" TEXT,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entrance_pass_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "entrance_pass_deliveries_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "entrance_pass_deliveries_status_created_at_idx" ON "entrance_pass_deliveries"("status", "created_at");
CREATE INDEX "entrance_pass_deliveries_submission_id_created_at_idx" ON "entrance_pass_deliveries"("submission_id", "created_at");
CREATE UNIQUE INDEX "entrance_pass_deliveries_confirmed_message_id_key" ON "entrance_pass_deliveries"("confirmed_message_id");
