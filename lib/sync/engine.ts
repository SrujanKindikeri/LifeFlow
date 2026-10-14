/**
 * lib/sync/engine.ts — LifeFlow sync engine.
 *
 * RESPONSIBILITIES
 * ─────────────────
 * 1. Pull remote changes (delta, cursor-based) from GET /api/sync/pull.
 * 2. Push local mutations from the outbox to POST /api/sync.
 * 3. Apply server results: update local records, handle conflicts, replace
 *    temporary "local_" IDs with real server IDs.
 * 4. Listen for online/offline/visibility/focus events and trigger sync.
 * 5. Enforce exponential backoff and prevent concurrent duplicate sync runs.
 * 6. Guard against account switching mid-sync.
 *
 * CORRECTNESS GUARANTEES
 * ──────────────────────
 * • A page reload or crash loses NOTHING — all mutations survive in the outbox.
 * • The engine is idempotent: running it twice produces the same result.
 * • It never uploads one user's data under another user's session.
 * • Partial server failures (some ops accepted, some rejected) are handled
 *   per-operation — successful ops are acknowledged, failed ops remain queued.
 *
 * BACKGROUND SYNC
 * ───────────────
 * Background Sync API is registered as a PROGRESSIVE ENHANCEMENT only.
 * Correctness does NOT depend on it. All sync logic runs in this engine,
 * which is triggered on page-visible / network-restored / focus events.
 *
 * NEVER import this file in server-side code.
 */

import { getOfflineDB } from '@/lib/db/offline'
import {
  getDueOperations,
  acknowledgeOperation,
  recordFailure,
  countOperations,
  markSyncing,
  unlockOperations,
} from '@/lib/sync/outbox'
import { checkAccountScope } from '@/lib/sync/account-guard'
import { autoResolve, recordConflict } from '@/lib/sync/conflict'
import { isLocalId, nowIso } from '@/lib/sync/ids'
import type {
  SyncEntityType,
  SyncState,
  SyncPhase,
  SyncMutation,
  SyncMutationResult,
  SyncPushResponse,
  SyncPullResponse,
  OutboxOperation,
  LocalNote,
  LocalTask,
  LocalHabit,
  LocalHabitLog,
  LocalExpense,
  LocalSubscription,
  LocalProject,
} from '@/types/sync'

// ─── Engine configuration ─────────────────────────────────────────────────────

const PUSH_BATCH_SIZE   = 30   // mutations per POST /api/sync request
const PULL_PAGE_SIZE    = 100  // records per GET /api/sync/pull request
const MIN_SYNC_INTERVAL = 5_000  // don't start a new cycle within 5 s of the last

// ─── State (module-level, single engine per tab) ──────────────────────────────

let _state: SyncState = {
  online:        typeof navigator !== 'undefined' ? navigator.onLine : true,
  phase:         'idle',
  pendingCount:  0,
  lastSyncedAt:  null,
  lastError:     null,
  conflictCount: 0,
}

let _listeners: Set<(s: SyncState) => void> = new Set()
let _syncInProgress = false
let _lastSyncStarted = 0
let _currentUserId: string | null = null
let _eventsBound = false
let _abortController: AbortController | null = null

// ─── Public API ───────────────────────────────────────────────────────────────

/** Subscribe to sync state changes. Returns an unsubscribe function. */
export function subscribeSyncState(
  listener: (state: SyncState) => void,
): () => void {
  _listeners.add(listener)
  listener({ ..._state })   // immediately deliver current state
  return () => _listeners.delete(listener)
}

/** Return the current sync state snapshot. */
export function getSyncState(): SyncState {
  return { ..._state }
}

/**
 * Initialise the engine for the given authenticated user.
 * Call once per app mount from the SyncProvider.
 * Safe to call again after login/logout cycles.
 */
export function initSyncEngine(userId: string): void {
  _currentUserId = userId
  bindEvents()
  void refreshPendingCount(userId)
  // Trigger an initial sync shortly after page load
  setTimeout(() => void triggerSync(userId), 2_000)
}

/**
 * Shut the engine down — removes event listeners and cancels in-flight requests.
 * Call on logout or unmount.
 */
