/**
 * scripts/migrate-user-fields.ts
 *
 * SAFE, IDEMPOTENT backfill migration for existing LifeFlow users in MongoDB.
 *
 * PURPOSE
 * ───────
 * Mongoose schema defaults only apply when a NEW document is created through
 * the Mongoose model.  Documents that existed in MongoDB BEFORE a field was
 * added to the schema will NOT have that field in their stored BSON — even
 * though Mongoose synthesises the default value in-memory when you load the
 * document through the model.
 *
 * Lean queries (e.g. in the notification scheduler) bypass in-memory defaults,
 * so any code that uses `??` to provide a fallback for missing fields needs the
 * field to be absent, not absent-but-defaulted.  That approach is already
 * implemented in the scheduler.
 *
 * This migration provides an OPTIONAL belt-and-suspenders step: it writes the
 * default values for both missing fields directly into MongoDB so that ALL
 * queries — lean or otherwise — see consistent data.
 *
 * SAFETY INVARIANTS — this script NEVER:
 *   ✗ overwrites an existing emailNotifications value
 *   ✗ overwrites an existing twoFactorRecoveryCodeHashes value
 *   ✗ modifies passwordHash
 *   ✗ modifies twoFactorSecretEncrypted
 *   ✗ modifies any user's 2FA-enabled state
 *   ✗ deletes any user
 *   ✗ creates any new user
 *
 * IDEMPOTENCY
 * ───────────
 * Uses MongoDB's `$setOnInsert`-style pattern via `$set` with `$exists: false`
 * guards.  Running this script multiple times is safe — subsequent runs touch
 * zero documents and exit with "No documents needed updating."
 *
 * HOW TO RUN
 * ──────────
 * Ensure your .env.local is configured with a valid MONGODB_URI and MONGODB_DB_NAME.
 *
 * Local development:
 *   npx tsx scripts/migrate-user-fields.ts
 *
 * Or with ts-node:
 *   npx ts-node --project tsconfig.json scripts/migrate-user-fields.ts
 *
 * On AWS EC2 / Azure VM:
 *   MONGODB_URI=<...> MONGODB_DB_NAME=test npx tsx scripts/migrate-user-fields.ts
 *
 * WHAT TO EXPECT
 * ──────────────
 * First run (users exist without the field):
 *   ✔ emailNotifications backfill:        updated 12 / 16 users
 *   ✔ twoFactorRecoveryCodeHashes backfill: updated 0 / 16 users
 *   ✔ Migration complete. No existing data was modified.
 *
 * Subsequent runs (all users already have both fields):
 *   ✔ emailNotifications backfill:        No documents needed updating.
 *   ✔ twoFactorRecoveryCodeHashes backfill: No documents needed updating.
 *   ✔ Migration complete. No existing data was modified.
 */

import 'dotenv/config'
import mongoose from 'mongoose'

// ─── Config ───────────────────────────────────────────────────────────────────

const MONGODB_URI    = process.env.MONGODB_URI    ?? ''
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? 'test'

if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI is not set. Export it or use a .env file.')
  process.exit(1)
}

// ─── Connection ───────────────────────────────────────────────────────────────

async function connect(): Promise<void> {
  await mongoose.connect(MONGODB_URI, {
    dbName: MONGODB_DB_NAME,
    family:                  4,
    serverSelectionTimeoutMS: 30_000,
    connectTimeoutMS:         10_000,
  })
  const db = mongoose.connection.db?.databaseName ?? '(unknown)'
  console.log(`✔  Connected to MongoDB — database: ${db}`)
}

// ─── Migration steps ──────────────────────────────────────────────────────────

/**
 * Step 1: Backfill emailNotifications for users who don't have it yet.
 *
 * Default values match the Mongoose schema defaults:
 *   - enabled:        false  (users must explicitly opt in)
 *   - taskReminders:  true
 *   - habitReminders: true
 *   - spendingAlerts: true
 *   - dailySummary:   true
 *
 * The `{ emailNotifications: { $exists: false } }` filter ensures we ONLY
 * touch users who have NO emailNotifications field at all.  Users who already
 * have the field — regardless of what their settings are — are untouched.
 */
