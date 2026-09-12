/**
 * scripts/migrate-lifeflow-id.ts
 *
 * One-time (but idempotent) backfill migration:
 * stamps every existing user-owned document with the owner's lifeFlowId
 * (sourced from User.publicId, e.g. "LF-A1B2C3D4").
 *
 * SAFETY GUARANTEES
 * ─────────────────
 * • Never overwrites a document that already has a correct lifeFlowId.
 * • Never generates or changes a user's publicId.
 * • Never deletes or modifies _id, userId, or any other field.
 * • Idempotent — safe to run multiple times; skips docs already backfilled.
 * • Orphaned documents (userId points to a deleted user) are reported but
 *   NOT deleted.
 * • Dry-run mode (--dry) prints what would be changed without writing.
 *
 * USAGE
 * ─────
 * # Normal run (writes to DB):
 *   npx tsx scripts/migrate-lifeflow-id.ts
 *
 * # Dry-run (no writes):
 *   npx tsx scripts/migrate-lifeflow-id.ts --dry
 *
 * # Run inside Docker container:
 *   docker exec <container> npx tsx scripts/migrate-lifeflow-id.ts
 *
 * ENVIRONMENT
 * ───────────
 * Reads MONGODB_URI and MONGODB_DB_NAME from .env.local (or process.env).
 * Make sure the environment variables are available before running.
 */

import 'dotenv/config'
import mongoose from 'mongoose'

// ─── Configuration ────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry')
const BATCH_SIZE = 500   // documents processed per bulkWrite call

// ─── Collection names (must match Mongoose model registrations) ────────────────

