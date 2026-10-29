-- Admin-controlled expected guest slots on each invite; ages are no longer required on new guests.
ALTER TABLE "invites" ADD COLUMN "expected_guest_count" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "guests" ALTER COLUMN "age" DROP NOT NULL;
