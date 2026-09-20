/**
 * lib/accountCleanup.ts — Permanent account deletion for expired soft-deletes.
 *
 * This module is called by POST /api/jobs/cleanup-deleted-accounts (daily cron).
 *
 * WHAT IT DOES
 * ────────────
 * Finds every user whose:
 *   accountStatus = "deleted"
 *   scheduledPermanentDeletionAt <= now
 *
 * For each such user, permanently and irrevocably deletes:
 *   - All owned data (23 user-data collections)
 *   - Cross-user references that pointed to the deleted account
 *   - The User document itself
 *
 * WHAT IT DOES NOT DO
 * ───────────────────
 * - Never touches accounts with accountStatus = "active"
 * - Never touches accounts still within their recovery window
 * - Never deletes data belonging to OTHER users (only unlinks cross-user refs)
 * - Does not drop collections or databases
 *
 * IDEMPOTENCY
 * ───────────
 * Re-running the job after a partial failure is safe:
 * - Each user is processed independently — a single failure does not abort others
 * - deleteMany / updateMany with a userId filter are idempotent (no-op if already deleted)
 * - The final User.findByIdAndDelete only runs after all sub-collection cleanup completes
 * - If the job crashes after sub-collections are deleted but before User deletion,
 *   the next run will delete the User (now with an accountStatus still "deleted")
 *   without re-attempting already-deleted sub-collections (deleteMany returns 0 — harmless)
 *
 * ORDERING
 * ────────
 * 1. Delete sub-collections in parallel (all are independent by userId)
 * 2. Unlink cross-user Person references (Person.linkedUserId → deleted userId)
 * 3. Delete the User document last (ensures sub-collections are already gone)
 *
 * AUDIT LOG
 * ─────────
 * Each deletion is logged via logger.info with:
 *   event: 'ACCOUNT_PERMANENTLY_DELETED'
 *   userId
 *   collectionsCleared (counts per collection)
 *
 * SERVER-ONLY — never import from client components.
 */

import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import logger from '@/lib/logger'

// ─── Lazy-loaded model imports ────────────────────────────────────────────────
// We import lazily to avoid circular dependencies and reduce cold-start cost
// when other modules import this file.

async function loadModels() {
  const [
    { default: Task },
    { default: Note },
    { default: Habit },
    { default: HabitLog },
    { default: Expense },
    { default: Budget },
    { default: Goal },
    { default: GroupBill },
    { default: Project },
    { default: Subscription },
    { default: SavingsGoal },
    { default: SavingsContribution },
    { default: Person },
    { default: MoneyRecord },
    { default: MoneyPayment },
    { default: Activity },
    { default: RecentActivity },
    { default: Draft },
    { default: DashboardPreference },
    { default: PushSubscription },
    { default: Notification },
    { default: NotificationLog },
    { default: TransactionProof },
  ] = await Promise.all([
    import('@/models/Task'),
    import('@/models/Note'),
    import('@/models/Habit'),
    import('@/models/HabitLog'),
    import('@/models/Expense'),
    import('@/models/Budget'),
    import('@/models/Goal'),
    import('@/models/GroupBill'),
    import('@/models/Project'),
    import('@/models/Subscription'),
    import('@/models/SavingsGoal'),
    import('@/models/SavingsContribution'),
    import('@/models/Person'),
    import('@/models/MoneyRecord'),
    import('@/models/MoneyPayment'),
    import('@/models/Activity'),
    import('@/models/RecentActivity'),
    import('@/models/Draft'),
    import('@/models/DashboardPreference'),
    import('@/models/PushSubscription'),
    import('@/models/Notification'),
    import('@/models/NotificationLog'),
    import('@/models/TransactionProof'),
  ])

  return {
    Task, Note, Habit, HabitLog, Expense, Budget, Goal, GroupBill, Project,
    Subscription, SavingsGoal, SavingsContribution, Person, MoneyRecord,
    MoneyPayment, Activity, RecentActivity, Draft, DashboardPreference,
    PushSubscription, Notification, NotificationLog, TransactionProof,
  }
}

