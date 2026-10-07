// Rows a page saved itself (the copy each action returned), by ID. They show
// at once, without waiting for the page's refreshed data. Used by the
// services and fulfilment pages.

export interface SavedRecord {
  id: string;
  updatedAt: Date;
}

export type SavedRecords<T extends SavedRecord> = ReadonlyMap<string, T>;

const isNewer = (a: SavedRecord, b: SavedRecord) => a.updatedAt.getTime() > b.updatedAt.getTime();

// The newest copy of every row: a saved copy replaces the server's until the
// server's is as new (so an older refresh, say the one from Disable arriving
// after Undo, can't bring back a stale state), and rows just added appear
// before the server lists them.
export function withSavedRecords<T extends SavedRecord>(listed: readonly T[], saved: SavedRecords<T>): T[] {
  const merged = listed.map((row) => {
    const copy = saved.get(row.id);
    return copy && isNewer(copy, row) ? copy : row;
  });
  const ids = new Set(listed.map((row) => row.id));
  for (const copy of saved.values()) if (!ids.has(copy.id)) merged.push(copy);
  return merged;
}

// Adds a saved copy (unless a newer one is already saved), dropping copies the
// server has caught up with.
export function rememberSavedRecord<T extends SavedRecord>(
  saved: SavedRecords<T>,
  row: T,
  listed: readonly T[],
): SavedRecords<T> {
  const byId = new Map(listed.map((current) => [current.id, current]));
  const next = new Map<string, T>();
  for (const copy of [...saved.values(), row]) {
    const server = byId.get(copy.id);
    const kept = next.get(copy.id);
    if ((!server || isNewer(copy, server)) && (!kept || isNewer(copy, kept))) next.set(copy.id, copy);
  }
  return next;
}
