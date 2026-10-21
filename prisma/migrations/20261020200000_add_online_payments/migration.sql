-- Feature 17, Phase 1: the online payment (Paystack) columns.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "failureCode" TEXT,
ADD COLUMN     "flutaFeeAmount" INTEGER,
ADD COLUMN     "flutaFeeBps" INTEGER,
ADD COLUMN     "paystackFeeAmount" INTEGER;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "onlineFeeBps" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- Fluta's fee is 0% to 5% (basis points).
ALTER TABLE "Store" ADD CONSTRAINT "Store_online_fee_bps_check" CHECK (
  "onlineFeeBps" BETWEEN 0 AND 500
);

-- An online payment is always a Paystack payment with Fluta's reference. (A
-- store-collected payment never uses PAYSTACK: Payment_store_collected_method_check.)
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_online_check" CHECK (
  "source" <> 'ONLINE' OR ("method" = 'PAYSTACK' AND "paystackReference" IS NOT NULL)
);