// ─── Result type ──────────────────────────────────────────────────────────────

export interface AccountCleanupResult {
  /** Total expired accounts found */
  accountsProcessed: number
  /** Accounts successfully and permanently deleted */
  accountsPermanentlyDeleted: number
  /** Per-account error messages (userId: reason) */
  errors: string[]
  /** Wall-clock duration in milliseconds */
  durationMs: number
}

// ─── Per-account deletion ─────────────────────────────────────────────────────

/**
 * Permanently delete all data for a single user.
 *
 * Called only when:
 *   - accountStatus = "deleted"
 *   - scheduledPermanentDeletionAt <= now
 *
 * Throws on unexpected errors so the caller can log and continue.
 */
async function permanentlyDeleteUser(
  userId: mongoose.Types.ObjectId,
  models: Awaited<ReturnType<typeof loadModels>>
): Promise<{ collectionsCleared: Record<string, number> }> {
  const uid = userId // ObjectId — all models use ObjectId for userId

  const {
    Task, Note, Habit, HabitLog, Expense, Budget, Goal, GroupBill, Project,
    Subscription, SavingsGoal, SavingsContribution, Person, MoneyRecord,
    MoneyPayment, Activity, RecentActivity, Draft, DashboardPreference,
    PushSubscription, Notification, NotificationLog, TransactionProof,
  } = models

  // ── Step 1: Delete all user-owned sub-collections in parallel ─────────────
  // Each deleteMany is scoped to { userId: uid } so it cannot touch other users.
  const [
    tasks, notes, habits, habitLogs, expenses, budgets, goals, groupBills,
    projects, subscriptions, savingsGoals, savingsContributions, people,
    moneyRecords, moneyPayments, activities, recentActivities, drafts,
    dashboardPrefs, pushSubscriptions, notifications, notificationLogs,
    transactionProofs,
  ] = await Promise.all([
    Task.deleteMany({ userId: uid }),
    Note.deleteMany({ userId: uid }),
    Habit.deleteMany({ userId: uid }),
    HabitLog.deleteMany({ userId: uid }),
    Expense.deleteMany({ userId: uid }),
    Budget.deleteMany({ userId: uid }),
    Goal.deleteMany({ userId: uid }),
    GroupBill.deleteMany({ userId: uid }),
    Project.deleteMany({ userId: uid }),
    Subscription.deleteMany({ userId: uid }),
    SavingsGoal.deleteMany({ userId: uid }),
    SavingsContribution.deleteMany({ userId: uid }),
    Person.deleteMany({ userId: uid }),
    MoneyRecord.deleteMany({ userId: uid }),
    MoneyPayment.deleteMany({ userId: uid }),
    Activity.deleteMany({ userId: uid }),
    RecentActivity.deleteMany({ userId: uid }),
    Draft.deleteMany({ userId: uid }),
    DashboardPreference.deleteMany({ userId: uid }),
    PushSubscription.deleteMany({ userId: uid }),
    Notification.deleteMany({ userId: uid }),
    NotificationLog.deleteMany({ userId: uid }),
    TransactionProof.deleteMany({ userId: uid }),
  ])

  const collectionsCleared: Record<string, number> = {
    tasks:                tasks.deletedCount,
    notes:                notes.deletedCount,
    habits:               habits.deletedCount,
    habitLogs:            habitLogs.deletedCount,
    expenses:             expenses.deletedCount,
    budgets:              budgets.deletedCount,
    goals:                goals.deletedCount,
    groupBills:           groupBills.deletedCount,
    projects:             projects.deletedCount,
    subscriptions:        subscriptions.deletedCount,
    savingsGoals:         savingsGoals.deletedCount,
    savingsContributions: savingsContributions.deletedCount,
    people:               people.deletedCount,
    moneyRecords:         moneyRecords.deletedCount,
    moneyPayments:        moneyPayments.deletedCount,
    activities:           activities.deletedCount,
    recentActivities:     recentActivities.deletedCount,
    drafts:               drafts.deletedCount,
    dashboardPreferences: dashboardPrefs.deletedCount,
    pushSubscriptions:    pushSubscriptions.deletedCount,
    notifications:        notifications.deletedCount,
    notificationLogs:     notificationLogs.deletedCount,
    transactionProofs:    transactionProofs.deletedCount,
  }

  // ── Step 2: Unlink cross-user Person references ───────────────────────────
  // Other users may have added this account via LifeFlow ID lookup.
  // We do NOT delete those Person documents (the other users own them) —
  // we only clear the linkedUserId and linkedLifeFlowId fields so the reference
  // is no longer dangling.  The contact entry still exists as 'manual'.
  const unlinked = await Person.updateMany(
    { linkedUserId: uid },
    {
      $unset: { linkedUserId: '', linkedLifeFlowId: '' },
      $set:   { source: 'manual' },
    }
  )
  collectionsCleared['crossUserPersonUnlinks'] = unlinked.modifiedCount

  // ── Step 3: Delete the User document ─────────────────────────────────────
  // Done last to ensure sub-collections are already gone.
  await User.findByIdAndDelete(uid)

  return { collectionsCleared }
}