export function teardownSyncEngine(): void {
  unbindEvents()
  _currentUserId   = null
  _abortController?.abort()
  _abortController = null
  _syncInProgress  = false
  _lastSyncStarted = 0   // reset debounce so next init can sync immediately
  _eventsBound     = false
  emitState({ phase: 'idle', pendingCount: 0 })
}

/**
 * Manually trigger a full sync cycle (push + pull for all entity types).
 * Safe to call multiple times — concurrent calls are debounced.
 */
export async function triggerSync(userId?: string): Promise<void> {
  const uid = userId ?? _currentUserId
  if (!uid) return

  const now = Date.now()
  if (_syncInProgress) return
  if (now - _lastSyncStarted < MIN_SYNC_INTERVAL) return

  // Guard account scope
  const scopeCheck = checkAccountScope(uid)
  if (scopeCheck !== 'ok') {
    emitState({ lastError: `Account scope mismatch: ${scopeCheck}` })
    return
  }

  _syncInProgress  = true
  _lastSyncStarted = now
  _abortController = new AbortController()

  try {
    await pushOutbox(uid, _abortController.signal)
    await pullAllEntities(uid, _abortController.signal)
    await refreshPendingCount(uid)
    const conflictCount = await countConflicts(uid)
    emitState({
      phase:         'idle',
      lastSyncedAt:  nowIso(),
      lastError:     null,
      conflictCount,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 401 means session expired — pause uploads, don't retry automatically
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('SessionExpired')) {
      emitState({ phase: 'error', lastError: 'Session expired. Please log in again.' })
    } else if ((err as Error & { name?: string }).name === 'AbortError') {
      emitState({ phase: 'idle', lastError: null })
    } else {
      emitState({ phase: 'error', lastError: msg.slice(0, 200) })
    }
  } finally {
    _syncInProgress = false
  }
}

// ─── Push outbox ──────────────────────────────────────────────────────────────

async function pushOutbox(userId: string, signal: AbortSignal): Promise<void> {
  const ops = await getDueOperations(userId)
  if (ops.length === 0) return

  emitState({ phase: 'pushing' })

  // Process in batches to avoid oversized payloads
  for (let i = 0; i < ops.length; i += PUSH_BATCH_SIZE) {
    if (signal.aborted) return

    const batch   = ops.slice(i, i + PUSH_BATCH_SIZE)
    const mutIds  = batch.map((op) => op.mutationId)

    // Lock batch while in flight (prevents other tabs from re-uploading)
    await markSyncing(mutIds)

    const mutations: SyncMutation[] = batch.map((op) => ({
      mutationId:     op.mutationId,
      entityType:     op.entityType,
      entityId:       op.entityId,
      op:             op.op,
      payload:        op.payload,
      serverRevision: op.serverRevision,
    }))

    let response: SyncPushResponse

    try {
      const res = await fetch('/api/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mutations }),
        signal,
        credentials: 'same-origin',
      })

      if (res.status === 401) throw new Error('Unauthorized')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      response = await res.json() as SyncPushResponse
    } catch (err) {
      // Network/auth error — unlock ops and propagate
      await unlockOperations(mutIds)
      throw err
    }

    // Process per-operation results
    for (const result of response.results) {
      const op = batch.find((o) => o.mutationId === result.mutationId)
      if (!op) continue

      switch (result.status) {
        case 'accepted':
          await handleAccepted(op, result.serverId, result.newRevision ?? 0, result.serverUpdatedAt)
          await acknowledgeOperation(result.mutationId)
          break

        case 'conflict':
          await handleConflictResult(userId, op, result)
          await acknowledgeOperation(result.mutationId) // remove from outbox regardless
          break

        case 'rejected':
          // Permanent rejection — remove from outbox, mark entity as failed
          await acknowledgeOperation(result.mutationId)
          await markEntityFailed(op.entityType, op.entityId, result.reason ?? 'Rejected by server')
          break

        case 'retryable':
          // Transient error — keep in outbox with backoff
          await unlockOperations([result.mutationId])
          await recordFailure(result.mutationId, result.reason ?? 'Retryable server error')
          break
      }
    }
  }
}

