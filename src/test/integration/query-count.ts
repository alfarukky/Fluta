import pg from "pg";
import { vi } from "vitest";

// How many SQL statements `run` sends. Prisma's pg adapter sends every
// statement outside a transaction through Pool.query, so counting those calls
// counts round trips to the database, relation loads included.
export async function countQueries<T>(run: () => Promise<T>): Promise<{ result: T; queries: number }> {
  const spy = vi.spyOn(pg.Pool.prototype, "query");
  try {
    const result = await run();
    return { result, queries: spy.mock.calls.length };
  } finally {
    spy.mockRestore();
  }
}
