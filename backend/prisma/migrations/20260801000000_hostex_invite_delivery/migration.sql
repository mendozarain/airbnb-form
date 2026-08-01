CREATE TYPE "hostex_delivery_status" AS ENUM (
  'scheduled',
  'sending',
  'sent',
  'confirmed',
  'retry_wait',
  'blocked',
  'unknown',
  'cancelled',
  'skipped_submitted'
);

CREATE TYPE "hostex_webhook_status" AS ENUM (
  'pending',
  'processing',
  'processed',
  'failed'
);

CREATE TABLE "hostex_invite_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "invite_id" UUID NOT NULL,
  "reservation_code" TEXT NOT NULL,
  "stay_code" TEXT NOT NULL,
  "property_id" INTEGER NOT NULL,
  "channel_type" TEXT NOT NULL,
  "conversation_id" TEXT,
  "due_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "hostex_delivery_status" NOT NULL DEFAULT 'scheduled',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3),
  "last_attempt_at" TIMESTAMPTZ(3),
  "sent_at" TIMESTAMPTZ(3),
  "confirmed_at" TIMESTAMPTZ(3),
  "request_id" TEXT,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hostex_invite_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hostex_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "dedupe_key" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "reservation_code" TEXT,
  "stay_code" TEXT,
  "property_id" INTEGER,
  "conversation_id" TEXT,
  "message_id" TEXT,
  "event_timestamp" TIMESTAMPTZ(3) NOT NULL,
  "status" "hostex_webhook_status" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(3),
  CONSTRAINT "hostex_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hostex_webhook_credentials" (
  "id" TEXT NOT NULL DEFAULT 'primary',
  "secret_digest" TEXT NOT NULL,
  "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hostex_webhook_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hostex_invite_deliveries_invite_id_key" ON "hostex_invite_deliveries"("invite_id");
CREATE UNIQUE INDEX "hostex_invite_deliveries_stay_code_key" ON "hostex_invite_deliveries"("stay_code");
CREATE INDEX "hostex_invite_deliveries_status_due_at_idx" ON "hostex_invite_deliveries"("status", "due_at");
CREATE INDEX "hostex_invite_deliveries_conversation_id_idx" ON "hostex_invite_deliveries"("conversation_id");
CREATE UNIQUE INDEX "hostex_webhook_events_dedupe_key_key" ON "hostex_webhook_events"("dedupe_key");
CREATE INDEX "hostex_webhook_events_status_next_attempt_at_created_at_idx" ON "hostex_webhook_events"("status", "next_attempt_at", "created_at");

ALTER TABLE "hostex_invite_deliveries"
  ADD CONSTRAINT "hostex_invite_deliveries_invite_id_fkey"
  FOREIGN KEY ("invite_id") REFERENCES "invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
