-- Store the logo's R2 object key instead of its URL. The public address is
-- built by getLogoUrl() from R2_PUBLIC_URL + key, never stored.
ALTER TABLE "Store" RENAME COLUMN "logoUrl" TO "logoKey";

-- Development had no logo values when this was written. Any URL that exists
-- elsewhere becomes its key (the path after the host).
UPDATE "Store"
SET "logoKey" = regexp_replace("logoKey", '^https?://[^/]+/', '')
WHERE "logoKey" ~ '^https?://';
