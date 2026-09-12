/**
 * lib/db/indexes.ts — Ensure MongoDB indexes for all LifeFlow collections.
 *
 * Call ensureIndexes() once at application startup (or from a migration script).
 * It is idempotent — safe to call on every cold start. MongoDB only creates
 * indexes that don't already exist.
 *
 * Index strategy:
 *   - Every user-owned collection has a compound index on (userId, <sort field>)
 *     so queries are covered without a collection scan.
 *   - Unique indexes enforce data integrity at the DB layer (belt + suspenders
 *     alongside application-level checks).
 *   - Sparse indexes are used where the field is optional so null values don't
 *     consume index space.
 *
 * Usage:
 *   import { ensureIndexes } from '@/lib/db/indexes'
 *   await ensureIndexes()   // call after connectDB()
 */

import mongoose from 'mongoose'
import type { CreateIndexesOptions } from 'mongodb'
import { connectDB } from '@/lib/db'
import logger from '@/lib/logger'

// ─── Index definitions ────────────────────────────────────────────────────────

interface IndexSpec {
  collection: string
  indexes: Array<{
    key: Record<string, 1 | -1 | 'text'>
    options?: CreateIndexesOptions
  }>
}

const INDEX_SPECS: IndexSpec[] = [
  // ── User ─────────────────────────────────────────────────────────────────
  {
    collection: 'users',
    indexes: [
      { key: { email: 1 },    options: { unique: true } },
      { key: { publicId: 1 }, options: { unique: true, sparse: true } },
    ],
  },

  // ── Tasks ─────────────────────────────────────────────────────────────────
  {
    collection: 'tasks',
    indexes: [
      { key: { userId: 1, createdAt: -1 } },
      { key: { userId: 1, dueDate: 1 } },
      { key: { userId: 1, completed: 1, dueDate: 1 } },
      { key: { userId: 1, projectId: 1 }, options: { sparse: true } },
      { key: { lifeFlowId: 1, createdAt: -1 } },
    ],
  },

  // ── Habits ────────────────────────────────────────────────────────────────
  {
    collection: 'habits',
    indexes: [
      { key: { userId: 1, createdAt: -1 } },
      { key: { lifeFlowId: 1 } },
    ],
  },

  // ── HabitLogs ─────────────────────────────────────────────────────────────
  {
    collection: 'habitlogs',
    indexes: [
      // Prevent duplicate log entries for the same habit+date
      { key: { userId: 1, habitId: 1, date: 1 }, options: { unique: true } },
      { key: { userId: 1, date: 1 } },
      { key: { lifeFlowId: 1, date: 1 } },
    ],
  },

  // ── Notes ─────────────────────────────────────────────────────────────────
  {
    collection: 'notes',
    indexes: [
      { key: { userId: 1, createdAt: -1 } },
      { key: { userId: 1, pinned: -1, createdAt: -1 } },
      { key: { userId: 1, archived: 1, createdAt: -1 } },
      { key: { userId: 1, projectId: 1 }, options: { sparse: true } },
      { key: { lifeFlowId: 1, createdAt: -1 } },
    ],
  },

  // ── Expenses ─────────────────────────────────────────────────────────────
  {
    collection: 'expenses',
    indexes: [
      { key: { userId: 1, date: -1 } },
      { key: { userId: 1, category: 1, date: -1 } },
      { key: { userId: 1, source: 1, date: -1 } },
      { key: { userId: 1, createdAt: -1 } },
      { key: { lifeFlowId: 1, date: -1 } },
      // Idempotency index: prevents duplicate subscription-generated expenses.
      // A duplicate insert (E11000) is caught and silently swallowed by the scheduler.
      {
        key:     { sourceSubscriptionId: 1, subscriptionBillingDate: 1 },
        options: { unique: true, sparse: true },
      },
    ],
  },

  // ── TransactionProof ─────────────────────────────────────────────────────
  {
    collection: 'transactionproofs',
    indexes: [
      { key: { userId: 1, createdAt: -1 } },
      // Ownership lookup when serving proof images
      { key: { _id: 1, userId: 1 } },
      { key: { lifeFlowId: 1 } },
    ],
  },

  // ── Subscriptions ────────────────────────────────────────────────────────
  {
    collection: 'subscriptions',
    indexes: [
      { key: { userId: 1, status: 1, nextBillingDate: 1 } },
      { key: { userId: 1, createdAt: -1 } },
      // Scheduler query: active subs with autoCreateExpense=true due today
      { key: { status: 1, autoCreateExpense: 1, nextBillingDate: 1 } },
      { key: { lifeFlowId: 1 } },
    ],
  },

  // ── GroupBills ───────────────────────────────────────────────────────────
  {
    collection: 'groupbills',
    indexes: [
      { key: { userId: 1, createdAt: -1 } },
      { key: { userId: 1, date: -1 } },
      { key: { lifeFlowId: 1, date: -1 } },
    ],
  },

  // ── Budgets ──────────────────────────────────────────────────────────────
  {
    collection: 'budgets',
    indexes: [
      { key: { userId: 1, month: 1, category: 1 }, options: { unique: true } },
      { key: { userId: 1, month: -1 } },
      { key: { lifeFlowId: 1, month: -1 } },
    ],
  },

  // ── Goals ────────────────────────────────────────────────────────────────
  {
    collection: 'goals',
    indexes: [
      { key: { userId: 1, status: 1, targetDate: 1 } },
      { key: { userId: 1, createdAt: -1 } },
      { key: { lifeFlowId: 1 } },
    ],
  },

  // ── Projects ─────────────────────────────────────────────────────────────
  {
    collection: 'projects',
    indexes: [
      { key: { userId: 1, status: 1, dueDate: 1 } },
      { key: { userId: 1, createdAt: -1 } },
      { key: { lifeFlowId: 1 } },
    ],
  },

  // ── MoneyRecords ─────────────────────────────────────────────────────────
  {
    collection: 'moneyrecords',
    indexes: [
      { key: { userId: 1, status: 1, createdAt: -1 } },
      { key: { userId: 1, direction: 1, status: 1 } },
      { key: { userId: 1, dueDate: 1 }, options: { sparse: true } },
      { key: { lifeFlowId: 1 } },
    ],
  },

  // ── MoneyPayments ────────────────────────────────────────────────────────
  {
    collection: 'moneypayments',
    indexes: [
      { key: { userId: 1, moneyRecordId: 1, paymentDate: -1 } },
      { key: { lifeFlowId: 1 } },
    ],
  },

  // ── SavingsGoals ─────────────────────────────────────────────────────────
  {
    collection: 'savingsgoals',
    indexes: [
      { key: { userId: 1, createdAt: -1 } },
      { key: { lifeFlowId: 1 } },
    ],
  },

  // ── SavingsContributions ─────────────────────────────────────────────────
  {
    collection: 'savingscontributions',
    indexes: [
      { key: { userId: 1, savingsGoalId: 1, date: -1 } },
      { key: { lifeFlowId: 1 } },
    ],
  },

  // ── Notifications ────────────────────────────────────────────────────────
  {
    collection: 'notifications',
    indexes: [
      { key: { userId: 1, read: 1, createdAt: -1 } },
      { key: { userId: 1, createdAt: -1 } },
      { key: { lifeFlowId: 1 } },
    ],
  },

  // ── Activity ─────────────────────────────────────────────────────────────
  {
    collection: 'activities',
    indexes: [
      { key: { userId: 1, createdAt: -1 } },
      { key: { lifeFlowId: 1 } },
    ],
  },

  // ── RecentActivity ───────────────────────────────────────────────────────
  {
    collection: 'recentactivities',
    indexes: [
      { key: { userId: 1, timestamp: -1 } },
      { key: { lifeFlowId: 1 } },
    ],
  },

  // ── DashboardPreferences ─────────────────────────────────────────────────
  {
    collection: 'dashboardpreferences',
    indexes: [
      { key: { userId: 1 }, options: { unique: true } },
      { key: { lifeFlowId: 1 } },
    ],
  },

  // ── People ───────────────────────────────────────────────────────────────
  {
    collection: 'people',
    indexes: [
      { key: { userId: 1, name: 1 } },
      { key: { lifeFlowId: 1 } },
    ],
  },

  // ── Drafts ───────────────────────────────────────────────────────────────
  {
    collection: 'drafts',
    indexes: [
      { key: { userId: 1, type: 1, createdAt: -1 } },
      { key: { lifeFlowId: 1 } },
    ],
  },
]

