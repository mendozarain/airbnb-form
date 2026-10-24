-- Per-date minimum stay decided by the demand-pace preview. Existing rows predate the column.
ALTER TABLE "pricing_days" ADD COLUMN "min_stay" INTEGER NOT NULL DEFAULT 1;
