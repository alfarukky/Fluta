-- CreateEnum
CREATE TYPE "StoreRole" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "PricingType" AS ENUM ('PER_ITEM', 'PER_KG', 'PER_PACKAGE');

-- CreateEnum
CREATE TYPE "AreaChargeType" AS ENUM ('FIXED', 'QUOTE_REQUIRED');

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('ONLINE', 'COUNTER', 'PHONE', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "FulfilmentType" AS ENUM ('DROP_OFF', 'PICKUP_DELIVERY');

-- CreateEnum
CREATE TYPE "OrderStage" AS ENUM ('BOOKED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'RECEIVED_BY_STORE', 'QUOTE_AWAITING_APPROVAL', 'IN_PROGRESS', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderLineType" AS ENUM ('SERVICE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PickupWindowStatus" AS ENUM ('REQUESTED', 'PROPOSED_BY_STORE', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('ONLINE', 'STORE_COLLECTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PAYSTACK', 'CASH', 'BANK_TRANSFER', 'POS', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('STAFF', 'CUSTOMER', 'SYSTEM', 'FLUTA_ADMIN');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('SMS', 'EMAIL', 'WHATSAPP_MANUAL');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'OPENED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "StoreInvitation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "StoreRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "addressText" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logoUrl" TEXT,
    "brandPrimaryColor" TEXT,
    "brandAccentColor" TEXT,
    "timeZone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "StoreStatus" NOT NULL DEFAULT 'ACTIVE',
    "orderPrefix" TEXT NOT NULL,
    "nextOrderNumber" INTEGER NOT NULL DEFAULT 1001,
    "dropOffEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pickupDeliveryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payLaterEnabled" BOOLEAN NOT NULL DEFAULT false,
    "activeDays" INTEGER[],
    "openTime" TEXT,
    "closeTime" TEXT,
    "paystackSubaccountCode" TEXT,
    "settlementBankName" TEXT,
    "settlementAccountName" TEXT,
    "settlementAccountLast4" TEXT,
    "paystackConnectedAt" TIMESTAMP(3),
    "smsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "dailyBookingSmsCap" INTEGER NOT NULL DEFAULT 100,
    "emailCopiesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsappContactEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceArea" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chargeType" "AreaChargeType" NOT NULL,
    "fixedCharge" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ServiceArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClosedDate" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,

    CONSTRAINT "ClosedDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "pricingType" "PricingType" NOT NULL,
    "price" INTEGER NOT NULL,
    "requiresQuote" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderNumber" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" "OrderChannel" NOT NULL,
    "fulfilmentType" "FulfilmentType" NOT NULL,
    "stage" "OrderStage" NOT NULL DEFAULT 'BOOKED',
    "stageBeforeQuote" "OrderStage",
    "serviceAreaId" TEXT,
    "addressText" TEXT,
    "isOutOfArea" BOOLEAN NOT NULL DEFAULT false,
    "fulfilmentCharge" INTEGER,
    "requestedPickupDate" DATE,
    "requestedWindowStart" TEXT,
    "requestedWindowEnd" TEXT,
    "scheduledPickupDate" DATE,
    "scheduledWindowStart" TEXT,
    "scheduledWindowEnd" TEXT,
    "pickupWindowStatus" "PickupWindowStatus",
    "approvedQuoteId" TEXT,
    "payLater" BOOLEAN NOT NULL DEFAULT false,
    "trackingTokenHash" TEXT NOT NULL,
    "trackingTokenIssuedAt" TIMESTAMP(3) NOT NULL,
    "internalNote" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelNote" TEXT,
    "createdByUserId" TEXT,
    "bookingIpHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineType" "OrderLineType" NOT NULL,
    "serviceId" TEXT,
    "description" TEXT NOT NULL,
    "pricingType" "PricingType",
    "requiresQuote" BOOLEAN NOT NULL DEFAULT false,
    "unitPrice" INTEGER,
    "estimatedQuantity" DECIMAL(10,3),
    "quantity" DECIMAL(10,3),
    "lineTotal" INTEGER NOT NULL,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRevision" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "linesSnapshot" JSONB NOT NULL,
    "itemsSubtotal" INTEGER NOT NULL,
    "fulfilmentCharge" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'PENDING',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedByActor" "ActorType",
    "declinedAt" TIMESTAMP(3),
    "customerMessage" TEXT,

    CONSTRAINT "QuoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "source" "PaymentSource" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paystackReference" TEXT,
    "payerEmail" TEXT,
    "recordedByUserId" TEXT,
    "note" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "replacesPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedByUserId" TEXT,
    "voidReason" TEXT,
    "replacesRefundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStage" "OrderStage",
    "toStage" "OrderStage" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "body" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "priceAmount" INTEGER NOT NULL,
    "billingInterval" TEXT NOT NULL DEFAULT 'MONTHLY',
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionInvoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" SERIAL NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "amountPaid" INTEGER,
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentNote" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreInvitation_tokenHash_key" ON "StoreInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "StoreInvitation_storeId_idx" ON "StoreInvitation"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_slug_key" ON "Store"("slug");

-- CreateIndex
CREATE INDEX "ServiceArea_storeId_idx" ON "ServiceArea"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceArea_storeId_id_key" ON "ServiceArea"("storeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ClosedDate_storeId_date_key" ON "ClosedDate"("storeId", "date");

-- CreateIndex
CREATE INDEX "Service_storeId_idx" ON "Service"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Service_storeId_id_key" ON "Service"("storeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_storeId_phone_key" ON "Customer"("storeId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_storeId_id_key" ON "Customer"("storeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Order_trackingTokenHash_key" ON "Order"("trackingTokenHash");

-- CreateIndex
CREATE INDEX "Order_storeId_stage_idx" ON "Order"("storeId", "stage");

-- CreateIndex
CREATE INDEX "Order_storeId_createdAt_idx" ON "Order"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_bookingIpHash_createdAt_idx" ON "Order"("bookingIpHash", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_orderNumber_key" ON "Order"("storeId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_id_key" ON "Order"("storeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_approvedQuoteId_key" ON "Order"("storeId", "approvedQuoteId");

-- CreateIndex
CREATE INDEX "OrderLine_storeId_orderId_idx" ON "OrderLine"("storeId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRevision_orderId_version_key" ON "QuoteRevision"("orderId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRevision_storeId_id_key" ON "QuoteRevision"("storeId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paystackReference_key" ON "Payment"("paystackReference");

-- CreateIndex
CREATE INDEX "Payment_storeId_confirmedAt_idx" ON "Payment"("storeId", "confirmedAt");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Refund_storeId_orderId_idx" ON "Refund"("storeId", "orderId");

-- CreateIndex
CREATE INDEX "StatusEvent_orderId_createdAt_idx" ON "StatusEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageEvent_orderId_idx" ON "MessageEvent"("orderId");

-- CreateIndex
CREATE INDEX "MessageEvent_status_createdAt_idx" ON "MessageEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_storeId_createdAt_idx" ON "AuditEvent"("storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_storeId_key" ON "Subscription"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_invoiceNumber_key" ON "SubscriptionInvoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_subscriptionId_status_idx" ON "SubscriptionInvoice"("subscriptionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_subscriptionId_periodStart_key" ON "SubscriptionInvoice"("subscriptionId", "periodStart");

-- AddForeignKey
ALTER TABLE "StoreInvitation" ADD CONSTRAINT "StoreInvitation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceArea" ADD CONSTRAINT "ServiceArea_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosedDate" ADD CONSTRAINT "ClosedDate_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_customerId_fkey" FOREIGN KEY ("storeId", "customerId") REFERENCES "Customer"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_serviceAreaId_fkey" FOREIGN KEY ("storeId", "serviceAreaId") REFERENCES "ServiceArea"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_approvedQuoteId_fkey" FOREIGN KEY ("storeId", "approvedQuoteId") REFERENCES "QuoteRevision"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_storeId_serviceId_fkey" FOREIGN KEY ("storeId", "serviceId") REFERENCES "Service"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRevision" ADD CONSTRAINT "QuoteRevision_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusEvent" ADD CONSTRAINT "StatusEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusEvent" ADD CONSTRAINT "StatusEvent_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageEvent" ADD CONSTRAINT "MessageEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageEvent" ADD CONSTRAINT "MessageEvent_storeId_orderId_fkey" FOREIGN KEY ("storeId", "orderId") REFERENCES "Order"("storeId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
