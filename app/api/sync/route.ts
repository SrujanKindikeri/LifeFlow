/**
 * POST /api/sync — Receive a batch of client mutations and apply them to MongoDB.
 *
 * SECURITY
 * ────────
 * • Every request is authenticated via requireAuth() — userId comes from the
 *   server session cookie, NEVER from the request body.
 * • Every mutation is checked for user ownership before applying.
 * • We never trust a client-supplied userId or serverRevision for authorization.
 * • mutationId is used as an idempotency key — duplicates return 'accepted'
 *   without re-applying the operation.
 * • Validation uses the same Zod schemas as the existing API routes.
 *
 * IDEMPOTENCY
 * ───────────
 * We keep a lightweight idempotency log in MongoDB (a simple field on each
 * document: `lastMutationId`). If a document's lastMutationId matches the
 * incoming mutationId we return 'accepted' immediately without re-writing.
 *
 * CONFLICT DETECTION
 * ──────────────────
 * For updates we compare serverRevision: if the document has been modified
 * since the client's last pull (serverRevision > payload.serverRevision),
 * we return status: 'conflict' with the current server record.
 *
 * PARTIAL FAILURES
 * ────────────────
 * Each mutation produces an independent result. A rejected or conflicting
 * mutation does not affect the others. The response always contains one
 * result object per input mutation.
 *
 * TRANSACTIONS
 * ────────────
 * MongoDB Atlas Free/M0 tiers do NOT support multi-document transactions.
 * We use individual findOneAndUpdate calls guarded by user ownership checks,
 * which is correct for independent documents. For production deployments on
 * M10+ a session/transaction can be added around each batch.
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import { noteSchema, taskSchema, habitSchema, expenseSchema } from '@/lib/validations'
import Note          from '@/models/Note'
import Task          from '@/models/Task'
import Habit         from '@/models/Habit'
import HabitLog      from '@/models/HabitLog'
import Expense       from '@/models/Expense'
import Subscription  from '@/models/Subscription'
import Project       from '@/models/Project'
import logger        from '@/lib/logger'
import { z }         from 'zod'
import type { SyncMutation, SyncMutationResult, SyncPushResponse } from '@/types/sync'

// ─── Request schema ───────────────────────────────────────────────────────────

const pushRequestSchema = z.object({
  mutations: z.array(
    z.object({
      mutationId:     z.string().uuid('mutationId must be a valid UUID'),
      entityType:     z.enum(['note', 'task', 'habit', 'habitLog', 'expense', 'subscription', 'project']),
      entityId:       z.string().min(1).max(100),
      op:             z.enum(['create', 'update', 'delete']),
      payload:        z.record(z.string(), z.unknown()),
      serverRevision: z.number().int().min(0).optional(),
    })
  ).min(1).max(50),
})

// ─── POST /api/sync ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { userId, lifeFlowId } = await requireAuth()
    await connectDB()

    const body   = await req.json()
    const parsed = pushRequestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }

    const results: SyncMutationResult[] = []

    for (const mutation of parsed.data.mutations as SyncMutation[]) {
      try {
        const result = await applyMutation(mutation, userId, lifeFlowId)
        results.push(result)
      } catch (err) {
        // Per-operation error — mark as retryable, never drop other operations
        logger.error('[sync POST] per-operation error', {
          mutationId: mutation.mutationId,
          entityType: mutation.entityType,
          op:         mutation.op,
          errorMessage: err instanceof Error ? err.message.slice(0, 200) : String(err),
        })
        results.push({
          mutationId: mutation.mutationId,
          entityId:   mutation.entityId,
          status:     'retryable',
          reason:     'Server error — will retry',
        })
      }
    }

    const response: SyncPushResponse = { results }
    return NextResponse.json(response)

  } catch (error) {
    if (error instanceof Error && (error.message === 'Unauthorized' || error.message === 'SessionExpired')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('[sync POST] Request error', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}

// ─── Per-mutation dispatcher ──────────────────────────────────────────────────

async function applyMutation(
  mutation: SyncMutation,
  userId: string,
  lifeFlowId: string,
): Promise<SyncMutationResult> {
  const { mutationId, entityType, entityId, op, payload, serverRevision } = mutation

  switch (entityType) {
    case 'note':         return applyNote(mutationId, entityId, op, payload, serverRevision, userId, lifeFlowId)
    case 'task':         return applyTask(mutationId, entityId, op, payload, serverRevision, userId, lifeFlowId)
    case 'habit':        return applyHabit(mutationId, entityId, op, payload, serverRevision, userId, lifeFlowId)
    case 'habitLog':     return applyHabitLog(mutationId, entityId, op, payload, userId, lifeFlowId)
    case 'expense':      return applyExpense(mutationId, entityId, op, payload, serverRevision, userId, lifeFlowId)
    case 'subscription': return applySubscription(mutationId, entityId, op, payload, serverRevision, userId, lifeFlowId)
    case 'project':      return applyProject(mutationId, entityId, op, payload, serverRevision, userId, lifeFlowId)
    default:
      return { mutationId, entityId, status: 'rejected', reason: 'Unknown entity type' }
  }
}

// ─── Per-entity handlers ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyNote(mutationId: string, entityId: string, op: string, payload: Record<string, any>, serverRevision: number | undefined, userId: string, lifeFlowId: string): Promise<SyncMutationResult> {
  if (op === 'create') {
    const parsed = noteSchema.safeParse(payload)
    if (!parsed.success) return { mutationId, entityId, status: 'rejected', reason: parsed.error.issues[0]?.message }

    // Idempotency: check if a note with this mutationId already exists
    const existing = await Note.findOne({ userId, lastMutationId: mutationId })
    if (existing) {
      return { mutationId, entityId: existing._id.toString(), serverId: existing._id.toString(), status: 'accepted', newRevision: existing.serverRevision ?? 1 }
    }

    const note = await Note.create({ ...parsed.data, userId, lifeFlowId, serverRevision: 1, lastMutationId: mutationId })
    return { mutationId, entityId, serverId: note._id.toString(), status: 'accepted', newRevision: 1, serverUpdatedAt: note.updatedAt.toISOString() }
  }

  if (op === 'update') {
    const parsed = noteSchema.partial().safeParse(payload)
    if (!parsed.success) return { mutationId, entityId, status: 'rejected', reason: parsed.error.issues[0]?.message }

    const current = await Note.findOne({ _id: entityId, userId })
    if (!current) return { mutationId, entityId, status: 'rejected', reason: 'Note not found' }

    // Idempotency
    if (current.lastMutationId === mutationId) {
      return { mutationId, entityId, status: 'accepted', newRevision: current.serverRevision ?? 1 }
    }

    // Conflict detection
    const currentRev = current.serverRevision ?? 0
    if (serverRevision !== undefined && currentRev > serverRevision) {
      const serverRecord = serializeNote(current)
      return { mutationId, entityId, status: 'conflict', reason: 'Concurrent modification', serverRecord, newRevision: currentRev }
    }

    const newRev = currentRev + 1
    const updated = await Note.findOneAndUpdate(
      { _id: entityId, userId },
      { $set: { ...parsed.data, serverRevision: newRev, lastMutationId: mutationId } },
      { new: true }
    )
    if (!updated) return { mutationId, entityId, status: 'rejected', reason: 'Note not found' }
    return { mutationId, entityId, status: 'accepted', newRevision: newRev, serverUpdatedAt: updated.updatedAt.toISOString() }
  }

  if (op === 'delete') {
    const deleted = await Note.findOneAndDelete({ _id: entityId, userId })
    if (!deleted) return { mutationId, entityId, status: 'accepted' } // Already gone = idempotent
    return { mutationId, entityId, status: 'accepted' }
  }

  return { mutationId, entityId, status: 'rejected', reason: 'Unknown op' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyTask(mutationId: string, entityId: string, op: string, payload: Record<string, any>, serverRevision: number | undefined, userId: string, lifeFlowId: string): Promise<SyncMutationResult> {
  if (op === 'create') {
    const parsed = taskSchema.safeParse(payload)
    if (!parsed.success) return { mutationId, entityId, status: 'rejected', reason: parsed.error.issues[0]?.message }
    const existing = await Task.findOne({ userId, lastMutationId: mutationId })
    if (existing) return { mutationId, entityId: existing._id.toString(), serverId: existing._id.toString(), status: 'accepted', newRevision: existing.serverRevision ?? 1 }
    const task = await Task.create({ ...parsed.data, userId, lifeFlowId, serverRevision: 1, lastMutationId: mutationId })
    return { mutationId, entityId, serverId: task._id.toString(), status: 'accepted', newRevision: 1, serverUpdatedAt: task.updatedAt.toISOString() }
  }

  if (op === 'update') {
    const allowedFields = ['completed', 'title', 'description', 'priority', 'dueDate', 'dueTime', 'recurring']
    const update: Record<string, unknown> = {}
    for (const k of allowedFields) { if (k in payload) update[k] = payload[k] }

    const current = await Task.findOne({ _id: entityId, userId })
    if (!current) return { mutationId, entityId, status: 'rejected', reason: 'Task not found' }
    if (current.lastMutationId === mutationId) return { mutationId, entityId, status: 'accepted', newRevision: current.serverRevision ?? 1 }

    const currentRev = current.serverRevision ?? 0
    if (serverRevision !== undefined && currentRev > serverRevision) {
      return { mutationId, entityId, status: 'conflict', reason: 'Concurrent modification', serverRecord: serializeTask(current), newRevision: currentRev }
    }

    const newRev = currentRev + 1
    const updated = await Task.findOneAndUpdate({ _id: entityId, userId }, { $set: { ...update, serverRevision: newRev, lastMutationId: mutationId } }, { new: true })
    if (!updated) return { mutationId, entityId, status: 'rejected', reason: 'Task not found' }
    return { mutationId, entityId, status: 'accepted', newRevision: newRev, serverUpdatedAt: updated.updatedAt.toISOString() }
  }

  if (op === 'delete') {
    await Task.findOneAndDelete({ _id: entityId, userId })
    return { mutationId, entityId, status: 'accepted' }
  }
  return { mutationId, entityId, status: 'rejected', reason: 'Unknown op' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyHabit(mutationId: string, entityId: string, op: string, payload: Record<string, any>, serverRevision: number | undefined, userId: string, lifeFlowId: string): Promise<SyncMutationResult> {
  if (op === 'create') {
    const parsed = habitSchema.safeParse(payload)
    if (!parsed.success) return { mutationId, entityId, status: 'rejected', reason: parsed.error.issues[0]?.message }
    const existing = await Habit.findOne({ userId, lastMutationId: mutationId })
    if (existing) return { mutationId, entityId: existing._id.toString(), serverId: existing._id.toString(), status: 'accepted', newRevision: 1 }
    const habit = await Habit.create({ ...parsed.data, userId, lifeFlowId, serverRevision: 1, lastMutationId: mutationId })
    return { mutationId, entityId, serverId: habit._id.toString(), status: 'accepted', newRevision: 1, serverUpdatedAt: habit.updatedAt.toISOString() }
  }

  if (op === 'update') {
    const parsed = habitSchema.partial().safeParse(payload)
    if (!parsed.success) return { mutationId, entityId, status: 'rejected', reason: parsed.error.issues[0]?.message }
    const current = await Habit.findOne({ _id: entityId, userId })
    if (!current) return { mutationId, entityId, status: 'rejected', reason: 'Habit not found' }
    if (current.lastMutationId === mutationId) return { mutationId, entityId, status: 'accepted', newRevision: current.serverRevision ?? 1 }
    const currentRev = current.serverRevision ?? 0
    if (serverRevision !== undefined && currentRev > serverRevision) {
      return { mutationId, entityId, status: 'conflict', reason: 'Concurrent modification', serverRecord: serializeHabit(current), newRevision: currentRev }
    }
    const newRev = currentRev + 1
    const updated = await Habit.findOneAndUpdate({ _id: entityId, userId }, { $set: { ...parsed.data, serverRevision: newRev, lastMutationId: mutationId } }, { new: true })
    if (!updated) return { mutationId, entityId, status: 'rejected', reason: 'Habit not found' }
    return { mutationId, entityId, status: 'accepted', newRevision: newRev, serverUpdatedAt: updated.updatedAt.toISOString() }
  }

  if (op === 'delete') {
    await Habit.findOneAndDelete({ _id: entityId, userId })
    await HabitLog.deleteMany({ habitId: entityId, userId })
    return { mutationId, entityId, status: 'accepted' }
  }
  return { mutationId, entityId, status: 'rejected', reason: 'Unknown op' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyHabitLog(mutationId: string, entityId: string, op: string, payload: Record<string, any>, userId: string, lifeFlowId: string): Promise<SyncMutationResult> {
  const { habitId, date, completed = true } = payload

  if (!habitId || !date) return { mutationId, entityId, status: 'rejected', reason: 'habitId and date required' }

  // Verify habit ownership
  const habit = await Habit.findOne({ _id: habitId, userId })
  if (!habit) return { mutationId, entityId, status: 'rejected', reason: 'Habit not found' }

  if (op === 'create' || op === 'update') {
    if (!completed) {
      await HabitLog.findOneAndDelete({ userId, habitId, date })
      return { mutationId, entityId, status: 'accepted' }
    }
    // Upsert — idempotent by design (unique index on userId+habitId+date)
    const log = await HabitLog.findOneAndUpdate(
      { userId, habitId, date },
      { $set: { completed: true }, $setOnInsert: { lifeFlowId, lastMutationId: mutationId } },
      { upsert: true, new: true }
    )
    return { mutationId, entityId, serverId: log._id.toString(), status: 'accepted', newRevision: 1, serverUpdatedAt: log.updatedAt.toISOString() }
  }

  if (op === 'delete') {
    await HabitLog.findOneAndDelete({ userId, habitId, date })
    return { mutationId, entityId, status: 'accepted' }
  }
  return { mutationId, entityId, status: 'rejected', reason: 'Unknown op' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyExpense(mutationId: string, entityId: string, op: string, payload: Record<string, any>, serverRevision: number | undefined, userId: string, lifeFlowId: string): Promise<SyncMutationResult> {
  if (op === 'create') {
    const parsed = expenseSchema.safeParse(payload)
    if (!parsed.success) return { mutationId, entityId, status: 'rejected', reason: parsed.error.issues[0]?.message }

    // Idempotency check
    const existing = await Expense.findOne({ userId, lastMutationId: mutationId })
    if (existing) return { mutationId, entityId: existing._id.toString(), serverId: existing._id.toString(), status: 'accepted', newRevision: 1 }

    const expense = await Expense.create({ ...parsed.data, userId, lifeFlowId, source: 'personal', serverRevision: 1, lastMutationId: mutationId })
    return { mutationId, entityId, serverId: expense._id.toString(), status: 'accepted', newRevision: 1, serverUpdatedAt: expense.updatedAt.toISOString() }
  }

  if (op === 'update') {
    const parsed = expenseSchema.partial().safeParse(payload)
    if (!parsed.success) return { mutationId, entityId, status: 'rejected', reason: parsed.error.issues[0]?.message }
    const current = await Expense.findOne({ _id: entityId, userId })
    if (!current) return { mutationId, entityId, status: 'rejected', reason: 'Expense not found' }
    if (current.lastMutationId === mutationId) return { mutationId, entityId, status: 'accepted', newRevision: current.serverRevision ?? 1 }
    const currentRev = current.serverRevision ?? 0
    if (serverRevision !== undefined && currentRev > serverRevision) {
      return { mutationId, entityId, status: 'conflict', reason: 'Concurrent modification', serverRecord: serializeExpense(current), newRevision: currentRev }
    }
    const newRev = currentRev + 1
    const updated = await Expense.findOneAndUpdate({ _id: entityId, userId }, { $set: { ...parsed.data, serverRevision: newRev, lastMutationId: mutationId } }, { new: true })
    if (!updated) return { mutationId, entityId, status: 'rejected', reason: 'Expense not found' }
    return { mutationId, entityId, status: 'accepted', newRevision: newRev, serverUpdatedAt: updated.updatedAt.toISOString() }
  }

  if (op === 'delete') {
    await Expense.findOneAndDelete({ _id: entityId, userId })
    return { mutationId, entityId, status: 'accepted' }
  }
  return { mutationId, entityId, status: 'rejected', reason: 'Unknown op' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applySubscription(mutationId: string, entityId: string, op: string, payload: Record<string, any>, serverRevision: number | undefined, userId: string, lifeFlowId: string): Promise<SyncMutationResult> {
  if (op === 'create') {
    // Subscriptions with billing fields are managed server-side. Offline
    // creates are allowed but the subscription scheduler is NEVER run here.
    const existing = await Subscription.findOne({ userId, lastMutationId: mutationId })
    if (existing) return { mutationId, entityId: existing._id.toString(), serverId: existing._id.toString(), status: 'accepted', newRevision: 1 }

    const sub = await Subscription.create({ ...payload, userId, lifeFlowId, serverRevision: 1, lastMutationId: mutationId })
    return { mutationId, entityId, serverId: sub._id.toString(), status: 'accepted', newRevision: 1 }
  }

  if (op === 'update') {
    const current = await Subscription.findOne({ _id: entityId, userId })
    if (!current) return { mutationId, entityId, status: 'rejected', reason: 'Subscription not found' }
    if (current.lastMutationId === mutationId) return { mutationId, entityId, status: 'accepted', newRevision: current.serverRevision ?? 1 }
    const currentRev = current.serverRevision ?? 0
    if (serverRevision !== undefined && currentRev > serverRevision) {
      return { mutationId, entityId, status: 'conflict', reason: 'Concurrent modification', serverRecord: serializeSub(current), newRevision: currentRev }
    }

    // Only allow non-billing fields to be updated offline (billing is server-controlled)
    const safe = { serviceName: payload.serviceName, notes: payload.notes, paymentMethod: payload.paymentMethod, status: payload.status, category: payload.category }
    const newRev = currentRev + 1
    const updated = await Subscription.findOneAndUpdate({ _id: entityId, userId }, { $set: { ...safe, serverRevision: newRev, lastMutationId: mutationId } }, { new: true })
    if (!updated) return { mutationId, entityId, status: 'rejected', reason: 'Subscription not found' }
    return { mutationId, entityId, status: 'accepted', newRevision: newRev }
  }

  if (op === 'delete') {
    await Subscription.findOneAndDelete({ _id: entityId, userId })
    return { mutationId, entityId, status: 'accepted' }
  }
  return { mutationId, entityId, status: 'rejected', reason: 'Unknown op' }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyProject(mutationId: string, entityId: string, op: string, payload: Record<string, any>, serverRevision: number | undefined, userId: string, lifeFlowId: string): Promise<SyncMutationResult> {
  if (op === 'create') {
    const existing = await Project.findOne({ userId, lastMutationId: mutationId })
    if (existing) return { mutationId, entityId: existing._id.toString(), serverId: existing._id.toString(), status: 'accepted', newRevision: 1 }
    const project = await Project.create({ ...payload, userId, lifeFlowId, serverRevision: 1, lastMutationId: mutationId })
    return { mutationId, entityId, serverId: project._id.toString(), status: 'accepted', newRevision: 1 }
  }

  if (op === 'update') {
    const current = await Project.findOne({ _id: entityId, userId })
    if (!current) return { mutationId, entityId, status: 'rejected', reason: 'Project not found' }
    if (current.lastMutationId === mutationId) return { mutationId, entityId, status: 'accepted', newRevision: current.serverRevision ?? 1 }
    const currentRev = current.serverRevision ?? 0
    if (serverRevision !== undefined && currentRev > serverRevision) {
      return { mutationId, entityId, status: 'conflict', reason: 'Concurrent modification', serverRecord: serializeProject(current), newRevision: currentRev }
    }
    const allowed = ['title', 'description', 'status', 'dueDate', 'color']
    const update: Record<string, unknown> = {}
    for (const k of allowed) { if (k in payload) update[k] = payload[k] }
    const newRev = currentRev + 1
    const updated = await Project.findOneAndUpdate({ _id: entityId, userId }, { $set: { ...update, serverRevision: newRev, lastMutationId: mutationId } }, { new: true })
    if (!updated) return { mutationId, entityId, status: 'rejected', reason: 'Project not found' }
    return { mutationId, entityId, status: 'accepted', newRevision: newRev }
  }

  if (op === 'delete') {
    await Project.findOneAndDelete({ _id: entityId, userId })
    return { mutationId, entityId, status: 'accepted' }
  }
  return { mutationId, entityId, status: 'rejected', reason: 'Unknown op' }
}

// ─── Serialisers (for conflict responses) ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeNote(n: any) {
  return { _id: n._id.toString(), title: n.title, content: n.content, tags: n.tags, pinned: n.pinned, archived: n.archived, serverRevision: n.serverRevision ?? 0, updatedAt: n.updatedAt?.toISOString() }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeTask(t: any) {
  return { _id: t._id.toString(), title: t.title, description: t.description, completed: t.completed, priority: t.priority, dueDate: t.dueDate, dueTime: t.dueTime, recurring: t.recurring, serverRevision: t.serverRevision ?? 0, updatedAt: t.updatedAt?.toISOString() }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeHabit(h: any) {
  return { _id: h._id.toString(), name: h.name, icon: h.icon, description: h.description, frequency: h.frequency, target: h.target, serverRevision: h.serverRevision ?? 0, updatedAt: h.updatedAt?.toISOString() }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeExpense(e: any) {
  return { _id: e._id.toString(), amount: e.amount, category: e.category, description: e.description, date: e.date, paymentMethod: e.paymentMethod, serverRevision: e.serverRevision ?? 0, updatedAt: e.updatedAt?.toISOString() }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeSub(s: any) {
  return { _id: s._id.toString(), serviceName: s.serviceName, amountMinor: s.amountMinor, status: s.status, serverRevision: s.serverRevision ?? 0 }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeProject(p: any) {
  return { _id: p._id.toString(), title: p.title, description: p.description, status: p.status, dueDate: p.dueDate, color: p.color, serverRevision: p.serverRevision ?? 0, updatedAt: p.updatedAt?.toISOString() }
}
