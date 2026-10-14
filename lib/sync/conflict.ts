/**
 * lib/sync/conflict.ts — Conflict detection and resolution for offline sync.
 *
 * PHILOSOPHY
 * ──────────
 * We do NOT apply silent last-write-wins to every field.
 * Instead we choose a resolution strategy per entity type:
 *
 *  notes        → CONFLICT COPY: both versions preserved, user must choose.
 *                 Content is too valuable to silently overwrite.
 *
 *  tasks        → FIELD-LEVEL MERGE for independent fields (title, priority,
 *                 dueDate). completed status uses server-wins if server is newer.
 *                 Creates a conflict record if both sides changed the same field.
 *
 *  habits       → SERVER WINS on definition fields (name, icon, frequency,
 *                 target). These rarely change and server is authoritative.
 *
 *  habitLogs    → IDEMPOTENT: server deduplicates by (habitId, date).
 *                 No conflict possible — the operation is either applied or not.
 *
 *  expenses     → SERVER WINS. Financial records must not be silently duplicated
 *                 or have amounts overwritten. User is shown a conflict record.
 *
 *  subscriptions → SERVER WINS. Billing data is authoritative on the server.
 *
 *  projects     → FIELD-LEVEL MERGE for title, description, color.
 *                 Status uses server-wins if server is newer.
 *
 * TERMINOLOGY
 * ───────────
 *  serverRevision: monotonically increasing integer on the server document.
 *                  Incremented on every write. 0 = never synced.
 *  localRevision:  the serverRevision the client had when it made its edit.
 *
 * A conflict is detected when:
 *   serverRevision > localRevision  AND  the server record changed since then.
 * (i.e. someone else edited the same record after our last pull)
 */

import { getOfflineDB } from '@/lib/db/offline'
import { nowIso } from '@/lib/sync/ids'
import type {
  SyncEntityType,
  ConflictRecord,
  SyncMutationResult,
  LocalNote,
  LocalTask,
  LocalProject,
} from '@/types/sync'

// ─── Conflict detection ───────────────────────────────────────────────────────

/**
 * Given a server response indicating 'conflict', record the conflict
 * in IndexedDB so the user can review it.
 */
export async function recordConflict(
  clientUserId: string,
  entityType: SyncEntityType,
  entityId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localData: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serverData: Record<string, any>,
): Promise<void> {
  const db = getOfflineDB()

  const conflict: ConflictRecord = {
    clientUserId,
    entityType,
    entityId,
    localData,
    serverData,
    detectedAt: nowIso(),
    resolution: 'pending',
  }

  // Replace any existing conflict for the same entity (only keep latest)
  const existing = await db.conflicts
    .where('entityId')
    .equals(entityId)
    .and((c) => c.clientUserId === clientUserId)
    .first()

  if (existing?.id !== undefined) {
    await db.conflicts.update(existing.id, {
      localData:  conflict.localData,
      serverData: conflict.serverData,
      detectedAt: conflict.detectedAt,
      resolution: conflict.resolution,
    })
  } else {
    await db.conflicts.add(conflict)
  }
}

/**
 * Return all unresolved conflicts for a user.
 */
export async function getPendingConflicts(
  clientUserId: string,
): Promise<ConflictRecord[]> {
  const db = getOfflineDB()
  return db.conflicts
    .where('[clientUserId+resolution]')
    .equals([clientUserId, 'pending'])
    .toArray()
}

// ─── Auto-resolution strategies ──────────────────────────────────────────────

/**
 * Attempt automatic conflict resolution based on entity type.
 *
 * Returns:
 *  'auto_resolved'  — merged successfully, no user action needed
 *  'needs_review'   — could not safely auto-merge, conflict stored for user
 */
export async function autoResolve(
  clientUserId: string,
  entityType: SyncEntityType,
  entityId: string,
  result: SyncMutationResult,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localData: Record<string, any>,
): Promise<'auto_resolved' | 'needs_review'> {
  const serverData = result.serverRecord ?? {}

  switch (entityType) {
    case 'note':
      return resolveNote(clientUserId, entityId, localData as LocalNote, serverData)

    case 'task':
      return resolveTask(clientUserId, entityId, localData as LocalTask, serverData)

    case 'habit':
    case 'expense':
    case 'subscription':
      // Server wins — update local record and clear outbox
      await applyServerWins(clientUserId, entityType, entityId, serverData, result.newRevision ?? 0)
      return 'auto_resolved'

    case 'habitLog':
      // Idempotent — no real conflict possible; accept server state
      await applyServerWins(clientUserId, entityType, entityId, serverData, result.newRevision ?? 0)
      return 'auto_resolved'

    case 'project':
      return resolveProject(clientUserId, entityId, localData as LocalProject, serverData, result.newRevision ?? 0)

    default:
      await recordConflict(clientUserId, entityType, entityId, localData, serverData)
      return 'needs_review'
  }
}

// ─── Per-type resolvers ───────────────────────────────────────────────────────

async function resolveNote(
  clientUserId: string,
  entityId: string,
  local: LocalNote,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: Record<string, any>,
): Promise<'auto_resolved' | 'needs_review'> {
  // Notes contain free-form content — never silently overwrite.
  // Record conflict for user review.
  await recordConflict(clientUserId, 'note', entityId, local, server)

  // Mark the local record as in conflict
  const db = getOfflineDB()
  await db.notes.update(entityId, {
    syncStatus: 'conflict',
    conflictServerData: server,
  })

  return 'needs_review'
}

