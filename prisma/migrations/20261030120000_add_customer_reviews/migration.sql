-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'REVIEW_RECEIVED';

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Review_orderId_key" ON "Review"("orderId");

-- CreateIndex
CREATE INDEX "Review_storeId_createdAt_idx" ON "Review"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_storeId_orderId_key" ON "Review"("storeId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageEvent_orderId_review_request_key" ON "MessageEvent"("orderId") WHERE ("template" = 'REVIEW_REQUEST');

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- A star rating from 1 to 5.
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

-- An optional comment of 1 to 300 characters: an empty comment is stored as NULL.
ALTER TABLE "Review" ADD CONSTRAINT "Review_comment_length" CHECK ("comment" IS NULL OR char_length("comment") BETWEEN 1 AND 300);
