ALTER TYPE "invite_status" ADD VALUE IF NOT EXISTS 'revoked';

CREATE TYPE "hostex_delivery_kind" AS ENUM ('automated', 'manual');
CREATE TYPE "pricing_run_mode" AS ENUM ('preview', 'manual', 'automatic');
CREATE TYPE "pricing_run_status" AS ENUM ('running', 'previewed', 'submitted', 'partial_failed', 'failed');

CREATE TABLE "bookings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "reservation_code" TEXT NOT NULL,
  "stay_code" TEXT NOT NULL,
  "property_id" INTEGER NOT NULL,
  "channel_type" TEXT NOT NULL,
  "channel_id" TEXT,
  "listing_id" TEXT,
  "status" TEXT NOT NULL,
  "stay_status" TEXT,
  "guest_name" TEXT,
  "guest_email" TEXT,
  "guest_phone" TEXT,
  "number_of_guests" INTEGER,
  "number_of_adults" INTEGER,
  "number_of_children" INTEGER,
  "conversation_id" TEXT,
  "check_in" DATE NOT NULL,
  "check_out" DATE NOT NULL,
  "booked_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "last_synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bookings_stay_code_key" ON "bookings"("stay_code");
CREATE INDEX "bookings_status_check_in_idx" ON "bookings"("status", "check_in");
CREATE INDEX "bookings_guest_email_idx" ON "bookings"("guest_email");
CREATE INDEX "bookings_reservation_code_idx" ON "bookings"("reservation_code");

INSERT INTO "bookings" (
  "reservation_code", "stay_code", "property_id", "channel_type", "status",
  "conversation_id", "check_in", "check_out", "last_synced_at", "created_at", "updated_at"
)
SELECT
  d."reservation_code", d."stay_code", d."property_id", d."channel_type", 'accepted',
  d."conversation_id", i."check_in", i."check_out", d."updated_at", d."created_at", d."updated_at"
FROM "hostex_invite_deliveries" d
JOIN "invites" i ON i."id" = d."invite_id"
ON CONFLICT ("stay_code") DO NOTHING;

ALTER TABLE "invites"
  ADD COLUMN "booking_id" UUID,
  ADD COLUMN "parent_invite_id" UUID,
  ADD COLUMN "revoked_at" TIMESTAMPTZ(3),
  ADD COLUMN "revoked_reason" TEXT;

UPDATE "invites" i
SET "booking_id" = b."id"
FROM "hostex_invite_deliveries" d
JOIN "bookings" b ON b."stay_code" = d."stay_code"
WHERE d."invite_id" = i."id";

ALTER TABLE "hostex_invite_deliveries" RENAME TO "hostex_booking_automations";
ALTER TABLE "hostex_booking_automations" ADD COLUMN "booking_id" UUID;
UPDATE "hostex_booking_automations" a
SET "booking_id" = b."id"
FROM "bookings" b
WHERE b."stay_code" = a."stay_code";
ALTER TABLE "hostex_booking_automations" ALTER COLUMN "booking_id" SET NOT NULL;

DROP INDEX "hostex_invite_deliveries_stay_code_key";
CREATE UNIQUE INDEX "hostex_booking_automations_booking_id_key" ON "hostex_booking_automations"("booking_id");

ALTER TABLE "invites"
  ADD CONSTRAINT "invites_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "invites_parent_invite_id_fkey" FOREIGN KEY ("parent_invite_id") REFERENCES "invites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hostex_booking_automations"
  ADD CONSTRAINT "hostex_booking_automations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "invites_booking_id_created_at_idx" ON "invites"("booking_id", "created_at");
CREATE INDEX "invites_parent_invite_id_idx" ON "invites"("parent_invite_id");

CREATE TABLE "hostex_message_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "invite_id" UUID NOT NULL,
  "booking_id" UUID NOT NULL,
  "kind" "hostex_delivery_kind" NOT NULL,
  "conversation_id" TEXT,
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
  CONSTRAINT "hostex_message_deliveries_pkey" PRIMARY KEY ("id")
);

INSERT INTO "hostex_message_deliveries" (
  "invite_id", "booking_id", "kind", "conversation_id", "status", "attempts",
  "next_attempt_at", "last_attempt_at", "sent_at", "confirmed_at", "request_id",
  "last_error", "created_at", "updated_at"
)
SELECT
  "invite_id", "booking_id", 'automated', "conversation_id", "status", "attempts",
  "next_attempt_at", "last_attempt_at", "sent_at", "confirmed_at", "request_id",
  "last_error", "created_at", "updated_at"
FROM "hostex_booking_automations";

CREATE INDEX "hostex_message_deliveries_invite_id_created_at_idx" ON "hostex_message_deliveries"("invite_id", "created_at");
CREATE INDEX "hostex_message_deliveries_booking_id_created_at_idx" ON "hostex_message_deliveries"("booking_id", "created_at");
CREATE INDEX "hostex_message_deliveries_status_next_attempt_at_idx" ON "hostex_message_deliveries"("status", "next_attempt_at");
CREATE INDEX "hostex_message_deliveries_conversation_id_idx" ON "hostex_message_deliveries"("conversation_id");
ALTER TABLE "hostex_message_deliveries"
  ADD CONSTRAINT "hostex_message_deliveries_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "invites"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "hostex_message_deliveries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "admin_audit_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_user_id" UUID,
  "actor_email" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "details" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "admin_audit_events_entity_type_entity_id_created_at_idx" ON "admin_audit_events"("entity_type", "entity_id", "created_at");
