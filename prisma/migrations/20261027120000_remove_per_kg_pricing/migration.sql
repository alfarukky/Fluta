-- Removes per-kg pricing (Feature 17b). All or nothing: one explicit
-- transaction, so a failure at any step changes nothing.
BEGIN;

-- 1. Check first. If any service or order line still uses per kg, stop with
--    the counts. This never deletes or converts data: per-kg rows must be
--    dealt with by hand before this migration can run.
DO $$
DECLARE
  per_kg_services integer;
  per_kg_lines integer;
BEGIN
  SELECT count(*) INTO per_kg_services FROM "Service" WHERE "pricingType" = 'PER_KG';
  SELECT count(*) INTO per_kg_lines FROM "OrderLine" WHERE "pricingType" = 'PER_KG';
  IF per_kg_services > 0 OR per_kg_lines > 0 THEN
    RAISE EXCEPTION 'Cannot remove per-kg pricing: % service(s) and % order line(s) still use PER_KG. Nothing was changed.',
      per_kg_services, per_kg_lines;
  END IF;
END $$;

-- 2. The per-kg rules.
ALTER TABLE "Service" DROP CONSTRAINT "Service_per_kg_requires_quote";
ALTER TABLE "OrderLine" DROP CONSTRAINT "OrderLine_per_kg_requires_quote";

-- 3. PricingType without PER_KG: PostgreSQL can't drop an enum value, so a
--    new type replaces the old one.
CREATE TYPE "PricingType_new" AS ENUM ('PER_ITEM', 'PER_PACKAGE');
ALTER TABLE "Service" ALTER COLUMN "pricingType" TYPE "PricingType_new" USING ("pricingType"::text::"PricingType_new");
ALTER TABLE "OrderLine" ALTER COLUMN "pricingType" TYPE "PricingType_new" USING ("pricingType"::text::"PricingType_new");
DROP TYPE "PricingType";
ALTER TYPE "PricingType_new" RENAME TO "PricingType";

-- 4. A last safety net: quantities are whole numbers when set (the app only
--    ever accepts 1 to 999). The columns keep their Decimal type.
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_whole_quantities" CHECK (
  ("quantity" IS NULL OR "quantity" = trunc("quantity"))
  AND ("estimatedQuantity" IS NULL OR "estimatedQuantity" = trunc("estimatedQuantity"))
);

COMMIT;