async function handleAccepted(
  op: OutboxOperation,
  serverId: string | undefined,
  newRevision: number,
  serverUpdatedAt: string | undefined,
): Promise<void> {
  const db    = getOfflineDB()
  const isNew = op.op === 'create'

  if (op.op === 'delete') {
    // Confirmed deletion — record is already removed from local store in the hook
    // but clean up tombstones if they exist
    await removeLocalRecord(op.entityType, op.entityId)
    return
  }

  // For creates where a real serverId was returned, replace the local ID
  if (isNew && serverId && isLocalId(op.entityId) && serverId !== op.entityId) {
    await replaceLocalId(db, op.entityType, op.entityId, serverId, newRevision, serverUpdatedAt)
    return
  }

  // Update sync metadata for updates and same-ID creates
  await updateSyncMeta(op.entityType, op.entityId, newRevision, serverUpdatedAt)
}

async function handleConflictResult(
  userId: string,
  op: OutboxOperation,
  result: SyncMutationResult,
): Promise<void> {
  const resolved = await autoResolve(
    userId,
    op.entityType,
    op.entityId,
    result,
    op.payload,
  )

  if (resolved === 'needs_review') {
    await markEntityConflict(op.entityType, op.entityId, result.serverRecord ?? {})
  }
}

// ─── Pull ──────────────────────────────────────────────────────────────────────

const ENTITY_TYPES: SyncEntityType[] = [
  'note', 'task', 'habit', 'habitLog', 'expense', 'subscription', 'project',
]

async function pullAllEntities(userId: string, signal: AbortSignal): Promise<void> {
  emitState({ phase: 'pulling' })

  for (const entityType of ENTITY_TYPES) {
    if (signal.aborted) return
    await pullEntityType(userId, entityType, signal)
  }
}

async function pullEntityType(
  userId: string,
  entityType: SyncEntityType,
  signal: AbortSignal,
): Promise<void> {
  const db        = getOfflineDB()
  const cursorId  = `${userId}:${entityType}`
  const cursor    = await db.cursors.get(cursorId)
  let since       = cursor?.lastPulledAt ?? null
  let hasMore     = true

  while (hasMore) {
    if (signal.aborted) return

    const url = new URL('/api/sync/pull', window.location.origin)
    url.searchParams.set('entityType', entityType)
    url.searchParams.set('limit', String(PULL_PAGE_SIZE))
    if (since) url.searchParams.set('since', since)

    const res = await fetch(url.toString(), {
      credentials: 'same-origin',
      signal,
    })

    if (res.status === 401) throw new Error('Unauthorized')
    if (!res.ok) throw new Error(`Pull HTTP ${res.status} for ${entityType}`)

    const data = await res.json() as SyncPullResponse

    // Write incoming records to IndexedDB
    await applyPulledRecords(userId, entityType, data.records)

    if (data.cursor) {
      since = data.cursor
      await db.cursors.put({
        id:           cursorId,
        clientUserId: userId,
        entityType,
        lastPulledAt: data.cursor,
        lastPushedAt: cursor?.lastPushedAt ?? null,
      })
    }

    hasMore = data.hasMore
  }
}

