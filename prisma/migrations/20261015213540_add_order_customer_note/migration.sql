-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerNote" TEXT;

-- AddCheckConstraint
-- The booking schema already limits the note to 300 characters; this keeps
-- any other writer to the same limit. A NULL note passes.
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerNote_length_check" CHECK (
  char_length("customerNote") <= 300
);
