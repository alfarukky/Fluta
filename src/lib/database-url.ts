import { getDefaultAutoSelectFamilyAttemptTimeout, setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

// The subset of node-postgres' PoolConfig that Fluta sets.
export interface PgPoolConfig {
  connectionString: string;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis: number;
  keepAlive: boolean;
  allowExitOnIdle: boolean;
}

// Neon hosts resolve to several IPv4 and IPv6 addresses. Node tries them in
// turn ("happy eyeballs") and gives each only 250 ms by default, so on a slow
// network every attempt fails (ETIMEDOUT) long before connect_timeout.
const MIN_ADDRESS_ATTEMPT_TIMEOUT_MS = 2_000;

// Opening a connection to Neon takes seconds from here (sometimes past
// connect_timeout), so keep idle pooled connections instead of pg's default of
// closing them after 10 s: otherwise the first query after any short pause,
// usually the session lookup, has to connect again. Just under Neon's 5-minute
// suspend, so the pool lets go before the compute drops the connection.
const IDLE_CONNECTION_TIMEOUT_MS = 4 * 60 * 1000;

// node-postgres ignores `connect_timeout` in the URL (only the Prisma CLI's
// engine reads it), so pass it on explicitly. Without it, a Neon branch waking
// from idle can hang forever: pg's default connection timeout is 0 (none).
export function pgPoolConfig(connectionString: string): PgPoolConfig {
  if (getDefaultAutoSelectFamilyAttemptTimeout() < MIN_ADDRESS_ATTEMPT_TIMEOUT_MS) {
    setDefaultAutoSelectFamilyAttemptTimeout(MIN_ADDRESS_ATTEMPT_TIMEOUT_MS);
  }
  const timeoutSeconds = Number(new URL(connectionString).searchParams.get("connect_timeout"));
  return {
    connectionString,
    connectionTimeoutMillis: timeoutSeconds > 0 ? timeoutSeconds * 1000 : undefined,
    idleTimeoutMillis: IDLE_CONNECTION_TIMEOUT_MS,
    // Notices dropped connections (network changes, NAT timeouts) sooner.
    keepAlive: true,
    // Idle connections never keep a script (the seed) from exiting.
    allowExitOnIdle: true,
  };
}
