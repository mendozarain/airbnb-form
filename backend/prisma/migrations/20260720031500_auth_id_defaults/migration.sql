ALTER TABLE "auth_user"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "auth_session"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "auth_account"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "auth_verification"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
