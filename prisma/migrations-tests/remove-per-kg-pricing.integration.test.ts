import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { createTestPrisma } from "@/test/integration/db";
import { assertTestDatabase, loadTestEnv } from "@/test/integration/test-env";

// The real remove_per_kg_pricing migration, run against a throwaway schema on
// the test branch that has the tables as they were before it: the enum with
// PER_KG and both per-kg CHECK constraints. Never against `public`.

const MIGRATION = readFileSync("prisma/migrations/20261027120000_remove_per_kg_pricing/migration.sql", "utf8");

let prisma: PrismaClient;
let schema: string;

beforeAll(() => {
  prisma = createTestPrisma();
});

afterEach(async () => {
  if (schema) await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});

// The two tables' per-kg parts, exactly as the earlier migrations left them.
async function createOldSchema(): Promise<void> {
  schema = `per_kg_check_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const s = `"${schema}"`;
  for (const statement of [
    `CREATE SCHEMA ${s}`,
    `CREATE TYPE ${s}."PricingType" AS ENUM ('PER_ITEM', 'PER_KG', 'PER_PACKAGE')`,
    `CREATE TABLE ${s}."Service" ("id" TEXT PRIMARY KEY, "pricingType" ${s}."PricingType" NOT NULL, "requiresQuote" BOOLEAN NOT NULL DEFAULT false)`,
    `ALTER TABLE ${s}."Service" ADD CONSTRAINT "Service_per_kg_requires_quote" CHECK ("pricingType" <> 'PER_KG' OR "requiresQuote" = TRUE)`,
    `CREATE TABLE ${s}."OrderLine" ("id" TEXT PRIMARY KEY, "pricingType" ${s}."PricingType", "requiresQuote" BOOLEAN NOT NULL DEFAULT false, "estimatedQuantity" DECIMAL(10,3), "quantity" DECIMAL(10,3))`,
    `ALTER TABLE ${s}."OrderLine" ADD CONSTRAINT "OrderLine_per_kg_requires_quote" CHECK ("pricingType" IS DISTINCT FROM 'PER_KG' OR "requiresQuote" = TRUE)`,
    `INSERT INTO ${s}."Service" ("id", "pricingType") VALUES ('shirt', 'PER_ITEM'), ('bedding', 'PER_PACKAGE')`,
    `INSERT INTO ${s}."OrderLine" ("id", "pricingType", "quantity") VALUES ('line', 'PER_ITEM', 3)`,
  ]) {
    await prisma.$executeRawUnsafe(statement);
  }
}

// Runs the migration file as Prisma Migrate does (one script, one command),
// with the throwaway schema first on the search path. The error output, or
// null when it succeeded.
function runMigration(): string | null {
  const testEnv = loadTestEnv();
  assertTestDatabase(testEnv);
  try {
    execFileSync("npx", ["prisma", "db", "execute", "--stdin"], {
      input: `SET search_path TO "${schema}";\n${MIGRATION}`,
      env: { ...process.env, ...testEnv },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return null;
  } catch (error) {
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    return `${stdout?.toString() ?? ""}${stderr?.toString() ?? ""}`;
  }
}

async function enumValues(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ value: string }[]>(
    `SELECT e.enumlabel AS value FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = $1 AND t.typname = 'PricingType' ORDER BY e.enumsortorder`,
    schema,
  );
  return rows.map((row) => row.value);
}

async function constraintNames(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    `SELECT c.conname AS name FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = $1 AND c.contype = 'c' ORDER BY c.conname`,
    schema,
  );
  return rows.map((row) => row.name);
}

describe("the remove_per_kg_pricing migration", () => {
  it("stops with the counts on a database with per-kg rows, and changes nothing", async () => {
    await createOldSchema();
    await prisma.$executeRawUnsafe(`INSERT INTO "${schema}"."Service" ("id", "pricingType", "requiresQuote") VALUES ('wash', 'PER_KG', true)`);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}"."OrderLine" ("id", "pricingType", "requiresQuote", "quantity") VALUES ('w1', 'PER_KG', true, 2.5), ('w2', 'PER_KG', true, NULL)`,
    );

    expect(runMigration()).toMatch(/Cannot remove per-kg pricing: 1 service\(s\) and 2 order line\(s\) still use PER_KG\. Nothing was changed\./);

    expect(await enumValues()).toEqual(["PER_ITEM", "PER_KG", "PER_PACKAGE"]);
    expect(await constraintNames()).toEqual(["OrderLine_per_kg_requires_quote", "Service_per_kg_requires_quote"]);
    const kept = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) FROM "${schema}"."OrderLine" WHERE "pricingType" = 'PER_KG'`,
    );
    expect(Number(kept[0].count)).toBe(2);
  }, 120_000);

  it("rolls back every step when a later one fails", async () => {
    await createOldSchema();
    // A fractional quantity makes the last step (the whole-quantities CHECK)
    // fail after the per-kg rules and the enum have been replaced.
    await prisma.$executeRawUnsafe(`INSERT INTO "${schema}"."OrderLine" ("id", "pricingType", "quantity") VALUES ('half', 'PER_ITEM', 1.5)`);

    expect(runMigration()).toMatch(/OrderLine_whole_quantities/);

    expect(await enumValues()).toEqual(["PER_ITEM", "PER_KG", "PER_PACKAGE"]);
    expect(await constraintNames()).toEqual(["OrderLine_per_kg_requires_quote", "Service_per_kg_requires_quote"]);
  }, 120_000);

  it("succeeds on a database without per-kg rows", async () => {
    await createOldSchema();

    expect(runMigration()).toBeNull();

    expect(await enumValues()).toEqual(["PER_ITEM", "PER_PACKAGE"]);
    expect(await constraintNames()).toEqual(["OrderLine_whole_quantities"]);
    const services = await prisma.$queryRawUnsafe<{ id: string; pricingType: string }[]>(
      `SELECT "id", "pricingType"::text AS "pricingType" FROM "${schema}"."Service" ORDER BY "id"`,
    );
    expect(services).toEqual([
      { id: "bedding", pricingType: "PER_PACKAGE" },
      { id: "shirt", pricingType: "PER_ITEM" },
    ]);
  }, 120_000);
});
