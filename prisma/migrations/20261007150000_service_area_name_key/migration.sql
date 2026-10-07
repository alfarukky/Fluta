-- AlterTable
-- nameKey is added nullable, filled from the name, then made required. The key
-- is the name lowercased, trimmed, with repeated whitespace collapsed to one
-- space; the server computes it the same way (src/lib/match-key.ts).
-- updatedAt is set by Prisma on every write; existing rows start at now().
ALTER TABLE "ServiceArea" ADD COLUMN "nameKey" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "ServiceArea" SET "nameKey" = lower(btrim(regexp_replace("name", '\s+', ' ', 'g')));

ALTER TABLE "ServiceArea" ALTER COLUMN "nameKey" SET NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceArea_storeId_nameKey_key" ON "ServiceArea"("storeId", "nameKey");

-- AddCheckConstraint
-- Prisma can't express these rules, so they live only here.
-- A store always offers at least one way to fulfil orders.
ALTER TABLE "Store" ADD CONSTRAINT "Store_fulfilment_option_check" CHECK (
  "dropOffEnabled" = TRUE OR "pickupDeliveryEnabled" = TRUE
);

-- A fixed-charge area has a charge (₦0 or more); a quote-required area has none.
ALTER TABLE "ServiceArea" ADD CONSTRAINT "ServiceArea_charge_check" CHECK (
  ("chargeType" = 'FIXED' AND "fixedCharge" IS NOT NULL AND "fixedCharge" >= 0)
  OR
  ("chargeType" = 'QUOTE_REQUIRED' AND "fixedCharge" IS NULL)
);
