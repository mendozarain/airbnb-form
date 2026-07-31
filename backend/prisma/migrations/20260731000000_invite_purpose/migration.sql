ALTER TABLE "invites" ADD COLUMN "purpose" TEXT;

UPDATE "invites" AS "invite"
SET "purpose" = "submission"."purpose"
FROM "submissions" AS "submission"
WHERE "submission"."invite_id" = "invite"."id";

UPDATE "invites"
SET "purpose" = 'Visitor of Tenant'
WHERE "purpose" IS NULL;

ALTER TABLE "invites" ALTER COLUMN "purpose" SET NOT NULL;
