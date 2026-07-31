CREATE TYPE "invite_status" AS ENUM ('open', 'submitted');
CREATE TYPE "submission_status" AS ENUM ('ready_for_review', 'queued', 'submitting', 'failed', 'submitted_email_failed', 'rejected', 'submitted', 'submitted_email_sent');

CREATE TABLE "auth_user" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "emailVerified" BOOLEAN NOT NULL DEFAULT false,
  "image" TEXT,
  "role" TEXT DEFAULT 'user',
  "banned" BOOLEAN DEFAULT false,
  "banReason" TEXT,
  "banExpires" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "auth_user_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_session" (
  "id" UUID NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "token" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "impersonatedBy" TEXT,
  "userId" UUID NOT NULL,
  CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_account" (
  "id" UUID NOT NULL,
  "accountId" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TIMESTAMPTZ(3),
  "refreshTokenExpiresAt" TIMESTAMPTZ(3),
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "auth_account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_verification" (
  "id" UUID NOT NULL,
  "identifier" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "auth_verification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invites" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "token_hash" TEXT NOT NULL,
  "public_token" TEXT,
  "check_in" DATE NOT NULL,
  "check_out" DATE NOT NULL,
  "status" "invite_status" NOT NULL DEFAULT 'open',
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "submitted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "invite_id" UUID NOT NULL,
  "guest_email" TEXT NOT NULL,
  "building_code" TEXT NOT NULL,
  "unit_number" TEXT NOT NULL,
  "check_in" DATE NOT NULL,
  "check_out" DATE NOT NULL,
  "purpose" TEXT NOT NULL,
  "owner_name" TEXT NOT NULL,
  "owner_contact" TEXT NOT NULL,
  "status" "submission_status" NOT NULL DEFAULT 'ready_for_review',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "submission_id" UUID NOT NULL,
  "full_name" TEXT NOT NULL,
  "age" INTEGER NOT NULL,
  "requires_id" BOOLEAN NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "guest_files" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "guest_id" UUID NOT NULL,
  "storage_key" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "delete_after" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "guest_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automation_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "submission_id" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "error_message" TEXT,
  "screenshot_storage_key" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app_settings" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "auth_user_email_key" ON "auth_user"("email");
CREATE UNIQUE INDEX "auth_session_token_key" ON "auth_session"("token");
CREATE INDEX "auth_session_userId_idx" ON "auth_session"("userId");
CREATE UNIQUE INDEX "auth_account_providerId_accountId_key" ON "auth_account"("providerId", "accountId");
CREATE INDEX "auth_account_userId_idx" ON "auth_account"("userId");
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification"("identifier");
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites"("token_hash");
CREATE UNIQUE INDEX "invites_public_token_key" ON "invites"("public_token");
CREATE UNIQUE INDEX "submissions_invite_id_key" ON "submissions"("invite_id");
CREATE INDEX "submissions_status_created_at_idx" ON "submissions"("status", "created_at");
CREATE INDEX "guests_submission_id_idx" ON "guests"("submission_id");
CREATE UNIQUE INDEX "guest_files_storage_key_key" ON "guest_files"("storage_key");
CREATE INDEX "guest_files_guest_id_idx" ON "guest_files"("guest_id");
CREATE INDEX "guest_files_delete_after_idx" ON "guest_files"("delete_after");
CREATE INDEX "automation_runs_submission_id_created_at_idx" ON "automation_runs"("submission_id", "created_at");
CREATE INDEX "automation_runs_created_at_idx" ON "automation_runs"("created_at");

ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "invites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "guests" ADD CONSTRAINT "guests_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_files" ADD CONSTRAINT "guest_files_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
