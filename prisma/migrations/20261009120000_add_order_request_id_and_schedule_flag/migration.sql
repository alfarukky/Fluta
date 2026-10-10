-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "clientRequestId" TEXT,
ADD COLUMN     "isOutsideSchedule" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "serviceAreaName" TEXT;

-- Existing orders get their area's current name as the copy (new orders copy
-- it when they are created).
UPDATE "Order" SET "serviceAreaName" = "ServiceArea"."name"
FROM "ServiceArea"
WHERE "ServiceArea"."storeId" = "Order"."storeId" AND "ServiceArea"."id" = "Order"."serviceAreaId";

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_clientRequestId_key" ON "Order"("storeId", "clientRequestId");

-- AddCheckConstraint
-- Prisma can't express this rule, so it lives only here: a per-kg order line
-- always requires a quote (the same rule as Service_per_kg_requires_quote).
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_per_kg_requires_quote" CHECK (
  "pricingType" IS DISTINCT FROM 'PER_KG' OR "requiresQuote" = TRUE
);
