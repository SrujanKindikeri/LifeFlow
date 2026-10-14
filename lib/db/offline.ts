/**
 * lib/db/offline.ts — LifeFlow offline IndexedDB database via Dexie 4.
 *
 * DATABASE DESIGN
 * ───────────────
 * One Dexie database: "lifeflow_offline"
 * All tables are partitioned by clientUserId so multiple accounts on the same
 * browser device never mix data. The clientUserId comes from the server-issued
 * session (iron-session) and is stored at login time.
 *
 * SECURITY
 * ────────
 * • No passwords, tokens, or session secrets are ever written to IndexedDB.
 * • All records are scoped by clientUserId — a different user opening the app
 *   on the same device cannot read another user's records (browser same-origin
 *   policy + clientUserId filtering in every query).
 * • Authenticated API responses are NOT cached in the service worker.
 *   IndexedDB is the only persistent client store for user data.
 *
 * VERSIONING
 * ──────────
 * Increment the version number when adding/removing stores or indexes.
 * Never remove or rename a store without a migration (upgrade function).
 * All existing data is preserved across version upgrades.
 *
 * NEVER import this file in server-side code (API routes, server components).
 * It uses browser-only APIs (IndexedDB). Use the 'use client' pattern or
 * dynamic import with { ssr: false } when consuming this from React components.
 */

import Dexie, { type EntityTable } from 'dexie'
import type {
  LocalNote,
  LocalTask,
  LocalHabit,
  LocalHabitLog,
  LocalExpense,
  LocalSubscription,
  LocalProject,
  OutboxOperation,
  SyncCursor,
  ConflictRecord,
} from '@/types/sync'

// ─── Database class ───────────────────────────────────────────────────────────

export class LifeFlowOfflineDB extends Dexie {
  // Entity stores
  notes!:         EntityTable<LocalNote,         '_id'>
  tasks!:         EntityTable<LocalTask,         '_id'>
  habits!:        EntityTable<LocalHabit,        '_id'>
  habitLogs!:     EntityTable<LocalHabitLog,     '_id'>
  expenses!:      EntityTable<LocalExpense,      '_id'>
  subscriptions!: EntityTable<LocalSubscription, '_id'>
  projects!:      EntityTable<LocalProject,      '_id'>

  // Sync infrastructure
  outbox!:    EntityTable<OutboxOperation, 'id'>
  cursors!:   EntityTable<SyncCursor,      'id'>
  conflicts!: EntityTable<ConflictRecord,  'id'>

  constructor() {
    super('lifeflow_offline')

    this.version(1).stores({
      // ── Entity stores ─────────────────────────────────────────────────────
      // Primary key + compound indexes for efficient per-user queries.
      // clientUserId is always the first field in compound indexes so Dexie
      // can use a range query to isolate one account's data.
      //
      // Syntax: 'primaryKey, index1, index2, [compound+index]'
      // Prefix & for unique, ++ for auto-increment, * for multi-valued index.

      notes:         '_id, clientUserId, [clientUserId+syncStatus], [clientUserId+updatedAt], [clientUserId+pinned+updatedAt]',
      tasks:         '_id, clientUserId, [clientUserId+syncStatus], [clientUserId+updatedAt], [clientUserId+completed+dueDate]',
      habits:        '_id, clientUserId, [clientUserId+syncStatus], [clientUserId+updatedAt]',
      habitLogs:     '_id, clientUserId, [clientUserId+habitId+date], [clientUserId+date], [clientUserId+syncStatus]',
      expenses:      '_id, clientUserId, [clientUserId+syncStatus], [clientUserId+date], [clientUserId+category+date]',
      subscriptions: '_id, clientUserId, [clientUserId+syncStatus], [clientUserId+status+nextBillingDate]',
      projects:      '_id, clientUserId, [clientUserId+syncStatus], [clientUserId+status+updatedAt]',

      // ── Outbox ────────────────────────────────────────────────────────────
      // ++id  = auto-increment primary key (operations are ordered by insertion)
      // mutationId has a unique index to prevent duplicate entries
      // retryAfter index lets the engine query "operations ready to retry"
      outbox: '++id, &mutationId, clientUserId, [clientUserId+entityType], retryAfter',

      // ── Sync cursors ──────────────────────────────────────────────────────
      // id = composite `${clientUserId}:${entityType}` — set by application code
      cursors: 'id, clientUserId',

      // ── Conflict records ──────────────────────────────────────────────────
      conflicts: '++id, clientUserId, [clientUserId+entityType], [clientUserId+resolution], entityId',
    })
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _db: LifeFlowOfflineDB | null = null

/**
 * Return the singleton Dexie database instance.
 * Safe to call multiple times — Dexie opens the connection lazily on first use.
 * Guard with typeof window !== 'undefined' before calling from server-capable code.
 */
export function getOfflineDB(): LifeFlowOfflineDB {
  if (!_db) {
    _db = new LifeFlowOfflineDB()
  }
  return _db
}

// ─── Utility: per-user store helpers ─────────────────────────────────────────

/**
 * Return a Dexie Collection scoped to a single user's records.
 * Pass this collection directly to .toArray(), .count(), .sortBy(), etc.
 *
 * @example
 *   const notes = await userRecords(db.notes, userId).toArray()
 */
export function userRecords<T>(
  table: EntityTable<T, keyof T>,
  clientUserId: string,
) {
  return (table as Dexie.Table<T>).where('clientUserId').equals(clientUserId)
}

// ─── Utility: wipe a user's data from all tables ─────────────────────────────

/**
 * Delete ALL locally stored records belonging to userId from every table.
 *
 * Called on:
 *  - Logout (after the user confirms they want to clear local data)
 *  - Account switch (to prevent cross-account data leakage)
 *
 * This is irreversible for records not yet synced to the server.
 * The caller (account-guard.ts) is responsible for warning the user if there
 * are pending operations before calling this function.
 */
export async function clearUserData(clientUserId: string): Promise<void> {
  const db = getOfflineDB()

  await db.transaction(
    'rw',
    [
      db.notes, db.tasks, db.habits, db.habitLogs,
      db.expenses, db.subscriptions, db.projects,
      db.outbox, db.cursors, db.conflicts,
    ],
    async () => {
      await Promise.all([
        db.notes.where('clientUserId').equals(clientUserId).delete(),
        db.tasks.where('clientUserId').equals(clientUserId).delete(),
        db.habits.where('clientUserId').equals(clientUserId).delete(),
        db.habitLogs.where('clientUserId').equals(clientUserId).delete(),
        db.expenses.where('clientUserId').equals(clientUserId).delete(),
        db.subscriptions.where('clientUserId').equals(clientUserId).delete(),
        db.projects.where('clientUserId').equals(clientUserId).delete(),
        db.outbox.where('clientUserId').equals(clientUserId).delete(),
        db.cursors.where('clientUserId').equals(clientUserId).delete(),
        db.conflicts.where('clientUserId').equals(clientUserId).delete(),
      ])
    }
  )
}

/**
 * Count pending outbox operations for a given user.
 * Used by the logout route and sync status UI.
 */
export async function countPendingOps(clientUserId: string): Promise<number> {
  const db = getOfflineDB()
  return db.outbox.where('clientUserId').equals(clientUserId).count()
}
