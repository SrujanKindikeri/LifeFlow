/**
 * lib/sync/ids.ts — Stable client-side ID generation.
 *
 * DESIGN DECISIONS
 * ────────────────
 * 1. We use crypto.randomUUID() (Web Crypto API, available in all modern
 *    browsers and Node.js 14.17+) rather than a third-party library.
 *
 * 2. Entity IDs created offline use a "local_" prefix so the server and sync
 *    engine can distinguish them from real MongoDB ObjectIds. When the server
 *    accepts a create mutation it returns the real serverId; the sync engine
 *    then replaces the local ID everywhere in IndexedDB.
 *
 * 3. Mutation IDs are plain UUIDs used as idempotency keys. The server stores
 *    them and rejects (returns 'accepted') duplicate mutations, so network
 *    retries cannot create duplicate records.
 *
 * NEVER import this file in server-side code.
 * The server always generates its own IDs (MongoDB ObjectIds) and ignores
 * any client-supplied ID — the mutationId is the only client-generated ID
 * the server accepts, and only as an idempotency key, not as an entity ID.
 */

/**
 * Generate a stable, locally-unique entity ID for a new offline record.
 *
 * Format: `local_<uuid>`
 * The "local_" prefix ensures the sync engine can tell this apart from a
 * real server-assigned MongoDB ObjectId (which is 24 hex chars, no underscores).
 *
 * @example
 *   const id = generateLocalId()  // "local_550e8400-e29b-41d4-a716-446655440000"
 */
export function generateLocalId(): string {
  return `local_${crypto.randomUUID()}`
}

/**
 * Generate a mutation ID used as an idempotency key in the sync outbox.
 *
 * Format: plain UUID v4
 * Each submit action (create, update, delete) gets its own mutation ID so
 * retrying a failed network request does not duplicate operations.
 *
 * @example
 *   const mutationId = generateMutationId()  // "550e8400-e29b-41d4-a716-446655440000"
 */
export function generateMutationId(): string {
  return crypto.randomUUID()
}

/**
 * Returns true if the given ID is a locally-generated offline ID
 * (has the "local_" prefix), rather than a server-assigned MongoDB ObjectId.
 *
 * Used by the sync engine to detect entities that have never been synced.
 */
export function isLocalId(id: string): boolean {
  return id.startsWith('local_')
}

/**
 * Build the ISO timestamp string for "right now".
 * Centralised here so it is easy to mock in tests.
 */
export function nowIso(): string {
  return new Date().toISOString()
}
