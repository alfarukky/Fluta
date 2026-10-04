-- AlterTable
ALTER TABLE "OrderLine" ALTER COLUMN "lineTotal" DROP NOT NULL;

-- AddCheckConstraint
-- Prisma can't express this rule, so it lives only here. A CHECK whose
-- expression evaluates to NULL passes, so every column is tested with an
-- explicit IS NULL / IS NOT NULL before any comparison.
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_lineType_check" CHECK (
  (
    "lineType" = 'SERVICE'
    AND "serviceId" IS NOT NULL
    AND "pricingType" IS NOT NULL
    AND "unitPrice" IS NOT NULL AND "unitPrice" >= 0
    AND (
      (
        "quantity" IS NOT NULL AND "quantity" > 0
        AND "lineTotal" IS NOT NULL AND "lineTotal" >= 0
      )
      OR (
        -- Quote-required line not yet weighed or inspected.
        "requiresQuote" IS TRUE
        AND "quantity" IS NULL
        AND "lineTotal" IS NULL
      )
    )
  )
  OR (
    "lineType" = 'ADJUSTMENT'
    AND "serviceId" IS NULL
    AND "pricingType" IS NULL
    AND "unitPrice" IS NULL
    AND "quantity" IS NULL
    AND "estimatedQuantity" IS NULL
    AND "lineTotal" IS NOT NULL
  )
);