async function applyPulledRecords(
  userId: string,
  entityType: SyncEntityType,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  records: Array<Record<string, any>>,
): Promise<void> {
  if (records.length === 0) return
  const db = getOfflineDB()

  // Build the set of entity IDs that still have pending outbox operations for
  // this entity type. We must NOT overwrite those local records with the
  // (possibly older) pulled snapshot — the local mutation is the authoritative
  // version until the server confirms or rejects it.
  //
  // Note: pushOutbox runs before pullAllEntities in the same sync cycle, so
  // successfully-accepted ops will already have been acknowledged (removed from
  // the outbox) by the time we reach here. The remaining entries in pendingIds
  // are operations that failed with 'retryable' or are from a previous partial
  // sync cycle that was interrupted.
  const allOutbox = await db.outbox
    .where('clientUserId').equals(userId).toArray()
  const pendingIds = new Set(
    allOutbox
      .filter((op) => op.entityType === entityType)
      .map((op) => op.entityId),
  )

  for (const rec of records) {
    const id    = rec._id as string
    const meta  = {
      // clientUserId scopes IndexedDB queries to this account. The userId
      // field from the server response is preserved in the spread below.
      clientUserId:       userId,
      syncStatus:         'synced' as const,
      serverRevision:     rec.serverRevision ?? 0,
      lastSyncedAt:       nowIso(),
      conflictServerData: undefined,
      deleted:            rec.deleted ?? false,
    }

    if (rec.deleted) {
      // Tombstone — only remove if no pending local operations reference this ID
      // (e.g. an offline edit that was queued before the server-side delete).
      if (!pendingIds.has(id)) {
        await removeLocalRecord(entityType, id)
      }
      continue
    }

    // Guard: if there is a pending or in-flight local mutation for this entity,
    // do NOT overwrite it with the server snapshot. The local version is newer
    // than what the server just returned (the server hasn't seen our mutation
    // yet). Overwriting would silently discard the user's unsynced work.
    //
    // The correct flow:
    //   1. The outbox entry will be pushed on the next sync cycle.
    //   2. The server returns 'accepted' (or 'conflict').
    //   3. handleAccepted / handleConflictResult updates the local record with
    //      the true server state.
    if (pendingIds.has(id)) continue

    const localRecord = { ...rec, ...meta }

    switch (entityType) {
      case 'note':
        await db.notes.put(localRecord as LocalNote)
        break
      case 'task':
        await db.tasks.put(localRecord as LocalTask)
        break
      case 'habit':
        await db.habits.put(localRecord as LocalHabit)
        break
      case 'habitLog':
        await db.habitLogs.put(localRecord as LocalHabitLog)
        break
      case 'expense':
        await db.expenses.put(localRecord as LocalExpense)
        break
      case 'subscription':
        await db.subscriptions.put(localRecord as LocalSubscription)
        break
      case 'project':
        await db.projects.put(localRecord as LocalProject)
        break
    }
  }
}

// ─── Local record helpers ─────────────────────────────────────────────────────

async function removeLocalRecord(
  entityType: SyncEntityType,
  entityId: string,
): Promise<void> {
  const db = getOfflineDB()
  switch (entityType) {
    case 'note':         await db.notes.delete(entityId);         break
    case 'task':         await db.tasks.delete(entityId);         break
    case 'habit':        await db.habits.delete(entityId);        break
    case 'habitLog':     await db.habitLogs.delete(entityId);     break
    case 'expense':      await db.expenses.delete(entityId);      break
    case 'subscription': await db.subscriptions.delete(entityId); break
    case 'project':      await db.projects.delete(entityId);      break
  }
}

async function updateSyncMeta(
  entityType: SyncEntityType,
  entityId: string,
  newRevision: number,
  serverUpdatedAt: string | undefined,
): Promise<void> {
  const db     = getOfflineDB()
  const update = {
    syncStatus:     'synced' as const,
    serverRevision: newRevision,
    lastSyncedAt:   nowIso(),
    ...(serverUpdatedAt ? { updatedAt: serverUpdatedAt } : {}),
  }
  switch (entityType) {
    case 'note':         await db.notes.update(entityId, update);         break
    case 'task':         await db.tasks.update(entityId, update);         break
    case 'habit':        await db.habits.update(entityId, update);        break
    case 'habitLog':     await db.habitLogs.update(entityId, update);     break
    case 'expense':      await db.expenses.update(entityId, update);      break
    case 'subscription': await db.subscriptions.update(entityId, update); break
    case 'project':      await db.projects.update(entityId, update);      break
  }
}

async function markEntityFailed(
  entityType: SyncEntityType,
  entityId: string,
  reason: string,
): Promise<void> {
  const db     = getOfflineDB()
  const update = { syncStatus: 'sync_failed' as const, lastError: reason.slice(0, 200) }
  switch (entityType) {
    case 'note':         await db.notes.update(entityId, update);         break
    case 'task':         await db.tasks.update(entityId, update);         break
    case 'habit':        await db.habits.update(entityId, update);        break
    case 'habitLog':     await db.habitLogs.update(entityId, update);     break
    case 'expense':      await db.expenses.update(entityId, update);      break
    case 'subscription': await db.subscriptions.update(entityId, update); break
    case 'project':      await db.projects.update(entityId, update);      break
  }
}

