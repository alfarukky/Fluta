-- Notifications (Feature 15): the outbox records where each message goes and
-- when it was last claimed, and a queued link message can be replaced.

-- AlterEnum
ALTER TYPE "MessageStatus" ADD VALUE 'REPLACED';

-- AlterTable
ALTER TABLE "MessageEvent" ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN "recipient" TEXT;

-- Existing messages went to the order's customer: the email for EMAIL, the
-- phone (E.164) for SMS and WhatsApp.
UPDATE "MessageEvent" m
SET "recipient" = CASE WHEN m."channel" = 'EMAIL' THEN COALESCE(c."email", c."phone") ELSE c."phone" END
FROM "Order" o
JOIN "Customer" c ON c."storeId" = o."storeId" AND c."id" = o."customerId"
WHERE o."storeId" = m."storeId" AND o."id" = m."orderId";

ALTER TABLE "MessageEvent" ALTER COLUMN "recipient" SET NOT NULL;