// ─── Executor ────────────────────────────────────────────────────────────────

/**
 * Create all defined indexes. Safe to call on every cold start — MongoDB
 * skips indexes that already exist (no duplicate key errors, no downtime).
 *
 * Errors for individual indexes are logged but do NOT abort the startup —
 * a missing index degrades performance but does not break functionality.
 */
export async function ensureIndexes(): Promise<void> {
  await connectDB()

  const db = mongoose.connection.db
  if (!db) {
    logger.warn('[indexes] Database not connected — skipping index creation')
    return
  }

  let created = 0
  let skipped = 0
  let errors  = 0

  for (const spec of INDEX_SPECS) {
    const collection = db.collection(spec.collection)

    for (const { key, options } of spec.indexes) {
      try {
        await collection.createIndex(
          key as Record<string, 1 | -1>,
          { background: true, ...options } as CreateIndexesOptions,
        )
        created++
      } catch (err) {
        // Index already exists with different options — log and continue
        if (err instanceof Error && err.message.includes('already exists')) {
          skipped++
        } else {
          errors++
          logger.warn('[indexes] Failed to create index', {
            collection: spec.collection,
            key:        JSON.stringify(key),
            errorMessage: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }
  }

  logger.info('[indexes] Index sync complete', { created, skipped, errors })
}