CREATE INDEX "admin_audit_events_created_at_idx" ON "admin_audit_events"("created_at");

CREATE TABLE "pricing_settings" (
  "id" TEXT NOT NULL DEFAULT 'primary',
  "version" INTEGER NOT NULL DEFAULT 1,
  "automation_on" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB NOT NULL,
  "updated_by" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "pricing_settings" ("id", "config") VALUES (
  'primary',
  '{"propertyName":"D-714 Mantina Enclaves, Davao City","propertyId":12684960,"timezone":"Asia/Manila","horizonDays":365,"baseAirbnbPrice":3000,"minimumAirbnbPrice":2500,"maximumNonEventAirbnbPrice":3700,"rainySeasonDiscount":0.05,"urgentGapDays":14,"urgentGapDiscount":0.17,"weekendPremium":0.08,"lowOccupancyThreshold":0.3,"lowOccupancyDiscount":0.05,"lowOccupancyLeadDays":45,"mediumOccupancyThreshold":0.65,"mediumOccupancyPremium":0.08,"highOccupancyThreshold":0.8,"highOccupancyPremium":0.15,"eventBoost":0.25,"roundTo":50,"listings":[{"channelType":"airbnb","listingId":"1659842633688681776","ratio":1},{"channelType":"booking.com","listingId":"1654264601-65867120","ratio":1.5},{"channelType":"booking.com","listingId":"1654264601-65867117","ratio":1.5},{"channelType":"booking.com","listingId":"1654264601-65867118","ratio":1.5},{"channelType":"agoda","listingId":"1390142168-23351825","ratio":1.5},{"channelType":"booking_site","listingId":"119606-15877","ratio":1.5}],"recurringEvents":[{"name":"Araw ng Davao","start":"03-16","end":"03-16"},{"name":"Kadayawan Festival","start":"08-15","end":"08-24"}]}'::jsonb
);

CREATE TABLE "pricing_setting_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "setting_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "config" JSONB NOT NULL,
  "changed_by" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_setting_versions_pkey" PRIMARY KEY ("id")
);
INSERT INTO "pricing_setting_versions" ("setting_id", "version", "config")
SELECT "id", "version", "config" FROM "pricing_settings";
CREATE UNIQUE INDEX "pricing_setting_versions_setting_id_version_key" ON "pricing_setting_versions"("setting_id", "version");
CREATE INDEX "pricing_setting_versions_created_at_idx" ON "pricing_setting_versions"("created_at");
ALTER TABLE "pricing_setting_versions"
  ADD CONSTRAINT "pricing_setting_versions_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "pricing_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "pricing_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_key" TEXT,
  "mode" "pricing_run_mode" NOT NULL,
  "status" "pricing_run_status" NOT NULL DEFAULT 'running',
  "settings_version" INTEGER NOT NULL,
  "config_snapshot" JSONB NOT NULL,
  "occupancy" JSONB,
  "initiated_by" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  CONSTRAINT "pricing_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pricing_runs_run_key_key" ON "pricing_runs"("run_key");
CREATE INDEX "pricing_runs_started_at_idx" ON "pricing_runs"("started_at");

CREATE TABLE "pricing_days" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "airbnb_price" INTEGER NOT NULL,
  "available" BOOLEAN NOT NULL,
  "occupancy_ratio" DOUBLE PRECISION NOT NULL,
  "event" TEXT,
  "reasons" JSONB NOT NULL,
  CONSTRAINT "pricing_days_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pricing_days_run_id_date_key" ON "pricing_days"("run_id", "date");
CREATE INDEX "pricing_days_date_idx" ON "pricing_days"("date");
ALTER TABLE "pricing_days" ADD CONSTRAINT "pricing_days_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "pricing_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "pricing_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" UUID NOT NULL,
  "channel_type" TEXT NOT NULL,
  "listing_id" TEXT NOT NULL,
  "ratio" DOUBLE PRECISION NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "range_count" INTEGER NOT NULL,
  "request_id" TEXT,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_submissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pricing_submissions_run_id_channel_type_listing_id_attempt_key" ON "pricing_submissions"("run_id", "channel_type", "listing_id", "attempt");
ALTER TABLE "pricing_submissions" ADD CONSTRAINT "pricing_submissions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "pricing_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "hostex_calendar_days" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "channel_type" TEXT NOT NULL,
  "listing_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "price" INTEGER,
  "inventory" INTEGER,
  "restrictions" JSONB,
  "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hostex_calendar_days_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hostex_calendar_days_channel_type_listing_id_date_key" ON "hostex_calendar_days"("channel_type", "listing_id", "date");
CREATE INDEX "hostex_calendar_days_date_idx" ON "hostex_calendar_days"("date");
