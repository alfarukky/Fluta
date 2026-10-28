-- AlterTable
-- method: how the store paid the refund back, outside Fluta. reference: an
-- optional transfer or POS reference. clientRequestId: the record-refund
-- form's request ID, so the same request twice records one refund. Required:
-- every refund is recorded by a person, and no refund rows exist yet.
ALTER TABLE "Refund" ADD COLUMN     "clientRequestId" TEXT NOT NULL,
ADD COLUMN     "method" "PaymentMethod" NOT NULL,
ADD COLUMN     "reference" TEXT;

-- CreateIndex
-- A voided refund has at most one replacement, so corrections form a single chain.
CREATE UNIQUE INDEX "Refund_replacesRefundId_key" ON "Refund"("replacesRefundId");

-- CreateIndex
-- The Payments page's Refunds view lists and totals by when refunds were paid.
CREATE INDEX "Refund_storeId_paidAt_idx" ON "Refund"("storeId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_storeId_clientRequestId_key" ON "Refund"("storeId", "clientRequestId");

-- AddCheckConstraint
-- Prisma can't express these rules, so they live only here.
-- A refund always pays something back.
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_check" CHECK ("amount" > 0);

-- The store pays refunds back outside Fluta, so never through Paystack.
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_method_check" CHECK (
  "method" IN ('CASH', 'BANK_TRANSFER', 'POS', 'OTHER')
);

-- A voided refund has every void detail; one that isn't voided has none.
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_voided_check" CHECK (
  ("voidedAt" IS NULL AND "voidedByUserId" IS NULL AND "voidReason" IS NULL)
  OR ("voidedAt" IS NOT NULL AND "voidedByUserId" IS NOT NULL AND "voidReason" IS NOT NULL)
);
