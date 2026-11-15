/**
 * models/RegistrationCounter.ts — Atomic registration capacity counter.
 *
 * PURPOSE
 * ───────
 * Provides a concurrency-safe counter for the max_users registration limit.
 * A single document with key="active_users" tracks the current number of
 * registered (non-deleted) user accounts.
 *
 * WHY NOT countDocuments()?
 * ─────────────────────────
 * Using countDocuments() + User.create() as separate operations creates a
 * time-of-check/time-of-use (TOCTOU) race condition: two simultaneous signup
 * requests can both read count=99, both decide capacity is available, both
 * insert, leaving count=101 when max_users=100.
 *
 * This model solves the race by using MongoDB's atomic $inc operator:
 *   1. findOneAndUpdate({ key }, { $inc: { count: 1 } }, { upsert: true })
 *      → returns the new count atomically
 *   2. If new count > max_users (and max_users > 0) → decrement and reject
 *   3. If User.create() fails for any reason → decrement to release the slot
 *
 * Because $inc on a single document is atomic in MongoDB, two concurrent
 * requests cannot both "claim" the last slot.
 *
 * INITIALIZATION
 * ──────────────
 * The counter is initialized lazily: on first use, upsert creates the document
 * with count=0 if it doesn't exist, then increments to 1.
 *
 * On application startup the counter may drift if users were created/deleted
 * outside this mechanism (e.g. direct DB edits, legacy code).  The
 * syncRegistrationCounter() function reconciles it from the User collection.
 * Call it from lib/startup.ts or the admin dashboard if drift is suspected.
 *
 * DELETION LIFECYCLE
 * ──────────────────
 * When a user account is soft-deleted (accountStatus → 'deleted'), the counter
 * is NOT decremented immediately — the slot is still "occupied" during the
 * 30-day recovery window.  After permanent deletion (cleanup job runs), the
 * counter should be decremented.  This is intentionally conservative: it
 * prevents a flood of re-registrations during recovery windows.
 *
 * SAFE DEFAULTS
 * ─────────────
 * If this collection is unavailable (DB outage), the signup route falls back
 * to a direct User.countDocuments() check.  This is less concurrency-safe
 * but prevents a DB outage from blocking all signups when max_users=0.
 *
 * SECURITY
 * ────────
 * Never expose the counter value directly to clients.  The admin UI reads
 * it indirectly via countActiveUsers() in lib/settings.ts.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'

export interface IRegistrationCounter extends Document {
  _id: mongoose.Types.ObjectId
  /** Always 'active_users' — singleton document */
  key:   string
  /** Current count of registered (non-permanently-deleted) user accounts */
  count: number
  updatedAt: Date
}

const RegistrationCounterSchema = new Schema<IRegistrationCounter>(
  {
    key:   { type: String, required: true, unique: true, trim: true },
    count: { type: Number, required: true, default: 0, min: 0 },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: 'registrationcounters',
  }
)

const RegistrationCounter: Model<IRegistrationCounter> =
  mongoose.models.RegistrationCounter ||
  mongoose.model<IRegistrationCounter>('RegistrationCounter', RegistrationCounterSchema)

export default RegistrationCounter

// ── Counter key ───────────────────────────────────────────────────────────────

export const COUNTER_KEY = 'active_users'

// ── Atomic increment (reserve a slot) ────────────────────────────────────────

/**
 * Atomically increment the counter by 1 and return the NEW value.
 * Uses upsert so the document is created if it doesn't exist yet.
 * Throws on DB error — callers must handle and NOT create the user on failure.
 */
export async function incrementCounter(): Promise<number> {
  const doc = await RegistrationCounter.findOneAndUpdate(
    { key: COUNTER_KEY },
    { $inc: { count: 1 } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  ).lean<{ count: number }>()

  if (!doc) throw new Error('[RegistrationCounter] findOneAndUpdate returned null')
  return doc.count
}

/**
 * Atomically decrement the counter by 1, floor at 0.
 * Call this when a registration is rejected after incrementing, or when
 * a User.create() fails after incrementing.
 * Never throws — if the decrement fails the counter may drift but that is
 * preferable to blocking legitimate signups permanently.
 */
export async function decrementCounter(): Promise<void> {
  try {
    await RegistrationCounter.findOneAndUpdate(
      { key: COUNTER_KEY, count: { $gt: 0 } },
      { $inc: { count: -1 } },
      { returnDocument: 'after' }
    )
  } catch {
    // Non-fatal — log externally at call site if needed
  }
}

/**
 * Return the current counter value without modifying it.
 * Returns null if the counter document does not exist yet.
 */
export async function getCounterValue(): Promise<number | null> {
  const doc = await RegistrationCounter.findOne({ key: COUNTER_KEY })
    .select('count')
    .lean<{ count: number }>()
  return doc?.count ?? null
}

/**
 * Reconcile the counter with the actual User collection count.
 *
 * Call this:
 *   - On application startup (via lib/startup.ts)
 *   - After any bulk user import or deletion operation
 *   - From the admin dashboard if drift is suspected
 *
 * Uses $set so it overwrites the current value with the authoritative count.
 * Safe to call concurrently — the last writer wins, but the User.countDocuments
 * result is authoritative.
 */
export async function syncRegistrationCounter(): Promise<number> {
  const { default: User } = await import('@/models/User')
  const actualCount = await User.countDocuments({
    $or: [
      { accountStatus: 'active' },
      { accountStatus: { $exists: false } },
    ],
  })

  await RegistrationCounter.findOneAndUpdate(
    { key: COUNTER_KEY },
    { $set: { count: actualCount } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  )

  return actualCount
}