async function markEntityConflict(
  entityType: SyncEntityType,
  entityId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serverData: Record<string, any>,
): Promise<void> {
  const db     = getOfflineDB()
  const update = { syncStatus: 'conflict' as const, conflictServerData: serverData }
  switch (entityType) {
    case 'note':         await db.notes.update(entityId, update);         break
    case 'task':         await db.tasks.update(entityId, update);         break
    case 'habit':        await db.habits.update(entityId, update);        break
    case 'habitLog':     await db.habitLogs.update(entityId, update);     break
    case 'expense':      await db.expenses.update(entityId, update);      break
    case 'subscription': await db.subscriptions.update(entityId, update); break
    case 'project':      await db.projects.update(entityId, update);      break
  }
}

/**
 * Replace a client-generated "local_xxx" ID with the real server ID.
 * This must update both the entity record and any outbox entries that
 * reference the old local ID.
 */
async function replaceLocalId(
  db: ReturnType<typeof getOfflineDB>,
  entityType: SyncEntityType,
  localId: string,
  serverId: string,
  newRevision: number,
  serverUpdatedAt: string | undefined,
): Promise<void> {
  const meta = {
    _id:            serverId,
    syncStatus:     'synced' as const,
    serverRevision: newRevision,
    lastSyncedAt:   nowIso(),
    ...(serverUpdatedAt ? { updatedAt: serverUpdatedAt } : {}),
  }

  switch (entityType) {
    case 'note': {
      const rec = await db.notes.get(localId)
      if (rec) {
        await db.notes.delete(localId)
        await db.notes.put({ ...rec, ...meta })
      }
      break
    }
    case 'task': {
      const rec = await db.tasks.get(localId)
      if (rec) {
        await db.tasks.delete(localId)
        await db.tasks.put({ ...rec, ...meta })
      }
      break
    }
    case 'habit': {
      const rec = await db.habits.get(localId)
      if (rec) {
        await db.habits.delete(localId)
        await db.habits.put({ ...rec, ...meta })
      }
      break
    }
    case 'expense': {
      const rec = await db.expenses.get(localId)
      if (rec) {
        await db.expenses.delete(localId)
        await db.expenses.put({ ...rec, ...meta })
      }
      break
    }
    case 'subscription': {
      const rec = await db.subscriptions.get(localId)
      if (rec) {
        await db.subscriptions.delete(localId)
        await db.subscriptions.put({ ...rec, ...meta })
      }
      break
    }
    case 'project': {
      const rec = await db.projects.get(localId)
      if (rec) {
        await db.projects.delete(localId)
        await db.projects.put({ ...rec, ...meta })
      }
      break
    }
    default: break
  }

  // Update any remaining outbox entries that still reference the old local ID
  await db.outbox
    .where('entityId')
    .equals(localId)
    .modify({ entityId: serverId })
}

// ─── State helpers ─────────────────────────────────────────────────────────────

async function refreshPendingCount(userId: string): Promise<void> {
  const pendingCount = await countOperations(userId)
  emitState({ pendingCount })
}

async function countConflicts(userId: string): Promise<number> {
  const db = getOfflineDB()
  return db.conflicts
    .where('[clientUserId+resolution]')
    .equals([userId, 'pending'])
    .count()
}

function emitState(partial: Partial<SyncState>): void {
  _state = { ..._state, ...partial }
  for (const listener of _listeners) {
    try { listener({ ..._state }) } catch { /* never crash */ }
  }
}

// ─── Event binding ────────────────────────────────────────────────────────────

function handleOnline() {
  emitState({ online: true })
  if (_currentUserId) void triggerSync(_currentUserId)
}

function handleOffline() {
  emitState({ online: false, phase: 'idle' })
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible' && _currentUserId) {
    void triggerSync(_currentUserId)
  }
}

function handleFocus() {
  if (_currentUserId) void triggerSync(_currentUserId)
}

function bindEvents(): void {
  if (_eventsBound || typeof window === 'undefined') return
  _eventsBound = true
  window.addEventListener('online',  handleOnline)
  window.addEventListener('offline', handleOffline)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('focus', handleFocus)
}

function unbindEvents(): void {
  if (!_eventsBound || typeof window === 'undefined') return
  _eventsBound = false
  window.removeEventListener('online',  handleOnline)
  window.removeEventListener('offline', handleOffline)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('focus', handleFocus)
}
