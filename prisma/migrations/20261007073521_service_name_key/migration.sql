-- AlterTable
-- Added nullable, filled from the name, then made required. The key is the
-- name lowercased, trimmed, with repeated whitespace collapsed to one space;
-- the server computes it the same way (src/lib/match-key.ts).
ALTER TABLE "Service" ADD COLUMN "nameKey" TEXT;

UPDATE "Service" SET "nameKey" = lower(btrim(regexp_replace("name", '\s+', ' ', 'g')));

ALTER TABLE "Service" ALTER COLUMN "nameKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Service_storeId_nameKey_key" ON "Service"("storeId", "nameKey");

-- AddCheckConstraint
-- Prisma can't express this rule, so it lives only here: a per-kg service
-- always requires a quote, on create and on edit.
ALTER TABLE "Service" ADD CONSTRAINT "Service_per_kg_requires_quote" CHECK (
  "pricingType" <> 'PER_KG' OR "requiresQuote" = TRUE
);