async function backfillEmailNotifications(): Promise<void> {
  const collection = mongoose.connection.collection('users')

  const result = await collection.updateMany(
    // Only documents where the field is entirely absent
    { emailNotifications: { $exists: false } },
    {
      $set: {
        emailNotifications: {
          enabled:        false,   // master switch OFF by default — explicit opt-in required
          taskReminders:  true,
          habitReminders: true,
          spendingAlerts: true,
          dailySummary:   true,
        },
      },
    }
  )

  if (result.modifiedCount === 0 && result.matchedCount === 0) {
    console.log('  ✔  emailNotifications backfill: No documents needed updating.')
  } else {
    console.log(
      `  ✔  emailNotifications backfill: updated ${result.modifiedCount} / ` +
      `${result.matchedCount} matched users`
    )
  }
}

/**
 * Step 2: Backfill twoFactorRecoveryCodeHashes for users who don't have it yet.
 *
 * Default value: []  (empty array — no recovery codes until 2FA is enabled)
 *
 * Mongoose already handles this at the model layer (default: []) but we
 * write it explicitly so lean() queries never encounter `undefined`.
 */
async function backfillRecoveryCodeHashes(): Promise<void> {
  const collection = mongoose.connection.collection('users')

  const result = await collection.updateMany(
    // Only documents where the field is entirely absent
    { twoFactorRecoveryCodeHashes: { $exists: false } },
    {
      $set: {
        twoFactorRecoveryCodeHashes: [],
      },
    }
  )

  if (result.modifiedCount === 0 && result.matchedCount === 0) {
    console.log('  ✔  twoFactorRecoveryCodeHashes backfill: No documents needed updating.')
  } else {
    console.log(
      `  ✔  twoFactorRecoveryCodeHashes backfill: updated ${result.modifiedCount} / ` +
      `${result.matchedCount} matched users`
    )
  }
}

/**
 * Step 3: Verification — print counts to confirm the migration completed.
 *
 * SAFE: only reads aggregate counts — never outputs user IDs, hashes, emails,
 * passwords, or any other sensitive field values.
 */
async function verify(): Promise<void> {
  const collection = mongoose.connection.collection('users')

  const [
    totalUsers,
    missingEmailNotif,
    missingRecoveryCodes,
  ] = await Promise.all([
    collection.countDocuments(),
    collection.countDocuments({ emailNotifications: { $exists: false } }),
    collection.countDocuments({ twoFactorRecoveryCodeHashes: { $exists: false } }),
  ])

  console.log('')
  console.log('  ── Verification ──────────────────────────────────────────────')
  console.log(`     Total users                     : ${totalUsers}`)
  console.log(`     Users still missing emailNotifications: ${missingEmailNotif}`)
  console.log(`     Users still missing recoveryCodeHashes: ${missingRecoveryCodes}`)

  if (missingEmailNotif === 0 && missingRecoveryCodes === 0) {
    console.log('     ✔  All users have both fields.')
  } else {
    console.warn('     ⚠  Some users still missing fields — re-run the migration.')
  }
  console.log('  ──────────────────────────────────────────────────────────────')
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('LifeFlow — User field migration')
  console.log('================================')
  console.log(`Database : ${MONGODB_DB_NAME}`)
  console.log('')

  await connect()

  console.log('Running migration steps…')
  await backfillEmailNotifications()
  await backfillRecoveryCodeHashes()
  await verify()

  console.log('')
  console.log('✔  Migration complete. No existing data was modified.')
}

main()
  .then(async () => {
    await mongoose.disconnect()
    process.exit(0)
  })
  .catch(async (err: unknown) => {
    console.error('❌  Migration failed:', err instanceof Error ? err.message : String(err))
    await mongoose.disconnect().catch(() => undefined)
    process.exit(1)
  })