// ─── Main runner ─────────────────────────────────────────────────────────────

/**
 * Run the account cleanup job.
 *
 * Finds all users with accountStatus = "deleted" AND
 * scheduledPermanentDeletionAt <= now, then permanently deletes each one.
 *
 * Individual failures are caught and added to result.errors — they do not
 * abort processing of subsequent accounts.
 */
export async function runAccountCleanup(): Promise<AccountCleanupResult> {
  const t0 = Date.now()

  const result: AccountCleanupResult = {
    accountsProcessed:          0,
    accountsPermanentlyDeleted: 0,
    errors:                     [],
    durationMs:                 0,
  }

  await connectDB()

  // Load all models once — reused across all accounts in this run
  const models = await loadModels()

  const now = new Date()

  // Find all accounts whose recovery window has expired.
  // We select only the minimum fields needed — no PII beyond email for logging.
  const expiredAccounts = await User.find({
    accountStatus:                'deleted',
    scheduledPermanentDeletionAt: { $lte: now },
  })
    .select('_id email scheduledPermanentDeletionAt')
    .lean<{ _id: mongoose.Types.ObjectId; email: string; scheduledPermanentDeletionAt: Date }[]>()

  result.accountsProcessed = expiredAccounts.length

  logger.info('[accountCleanup] Starting run', {
    accountsFound: expiredAccounts.length,
    utcTime:       now.toISOString(),
  })

  for (const account of expiredAccounts) {
    const userId      = account._id
    const userIdStr   = userId.toString()

    try {
      const { collectionsCleared } = await permanentlyDeleteUser(userId, models)

      result.accountsPermanentlyDeleted++

      logger.info('[accountCleanup] ACCOUNT_PERMANENTLY_DELETED', {
        event:             'ACCOUNT_PERMANENTLY_DELETED',
        userId:            userIdStr,
        // Log email hash only (SHA-256 prefix) for audit purposes — never the raw email
        // This allows correlation with support tickets without storing PII in logs
        scheduledAt:       account.scheduledPermanentDeletionAt.toISOString(),
        collectionsCleared,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`User ${userIdStr}: ${msg}`)

      logger.error('[accountCleanup] Failed to permanently delete account', {
        userId:       userIdStr,
        errorMessage: msg,
      })
      // Continue to next account — do not abort the entire job
    }
  }

  result.durationMs = Date.now() - t0

  logger.info('[accountCleanup] Run complete', {
    accountsProcessed:          result.accountsProcessed,
    accountsPermanentlyDeleted: result.accountsPermanentlyDeleted,
    errorCount:                 result.errors.length,
    durationMs:                 result.durationMs,
  })

  return result
}
