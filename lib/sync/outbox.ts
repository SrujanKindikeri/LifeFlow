/**
 * lib/sync/outbox.ts — Durable operation outbox for offline-first mutations.
 *
 * DESIGN
 * ──────
 * The outbox is a durable queue persisted in IndexedDB. Every mutation
 * (create, update, delete) is written here BEFORE any network request.
 * This guarantees that a page reload, browser crash, or temporary
 * network failure cannot lose the user's work.
 *
 * IDEMPOTENCY
 * ───────────
 * Each entry has a unique mutationId (UUID). If the same operation is
 * submitted twice (due to retry), the server uses the mutationId as an
 * idempotency key and returns 'accepted' without duplicating the record.
 *
 * BACKOFF
 * ───────
 * Failed operations are retried with bounded exponential backoff + jitter:
 *   delay = min(BASE * 2^attempts, MAX_DELAY) + random jitter
 * Maximum 8 attempts before an operation is marked 'sync_failed' and
 * the user is notified.
 */

import { getOfflineDB } from '@/lib/db/offline'
import {
  generateMutationId,
  nowIso,
} from '@/lib/sync/ids'
import type {
  OutboxOperation,
  MutationOp,
  SyncEntityType,
} from '@/types/sync'

// ─── Backoff configuration ────────────────────────────────────────────────────

const BACKOFF_BASE_MS   = 2_000    // 2 seconds
const BACKOFF_MAX_MS    = 300_000  // 5 minutes
const MAX_ATTEMPTS      = 8
const JITTER_RANGE_MS   = 1_000    // ±1 second

function calcRetryAfter(attempts: number): string {
  const expDelay  = Math.min(BACKOFF_BASE_MS * 2 ** attempts, BACKOFF_MAX_MS)
  const jitter    = Math.floor(Math.random() * JITTER_RANGE_MS)
  const delay     = expDelay + jitter
  return new Date(Date.now() + delay).toISOString()
}

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Add a mutation to the outbox.
 *
 * This is the ONLY entry point for writing to the outbox. All offline-capable
 * hooks (useOfflineNotes, useOfflineTasks, etc.) call this function after
 * writing to their local store.
 *
 * @returns The generated mutationId so the caller can reference this operation.
 */
export async function enqueueOperation(params: {
  clientUserId: string
  entityType: SyncEntityType
  entityId: string
  op: MutationOp
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>
  serverRevision?: number
}): Promise<string> {
  const db         = getOfflineDB()
  const mutationId = generateMutationId()
  const now        = nowIso()

  const operation: OutboxOperation = {
    mutationId,
    clientUserId:   params.clientUserId,
    entityType:     params.entityType,
    entityId:       params.entityId,
    op:             params.op,
    payload:        params.payload,
    enqueuedAt:     now,
    attempts:       0,
    retryAfter:     now,  // immediately eligible for the next sync
    serverRevision: params.serverRevision,
  }

  await db.outbox.add(operation)
  return mutationId
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Return all outbox entries for a user that are due for upload.
 * Entries are sorted by auto-increment id (FIFO) so older mutations
 * are always uploaded before newer ones, preserving causal order.
 *
 * An entry is "due" when retryAfter <= now.
 */
export async function getDueOperations(
  clientUserId: string,
): Promise<OutboxOperation[]> {
  const db  = getOfflineDB()
  const now = nowIso()

  const all = await db.outbox
    .where('clientUserId')
    .equals(clientUserId)
    .toArray()

  // Filter by retryAfter <= now and sort by auto-increment id (insertion order)
  return all
    .filter((op) => op.retryAfter <= now)
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
}

/**
 * Count total pending operations (including ones not yet due for retry).
 * Used for the sync status badge.
 */
export async function countOperations(clientUserId: string): Promise<number> {
  const db = getOfflineDB()
  return db.outbox.where('clientUserId').equals(clientUserId).count()
}

// ─── Acknowledge ──────────────────────────────────────────────────────────────

/**
 * Remove a successfully-processed operation from the outbox.
 * Called by the sync engine when the server returns 'accepted'.
 */
export async function acknowledgeOperation(mutationId: string): Promise<void> {
  const db = getOfflineDB()
  await db.outbox.where('mutationId').equals(mutationId).delete()
}

// ─── Retry failure ────────────────────────────────────────────────────────────

/**
 * Record a failed attempt and schedule the next retry.
 * If the operation has exceeded MAX_ATTEMPTS, it is left in the outbox
 * but its retryAfter is set far in the future so it does not block other ops.
 * The sync engine also marks the corresponding entity as 'sync_failed'.
 *
 * @returns true if the operation should be abandoned (max attempts reached).
 */
export async function recordFailure(
  mutationId: string,
  errorMessage: string,
): Promise<boolean> {
  const db  = getOfflineDB()
  const ops = await db.outbox.where('mutationId').equals(mutationId).toArray()
  if (ops.length === 0) return false

  const op       = ops[0]
  const attempts = (op.attempts ?? 0) + 1
  const abandon  = attempts >= MAX_ATTEMPTS

  const update: Partial<OutboxOperation> = {
    attempts,
    lastError:  errorMessage.slice(0, 500),
    retryAfter: abandon
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()  // 7 days
      : calcRetryAfter(attempts),
  }

  await db.outbox.where('mutationId').equals(mutationId).modify(update)
  return abandon
}

// ─── Mark syncing ─────────────────────────────────────────────────────────────

/**
 * Batch-mark a set of operations as 'syncing' so concurrent sync runs
 * (e.g. from different tabs) don't pick up the same batch.
 *
 * NOTE: We use retryAfter = far_future during a sync run so another tab
 * does not try to upload the same operations. The sync engine resets
 * retryAfter to 'now' on failure so operations become eligible again.
 */
export async function markSyncing(mutationIds: string[]): Promise<void> {
  const db            = getOfflineDB()
  const lockUntil     = new Date(Date.now() + 60_000).toISOString() // 60s lock

  for (const mutationId of mutationIds) {
    await db.outbox
      .where('mutationId')
      .equals(mutationId)
      .modify({ retryAfter: lockUntil })
  }
}

/**
 * Unlock operations that were locked for a sync run but the run failed
 * before getting results (e.g. network timeout, browser crash).
 * Makes them immediately eligible for the next run.
 */
export async function unlockOperations(mutationIds: string[]): Promise<void> {
  const db  = getOfflineDB()
  const now = nowIso()

  for (const mutationId of mutationIds) {
    await db.outbox
      .where('mutationId')
      .equals(mutationId)
      .modify({ retryAfter: now })
  }
}
