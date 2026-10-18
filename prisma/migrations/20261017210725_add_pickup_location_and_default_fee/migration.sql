-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "pickupLatitude" DECIMAL(9,6),
ADD COLUMN     "pickupLongitude" DECIMAL(9,6);

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "defaultDeliveryFee" INTEGER;

-- AddCheckConstraint
-- The booking service already checks and rounds coordinates; these keep any
-- other writer to the same rules. Both are set or both are NULL.
ALTER TABLE "Order" ADD CONSTRAINT "Order_pickup_location_check" CHECK (
  ("pickupLatitude" IS NULL AND "pickupLongitude" IS NULL)
  OR (
    "pickupLatitude" BETWEEN -90 AND 90
    AND "pickupLongitude" BETWEEN -180 AND 180
  )
);

-- AddCheckConstraint
-- ₦0 to ₦1,000,000 in kobo. NULL means the store has no default fee.
ALTER TABLE "Store" ADD CONSTRAINT "Store_defaultDeliveryFee_check" CHECK (
  "defaultDeliveryFee" BETWEEN 0 AND 100000000
);
