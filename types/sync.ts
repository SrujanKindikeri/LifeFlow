/**
 * types/sync.ts — All TypeScript types for LifeFlow's offline-first sync layer.
 *
 * These types are shared between:
 *  - The Dexie IndexedDB schema (lib/db/offline.ts)
 *  - The outbox and sync engine (lib/sync/)
 *  - The sync API routes (app/api/sync/)
 *  - The sync UI hooks and components (hooks/useSync.ts, components/sync/)
 *
 * SECURITY NOTE
 * ─────────────
 * clientUserId in local records is the server-issued userId from the session.
 * It is NEVER trusted by the server — every sync endpoint re-derives userId
 * from the iron-session cookie via requireAuth().
 * clientUserId is used only to scope IndexedDB data per account in the browser.
 */

// ─── Entity types supported for offline sync ─────────────────────────────────

export type SyncEntityType =
  | 'note'
  | 'task'
  | 'habit'
  | 'habitLog'
  | 'expense'
  | 'subscription'
  | 'project'

// ─── Mutation operations ──────────────────────────────────────────────────────

export type MutationOp = 'create' | 'update' | 'delete'

// ─── Sync status for a local record ──────────────────────────────────────────

/**
 * Per-record synchronisation state.
 *
 * saved_locally   — written to IndexedDB; not yet attempted to sync
 * pending_sync    — in outbox, waiting for the next sync cycle
 * syncing         — currently being uploaded in this sync run
 * synced          — server acknowledged this record version
 * conflict        — server and local diverged; manual review needed
 * sync_failed     — last sync attempt failed; will retry with backoff
 */
export type SyncStatus =
  | 'saved_locally'
  | 'pending_sync'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'sync_failed'

// ─── Outbox operation ─────────────────────────────────────────────────────────

/**
 * A durable pending mutation stored in IndexedDB until the server confirms it.
 *
 * IMPORTANT: payload must NEVER contain passwords, tokens, or session secrets.
 * Only plain entity data fields allowed.
 */
export interface OutboxOperation {
  /** Auto-incremented IndexedDB primary key */
  id?: number

  /** Stable mutation ID — used as idempotency key on the server */
  mutationId: string

  /** The authenticated userId this operation belongs to */
  clientUserId: string

  /** Which entity type is being mutated */
  entityType: SyncEntityType

  /** The entity's stable client-generated ID (or server _id after first sync) */
  entityId: string

  /** create | update | delete */
  op: MutationOp

  /**
   * Snapshot of the entity fields at the time of mutation.
   * For delete: { _id: string } only.
   * Server validates and re-authorises every field; client payload is untrusted.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>

  /** ISO timestamp when this operation was enqueued */
  enqueuedAt: string

  /** Number of failed upload attempts so far */
  attempts: number

  /** ISO timestamp of the next allowed retry (exponential backoff) */
  retryAfter: string

  /**
   * Last error message from the server or network.
   * Truncated to 500 chars; never exposes secrets.
   */
  lastError?: string

  /**
   * Server revision/version of the entity at the time this mutation
   * was created locally. Used for optimistic concurrency checks on the server.
   * undefined for creates.
   */
  serverRevision?: number
}

// ─── Sync metadata ────────────────────────────────────────────────────────────

/**
 * Stores per-entity-type sync cursors and timestamps.
 * One row per entity type per user.
 */
export interface SyncCursor {
  /** Composite key: `${clientUserId}:${entityType}` */
  id: string
  clientUserId: string
  entityType: SyncEntityType

  /**
   * The updatedAt ISO timestamp of the last record we successfully pulled.
   * On the next pull we send `?since=<cursor>` to get only newer records.
   */
  lastPulledAt: string | null

  /** ISO timestamp of the last successful push cycle */
  lastPushedAt: string | null
}

// ─── Local entity base ────────────────────────────────────────────────────────

/**
 * Fields added to every locally-stored entity beyond its server fields.
 */
export interface LocalEntityMeta {
  /** The authenticated userId who owns this record in this browser */
  clientUserId: string

  /** Current sync state of this record */
  syncStatus: SyncStatus

  /**
   * Server-side revision counter.
   * Incremented by the server on every successful write.
   * Used to detect stale-write conflicts.
   * 0 for records that have never been synced.
   */
  serverRevision: number

  /**
   * The mutationId of the last locally-initiated operation.
   * Allows the sync engine to match server responses back to outbox entries.
   */
  lastMutationId?: string

  /**
   * If syncStatus === 'conflict', this holds the server's version of the record
   * at the time the conflict was detected. The user can review and resolve.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conflictServerData?: Record<string, any>

  /** ISO timestamp of the last successful sync for this record */
  lastSyncedAt?: string

  /**
   * Tombstone flag. true = this record has been locally deleted but the
   * deletion has not yet been confirmed by the server.
   */
  deleted?: boolean
}

