/**
 * GET /api/sync/pull — Delta pull endpoint.
 *
 * Returns records for one entity type that were updated after `since` (ISO timestamp).
 * The client paginates using the returned cursor until hasMore is false.
 *
 * Query params:
 *   entityType  — required, one of: note|task|habit|habitLog|expense|subscription|project
 *   since       — ISO timestamp (exclusive lower bound on updatedAt). Omit for full sync.
 *   limit       — default 100, max 200
 *
 * SECURITY
 * ────────
 * • Authentication via requireAuth() — userId from session, never from query param.
 * • Every query includes { userId } so users can only pull their own records.
 *
 * TOMBSTONES
 * ──────────
 * Currently this implementation uses a `deleted` field on the document itself
 * (soft-delete pattern). A future improvement is a dedicated TombstoneLog collection.
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Note          from '@/models/Note'
import Task          from '@/models/Task'
import Habit         from '@/models/Habit'
import HabitLog      from '@/models/HabitLog'
import Expense       from '@/models/Expense'
import Subscription  from '@/models/Subscription'
import Project       from '@/models/Project'
import logger        from '@/lib/logger'
import type { SyncEntityType, SyncPullResponse } from '@/types/sync'

const MAX_LIMIT     = 200
const DEFAULT_LIMIT = 100

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth({ skipActivityUpdate: true })
    await connectDB()

    const { searchParams } = req.nextUrl
    const entityType = searchParams.get('entityType') as SyncEntityType | null
    const since      = searchParams.get('since')
    const limitParam = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10)
    const limit      = Math.min(isNaN(limitParam) ? DEFAULT_LIMIT : limitParam, MAX_LIMIT)

    if (!entityType || !isValidEntityType(entityType)) {
      return NextResponse.json({ error: 'entityType is required' }, { status: 400 })
    }

    const since_date: Date | undefined = since ? new Date(since) : undefined
    const { records, cursor, hasMore } = await pullEntityType(entityType, userId, since_date, limit)

    const response: SyncPullResponse = { entityType, records, cursor, hasMore }
    return NextResponse.json(response)

  } catch (error) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'SessionExpired')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('[sync/pull GET]', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Pull failed' }, { status: 500 })
  }
}

function isValidEntityType(t: string): t is SyncEntityType {
  return ['note', 'task', 'habit', 'habitLog', 'expense', 'subscription', 'project'].includes(t)
}

// ─── Entity pull dispatch ─────────────────────────────────────────────────────

async function pullEntityType(
  entityType: SyncEntityType,
  userId: string,
  since: Date | undefined,
  limit: number,
): Promise<{ records: Record<string, unknown>[]; cursor: string | null; hasMore: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseQuery: Record<string, any> = { userId }
  if (since) baseQuery.updatedAt = { $gt: since }

  const fetchLimit = limit + 1

  switch (entityType) {
    case 'note': {
      const docs = await Note.find(baseQuery).sort({ updatedAt: 1 }).limit(fetchLimit).lean()
      return paginate(docs, limit, (d) => ({
        _id: d._id.toString(),
        userId: d.userId.toString(),
        title: d.title,
        content: d.content,
        tags: d.tags,
        pinned: d.pinned,
        archived: d.archived,
        serverRevision: d.serverRevision ?? 0,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      }))
    }

    case 'task': {
      const docs = await Task.find(baseQuery).sort({ updatedAt: 1 }).limit(fetchLimit).lean()
      return paginate(docs, limit, (d) => ({
        _id: d._id.toString(),
        userId: d.userId.toString(),
        title: d.title,
        description: d.description,
        completed: d.completed,
        priority: d.priority,
        dueDate: d.dueDate,
        dueTime: d.dueTime,
        recurring: d.recurring,
        serverRevision: d.serverRevision ?? 0,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      }))
    }

    case 'habit': {
      const docs = await Habit.find(baseQuery).sort({ updatedAt: 1 }).limit(fetchLimit).lean()
      return paginate(docs, limit, (d) => ({
        _id: d._id.toString(),
        userId: d.userId.toString(),
        name: d.name,
        icon: d.icon,
        description: d.description,
        frequency: d.frequency,
        target: d.target,
        serverRevision: d.serverRevision ?? 0,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      }))
    }

    case 'habitLog': {
      const docs = await HabitLog.find(baseQuery).sort({ updatedAt: 1 }).limit(fetchLimit).lean()
      return paginate(docs, limit, (d) => ({
        _id: d._id.toString(),
        userId: d.userId.toString(),
        habitId: d.habitId.toString(),
        date: d.date,
        completed: d.completed,
        serverRevision: d.serverRevision ?? 0,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      }))
    }

    case 'expense': {
      // Only pull 'personal' expenses offline
      const expQuery = { ...baseQuery, source: 'personal' as const }
      const docs = await Expense.find(expQuery).sort({ updatedAt: 1 }).limit(fetchLimit).lean()
      return paginate(docs, limit, (d) => ({
        _id: d._id.toString(),
        userId: d.userId.toString(),
        amount: d.amount,
        category: d.category,
        description: d.description,
        date: d.date,
        paymentMethod: d.paymentMethod,
        source: d.source,
        serverRevision: d.serverRevision ?? 0,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      }))
    }

    case 'subscription': {
      const docs = await Subscription.find(baseQuery).sort({ updatedAt: 1 }).limit(fetchLimit).lean()
      return paginate(docs, limit, (d) => ({
        _id: d._id.toString(),
        userId: d.userId.toString(),
        serviceName: d.serviceName,
        amountMinor: d.amountMinor,
        amount: d.amountMinor / 100,
        currency: d.currency,
        billingCycle: d.billingCycle,
        customIntervalDays: d.customIntervalDays,
        nextBillingDate: d.nextBillingDate,
        lastBillingDate: d.lastBillingDate ?? null,
        category: d.category,
        paymentMethod: d.paymentMethod,
        status: d.status,
        autoCreateExpense: d.autoCreateExpense,
        notes: d.notes,
        serverRevision: d.serverRevision ?? 0,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      }))
    }

    case 'project': {
      const docs = await Project.find(baseQuery).sort({ updatedAt: 1 }).limit(fetchLimit).lean()
      return paginate(docs, limit, (d) => ({
        _id: d._id.toString(),
        userId: d.userId.toString(),
        title: d.title,
        description: d.description,
        status: d.status,
        dueDate: d.dueDate,
        color: d.color,
        serverRevision: d.serverRevision ?? 0,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      }))
    }

    default:
      return { records: [], cursor: null, hasMore: false }
  }
}

// ─── Pagination helper ────────────────────────────────────────────────────────

function paginate<T extends { updatedAt: Date }>(
  docs: T[],
  limit: number,
  serialise: (doc: T) => Record<string, unknown>,
): { records: Record<string, unknown>[]; cursor: string | null; hasMore: boolean } {
  const hasMore  = docs.length > limit
  const page     = docs.slice(0, limit)
  const records  = page.map(serialise)
  const lastDoc  = page[page.length - 1]
  const cursor   = lastDoc ? lastDoc.updatedAt.toISOString() : null
  return { records, cursor, hasMore }
}
