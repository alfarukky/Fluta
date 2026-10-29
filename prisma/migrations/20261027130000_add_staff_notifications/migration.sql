-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ONLINE_BOOKING', 'PRICE_APPROVED', 'PRICE_DECLINED', 'PICKUP_ACCEPTED', 'PAYMENT_RECEIVED', 'PAYMENT_NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('STAFF_AND_OWNERS', 'OWNERS_ONLY');

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "notificationsSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_storeId_createdAt_idx" ON "Notification"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_storeId_type_sourceId_key" ON "Notification"("storeId", "type", "sourceId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- "Payment needs review" is for owners only; every other type is for owners and staff.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_audience_matches_type" CHECK (
  ("type" = 'PAYMENT_NEEDS_REVIEW') = ("audience" = 'OWNERS_ONLY')
);