// ─── Per-entity local store types ────────────────────────────────────────────

export interface LocalNote extends LocalEntityMeta {
  _id: string
  userId: string
  title: string
  content: string
  tags: string[]
  pinned: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface LocalTask extends LocalEntityMeta {
  _id: string
  userId: string
  title: string
  description?: string
  completed: boolean
  priority: 'low' | 'medium' | 'high'
  dueDate?: string
  dueTime?: string
  recurring: 'none' | 'daily' | 'weekly' | 'monthly'
  createdAt: string
  updatedAt: string
}

export interface LocalHabit extends LocalEntityMeta {
  _id: string
  userId: string
  name: string
  icon: string
  description?: string
  frequency: 'daily' | 'weekly'
  target: number
  createdAt: string
  updatedAt: string
}

export interface LocalHabitLog extends LocalEntityMeta {
  _id: string
  userId: string
  habitId: string
  date: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

export interface LocalExpense extends LocalEntityMeta {
  _id: string
  userId: string
  amount: number
  category: string
  description?: string
  date: string
  paymentMethod?: string
  source: 'personal' | 'group_bill' | 'subscription'
  createdAt: string
  updatedAt: string
}

export interface LocalSubscription extends LocalEntityMeta {
  _id: string
  userId: string
  serviceName: string
  amountMinor: number
  amount: number
  currency: string
  billingCycle: string
  customIntervalDays?: number
  nextBillingDate: string
  lastBillingDate?: string | null
  category: string
  paymentMethod?: string
  status: 'active' | 'paused' | 'cancelled'
  autoCreateExpense: boolean
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface LocalProject extends LocalEntityMeta {
  _id: string
  userId: string
  title: string
  description?: string
  status: 'active' | 'on_hold' | 'completed' | 'archived'
  dueDate?: string
  color: string
  taskCount?: number
  completedTaskCount?: number
  noteCount?: number
  createdAt: string
  updatedAt: string
}

// ─── Conflict record ──────────────────────────────────────────────────────────

/**
 * A conflict that requires manual user resolution.
 * Written to the conflicts IndexedDB store.
 */
export interface ConflictRecord {
  /** Auto-incremented IndexedDB primary key */
  id?: number
  clientUserId: string
  entityType: SyncEntityType
  entityId: string
  /** The local version at the time the conflict was detected */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localData: Record<string, any>
  /** The server version that conflicted */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serverData: Record<string, any>
  detectedAt: string
  /** 'pending' = user has not yet resolved | 'resolved' = user chose a version */
  resolution: 'pending' | 'keep_local' | 'keep_server' | 'merged'
  resolvedAt?: string
}

// ─── Sync engine state ────────────────────────────────────────────────────────

export type SyncPhase =
  | 'idle'
  | 'pushing'
  | 'pulling'
  | 'error'

export interface SyncState {
  /** Whether the browser currently has network connectivity */
  online: boolean
  /** Current sync cycle phase */
  phase: SyncPhase
  /** Number of operations in the outbox waiting to be uploaded */
  pendingCount: number
  /** ISO timestamp of the last completely successful sync cycle */
  lastSyncedAt: string | null
  /** Last error message if phase === 'error' */
  lastError: string | null
  /** Number of unresolved conflicts */
  conflictCount: number
}

// ─── API types — shared between client and server ────────────────────────────

/**
 * A single mutation sent from the client to POST /api/sync.
 */
export interface SyncMutation {
  mutationId: string
  entityType: SyncEntityType
  entityId: string
  op: MutationOp
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>
  /** Client-side serverRevision at the time of mutation (for conflict detection) */
  serverRevision?: number
}

/**
 * Per-operation result returned by POST /api/sync.
 */
export interface SyncMutationResult {
  mutationId: string
  entityId: string
  status: 'accepted' | 'rejected' | 'conflict' | 'retryable'
  /** If accepted, the server-assigned _id (useful for creates where client used a temp ID) */
  serverId?: string
  /** New server revision after the write */
  newRevision?: number
  /** ISO timestamp of the server-side updatedAt */
  serverUpdatedAt?: string
  /** Human-readable reason for rejection or conflict */
  reason?: string
  /**
   * For conflicts: the current server record so the client can display a
   * side-by-side review. Only present when status === 'conflict'.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serverRecord?: Record<string, any>
}

/**
 * Response body from POST /api/sync.
 */
export interface SyncPushResponse {
  results: SyncMutationResult[]
}

/**
 * Response body from GET /api/sync/pull.
 */
export interface SyncPullResponse {
  entityType: SyncEntityType
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  records: Array<Record<string, any>>
  /**
   * The updatedAt of the most recent record returned.
   * The client stores this as the new cursor for the next pull.
   */
  cursor: string | null
  hasMore: boolean
}
