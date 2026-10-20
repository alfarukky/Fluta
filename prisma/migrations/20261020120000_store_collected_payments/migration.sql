-- AlterTable
-- clientRequestId: the record-payment form's request ID, so the same request
-- twice records one payment. reference: an optional transfer or POS
-- reference staff enter with a store-collected payment.
ALTER TABLE "Payment" ADD COLUMN     "clientRequestId" TEXT,
ADD COLUMN     "reference" TEXT;

-- CreateIndex
-- A voided payment has at most one replacement, so corrections form a single chain.
CREATE UNIQUE INDEX "Payment_replacesPaymentId_key" ON "Payment"("replacesPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_storeId_clientRequestId_key" ON "Payment"("storeId", "clientRequestId");

-- AddCheckConstraint
-- Prisma can't express these rules, so they live only here.
-- A confirmed payment has its confirmation time and no void details.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_confirmed_check" CHECK (
  "status" <> 'CONFIRMED' OR (
    "confirmedAt" IS NOT NULL
    AND "voidedAt" IS NULL
    AND "voidedByUserId" IS NULL
    AND "voidReason" IS NULL
  )
);

-- A voided payment keeps its confirmation time and has every void detail.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_voided_check" CHECK (
  "status" <> 'VOIDED' OR (
    "confirmedAt" IS NOT NULL
    AND "voidedAt" IS NOT NULL
    AND "voidedByUserId" IS NOT NULL
    AND "voidReason" IS NOT NULL
  )
);

-- Money taken at the store is never a Paystack payment. Feature 17 adds the
-- matching rule for online payments.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_store_collected_method_check" CHECK (
  "source" <> 'STORE_COLLECTED' OR "method" IN ('CASH', 'BANK_TRANSFER', 'POS', 'OTHER')
);