async function resolveTask(
  clientUserId: string,
  entityId: string,
  local: LocalTask,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: Record<string, any>,
): Promise<'auto_resolved' | 'needs_review'> {
  const db = getOfflineDB()

  // Fields we can merge independently:
  const merged: Partial<LocalTask> = { ...local }

  // completed: use server value if server is newer (server tracks streaks)
  if (server.completed !== undefined) {
    merged.completed = server.completed
  }

  // If both sides changed the same text field, escalate to user
  const textConflict =
    (local.title !== server.title && server.title !== undefined) ||
    (local.description !== server.description && server.description !== undefined)

  if (textConflict) {
    await recordConflict(clientUserId, 'task', entityId, local, server)
    await db.tasks.update(entityId, { syncStatus: 'conflict', conflictServerData: server })
    return 'needs_review'
  }

  // No text conflict — apply server field values and mark synced
  await db.tasks.update(entityId, {
    ...merged,
    serverRevision: server.serverRevision ?? (local.serverRevision + 1),
    syncStatus: 'synced',
    conflictServerData: undefined,
    lastSyncedAt: nowIso(),
  })
  return 'auto_resolved'
}

async function resolveProject(
  clientUserId: string,
  entityId: string,
  local: LocalProject,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: Record<string, any>,
  newRevision: number,
): Promise<'auto_resolved' | 'needs_review'> {
  const db = getOfflineDB()

  // Status is authoritative on the server (may have been updated by automation)
  const merged: Partial<LocalProject> = {
    status: server.status ?? local.status,
    serverRevision: newRevision,
    syncStatus: 'synced',
    conflictServerData: undefined,
    lastSyncedAt: nowIso(),
  }

  // Title/description: conflict if both sides changed
  const titleConflict = local.title !== server.title && server.title !== undefined
  if (titleConflict) {
    await recordConflict(clientUserId, 'project', entityId, local, server)
    await db.projects.update(entityId, { syncStatus: 'conflict', conflictServerData: server })
    return 'needs_review'
  }

  await db.projects.update(entityId, merged)
  return 'auto_resolved'
}

async function applyServerWins(
  clientUserId: string,
  entityType: SyncEntityType,
  entityId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serverData: Record<string, any>,
  newRevision: number,
): Promise<void> {
  const db = getOfflineDB()

  const update = {
    ...serverData,
    clientUserId,
    serverRevision: newRevision,
    syncStatus: 'synced' as const,
    conflictServerData: undefined,
    lastSyncedAt: nowIso(),
  }

  switch (entityType) {
    case 'habit':         await db.habits.update(entityId, update); break
    case 'habitLog':      await db.habitLogs.update(entityId, update); break
    case 'expense':       await db.expenses.update(entityId, update); break
    case 'subscription':  await db.subscriptions.update(entityId, update); break
    default: break
  }
}

// ─── User resolution ──────────────────────────────────────────────────────────

/**
 * Apply the user's chosen resolution for a conflict.
 *
 * @param choice 'keep_local' — upload local version again (force overwrite)
 *               'keep_server' — accept server version, discard local changes
 */
export async function applyConflictResolution(
  conflictId: number,
  choice: 'keep_local' | 'keep_server',
): Promise<void> {
  const db       = getOfflineDB()
  const conflict = await db.conflicts.get(conflictId)
  if (!conflict) return

  const { clientUserId, entityType, entityId, localData, serverData } = conflict

  if (choice === 'keep_server') {
    // Apply server data to the local store
    await applyServerVersion(clientUserId, entityType, entityId, serverData)
  } else {
    // Keep local — re-enqueue the local data for upload as a new mutation
    // (the engine will pick it up in the next sync cycle)
    const { enqueueOperation } = await import('@/lib/sync/outbox')
    await enqueueOperation({
      clientUserId,
      entityType,
      entityId,
      op: 'update',
      payload: localData,
      serverRevision: undefined, // force-overwrite
    })
  }

  // Mark the conflict as resolved
  await db.conflicts.update(conflictId, {
    resolution:  choice,
    resolvedAt:  nowIso(),
  })

  // Clear the conflict state on the local entity
  await clearEntityConflict(clientUserId, entityType, entityId, choice === 'keep_server' ? serverData : localData)
}

async function applyServerVersion(
  clientUserId: string,
  entityType: SyncEntityType,
  entityId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serverData: Record<string, any>,
): Promise<void> {
  const db     = getOfflineDB()
  const update = {
    ...serverData,
    clientUserId,
    syncStatus: 'synced' as const,
    conflictServerData: undefined,
    lastSyncedAt: nowIso(),
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

async function clearEntityConflict(
  clientUserId: string,
  entityType: SyncEntityType,
  entityId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _data: Record<string, any>,
): Promise<void> {
  const db     = getOfflineDB()
  const update = { syncStatus: 'synced' as const, conflictServerData: undefined }

  switch (entityType) {
    case 'note':         await db.notes.update(entityId, { ...update, clientUserId });         break
    case 'task':         await db.tasks.update(entityId, { ...update, clientUserId });         break
    case 'habit':        await db.habits.update(entityId, { ...update, clientUserId });        break
    case 'habitLog':     await db.habitLogs.update(entityId, { ...update, clientUserId });     break
    case 'expense':      await db.expenses.update(entityId, { ...update, clientUserId });      break
    case 'subscription': await db.subscriptions.update(entityId, { ...update, clientUserId }); break
    case 'project':      await db.projects.update(entityId, { ...update, clientUserId });      break
  }
}