const USER_OWNED_COLLECTIONS = [
  'activities',
  'budgets',
  'dashboardpreferences',
  'drafts',
  'expenses',
  'goals',
  'groupbills',
  'habitlogs',
  'habits',
  'moneyrecords',
  'moneypayments',
  'notes',
  'notifications',
  'people',
  'projects',
  'recentactivities',
  'savingscontributions',
  'savingsgoals',
  'subscriptions',
  'tasks',
  'transactionproofs',
] as const

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[migrate-lifeflow-id] ${msg}`)
}

function warn(msg: string) {
  console.warn(`[migrate-lifeflow-id] ⚠  ${msg}`)
}

// ─── Connect ─────────────────────────────────────────────────────────────────

async function connect() {
  const uri    = process.env.MONGODB_URI
  const dbName = process.env.MONGODB_DB_NAME ?? 'lifeflow'

  if (!uri) {
    console.error('[migrate-lifeflow-id] MONGODB_URI is not set. Aborting.')
    process.exit(1)
  }

  log(`Connecting to MongoDB (db: ${dbName})…`)
  await mongoose.connect(uri, { dbName })
  log('Connected.')
  return mongoose.connection.db!
}

// ─── Build userId → lifeFlowId map ────────────────────────────────────────────

async function buildLifeFlowIdMap(
  db: mongoose.mongo.Db
): Promise<Map<string, string>> {
  log('Loading users…')
  const users = await db
    .collection('users')
    .find({}, { projection: { _id: 1, publicId: 1 } })
    .toArray()

  const map = new Map<string, string>()
  let missing = 0

  for (const u of users) {
    if (!u.publicId) {
      warn(`User ${u._id} has no publicId — skipping`)
      missing++
      continue
    }
    map.set(u._id.toString(), u.publicId as string)
  }

  log(`Loaded ${map.size} users (${missing} without publicId).`)
  return map
}

// ─── Migrate one collection ────────────────────────────────────────────────────

interface CollectionResult {
  collection: string
  alreadyOk: number
  updated: number
  orphaned: number
  errors: number
}

async function migrateCollection(
  db: mongoose.mongo.Db,
  collectionName: string,
  lfMap: Map<string, string>
): Promise<CollectionResult> {
  const col = db.collection(collectionName)
  const result: CollectionResult = {
    collection: collectionName,
    alreadyOk: 0,
    updated:   0,
    orphaned:  0,
    errors:    0,
  }

  // Cursor over all documents that are either missing lifeFlowId or have null/empty
  const cursor = col.find({
    $or: [
      { lifeFlowId: { $exists: false } },
      { lifeFlowId: null },
      { lifeFlowId: '' },
    ],
  })

  const ops: mongoose.mongo.AnyBulkWriteOperation[] = []

  const flush = async () => {
    if (ops.length === 0) return
    if (DRY_RUN) {
      result.updated += ops.length
      ops.length = 0
      return
    }
    try {
      const r = await col.bulkWrite(ops, { ordered: false })
      result.updated += r.modifiedCount
    } catch (err) {
      warn(`bulkWrite error on ${collectionName}: ${err instanceof Error ? err.message : String(err)}`)
      result.errors += ops.length
    }
    ops.length = 0
  }

  for await (const doc of cursor) {
    const userId = doc.userId?.toString()

    if (!userId) {
      // Document has no userId — cannot map
      warn(`${collectionName}/${doc._id}: no userId field, skipping`)
      result.orphaned++
      continue
    }

    const lifeFlowId = lfMap.get(userId)

    if (!lifeFlowId) {
      // userId doesn't match any known user
      warn(`${collectionName}/${doc._id}: userId=${userId} not found in users collection (orphaned)`)
      result.orphaned++
      continue
    }

    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { lifeFlowId } },
      },
    })

    if (ops.length >= BATCH_SIZE) {
      await flush()
    }
  }

  await flush()
  await cursor.close()

  // Count documents that were already correctly set (for reporting)
  result.alreadyOk = await col.countDocuments({
    lifeFlowId: { $exists: true, $nin: [null, ''] },
  })

  return result
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (DRY_RUN) {
    log('DRY RUN — no writes will be made.')
  }

  const db = await connect()
  const lfMap = await buildLifeFlowIdMap(db)

  const results: CollectionResult[] = []
  let totalUpdated = 0
  let totalOrphaned = 0

  for (const colName of USER_OWNED_COLLECTIONS) {
    log(`Processing collection: ${colName}…`)
    const r = await migrateCollection(db, colName, lfMap)
    results.push(r)
    totalUpdated  += r.updated
    totalOrphaned += r.orphaned

    const verb = DRY_RUN ? 'would update' : 'updated'
    log(
      `  ${colName}: ${verb} ${r.updated}, already ok ${r.alreadyOk}, ` +
      `orphaned ${r.orphaned}, errors ${r.errors}`
    )
  }

  // ─── Summary ────────────────────────────────────────────────────────────────

  console.log('')
  console.log('══════════════════════════════════════════════════════')
  console.log(' Migration Summary')
  console.log('══════════════════════════════════════════════════════')
  console.log(` Mode          : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log(` Total updated : ${totalUpdated}`)
  console.log(` Total orphaned: ${totalOrphaned}`)
  console.log('')

  if (totalOrphaned > 0) {
    console.log(' ⚠  Orphaned documents were found (userId has no matching user).')
    console.log('    These documents were NOT modified and NOT deleted.')
    console.log('    Investigate each orphaned document manually.')
    console.log('')
  }

  console.log(' Per-collection breakdown:')
  const maxLen = Math.max(...results.map((r) => r.collection.length))
  for (const r of results) {
    const pad = r.collection.padEnd(maxLen)
    const verb = DRY_RUN ? 'would-update' : 'updated'
    console.log(
      `   ${pad}  ${verb}=${String(r.updated).padStart(5)}  ` +
      `ok=${String(r.alreadyOk).padStart(5)}  ` +
      `orphaned=${String(r.orphaned).padStart(3)}  ` +
      `errors=${String(r.errors).padStart(3)}`
    )
  }
  console.log('══════════════════════════════════════════════════════')

  await mongoose.disconnect()
  log('Done.')

  if (totalOrphaned > 0) {
    // Exit 2 to signal partial completion
    process.exit(2)
  }
}

main().catch((err) => {
  console.error('[migrate-lifeflow-id] Fatal error:', err)
  process.exit(1)
})
