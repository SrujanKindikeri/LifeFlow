/**
 * POST /api/drafts/[id]/finalize
 *
 * Converts a draft into a real record.
 * The caller must pass the finalized payload in the request body — the server
 * validates it exactly as the normal creation endpoint would, then deletes the
 * draft upon success.
 *
 * NOTE: This route does NOT create the real record itself. Creating the real
 * record is the responsibility of the feature's own API route. This route
 * simply validates ownership and deletes the draft after the client has
 * successfully called the real API. Use the `deleteOnly` flag for that pattern.
 *
 * Alternatively, pass `inline: true` together with the validated payload and
 * we create the record here in a single round-trip (supported for: note, task,
 * habit, expense, goal, project, subscription, savingsGoal, moneyGiven,
 * moneyBorrowed).
 */

import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Draft from '@/models/Draft'
import Note from '@/models/Note'
import Task from '@/models/Task'
import Habit from '@/models/Habit'
import Expense from '@/models/Expense'
import Goal from '@/models/Goal'
import Project from '@/models/Project'
import Subscription from '@/models/Subscription'
import SavingsGoal from '@/models/SavingsGoal'
import MoneyRecord from '@/models/MoneyRecord'
import {
  noteSchema,
  taskSchema,
  habitSchema,
  expenseSchema,
  groupBillSchema,
} from '@/lib/validations'
import { z } from 'zod'

// ─── Extra validation schemas (not already in validations.ts) ─────────────────

const goalFinalizeSchema = z.object({
  title:        z.string().min(1, 'Title is required').max(200),
  description:  z.string().max(1000).optional(),
  category:     z.enum(['health','finance','education','career','personal','fitness','creative','other']).default('personal'),
  targetValue:  z.number().positive('Target must be positive'),
  unit:         z.string().max(50).default('units'),
  startDate:    z.string().min(1, 'Start date is required'),
  targetDate:   z.string().optional(),
})

const projectFinalizeSchema = z.object({
  title:       z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional(),
  dueDate:     z.string().optional(),
  status:      z.enum(['active','on_hold','completed','archived']).default('active'),
  color:       z.string().max(7).optional(),
})

const subscriptionFinalizeSchema = z.object({
  serviceName:       z.string().min(1, 'Service name is required').max(100),
  amount:            z.number().positive('Amount must be positive'),
  currency:          z.string().max(5).default('INR'),
  billingCycle:      z.enum(['weekly','monthly','quarterly','yearly','custom']).default('monthly'),
  customIntervalDays:z.number().int().min(1).optional(),
  nextBillingDate:   z.string().min(1, 'Next billing date is required'),
  category:          z.enum(['streaming','music','software','cloud','fitness','news','gaming','education','utilities','other']).default('other'),
  paymentMethod:     z.string().max(100).optional(),
  status:            z.enum(['active','paused','cancelled']).default('active'),
  notes:             z.string().max(500).optional(),
})

const savingsGoalFinalizeSchema = z.object({
  title:       z.string().min(1, 'Title is required').max(200),
  targetAmount:z.number().positive('Target amount must be positive'),
  currency:    z.string().max(5).default('INR'),
  icon:        z.string().max(10).optional(),
  color:       z.string().max(7).optional(),
  targetDate:  z.string().optional(),
  notes:       z.string().max(500).optional(),
})

const moneyRecordFinalizeSchema = z.object({
  direction: z.enum(['given', 'borrowed']),
  person: z.object({
    name:       z.string().min(1, 'Person name is required').max(100),
    phone:      z.string().max(20).optional(),
    email:      z.string().email().max(200).optional().or(z.literal('')),
    lifeFlowId: z.string().max(20).optional(),
  }),
  amount:    z.number().positive('Amount must be positive').max(10_000_000),
  currency:  z.string().max(5).default('INR'),
  reason:    z.string().min(1, 'Reason is required').max(500),
  category:  z.string().max(100).optional(),
  givenDate: z.string().min(1, 'Date is required'),
  dueDate:   z.string().optional(),
  note:      z.string().max(1000).optional(),
})

// ─── POST /api/drafts/[id]/finalize ──────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    const body = await req.json()

    await connectDB()

    // 1. Verify draft ownership
    const draft = await Draft.findOne({ _id: id, userId })
    if (!draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }

    // 2. If `deleteOnly` — caller already created the real record, just clean up
    if (body.deleteOnly === true) {
      await Draft.deleteOne({ _id: id, userId })
      return NextResponse.json({ success: true, action: 'deleted' })
    }

    // 3. Inline creation: validate + create real record + delete draft
    const { type } = draft
    const payload = body.payload as Record<string, unknown>

    let created: Record<string, unknown> | null = null

    // Prevent double-submission: disable the button on client but guard server too
    // (idempotency could be added here via a lock; for now we rely on client UI)

    if (type === 'note') {
      const parsed = noteSchema.safeParse(payload)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
      }
      const doc = await Note.create({ ...parsed.data, userId })
      created = { _id: doc._id.toString(), type: 'note' }
    }

    else if (type === 'task') {
      const parsed = taskSchema.safeParse(payload)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
      }
      const doc = await Task.create({ ...parsed.data, userId })
      created = { _id: doc._id.toString(), type: 'task' }
    }

    else if (type === 'habit') {
      const parsed = habitSchema.safeParse(payload)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
      }
      const doc = await Habit.create({ ...parsed.data, userId })
      created = { _id: doc._id.toString(), type: 'habit' }
    }

    else if (type === 'expense') {
      const parsed = expenseSchema.safeParse(payload)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
      }
      const doc = await Expense.create({ ...parsed.data, userId, source: 'personal' })
      created = { _id: doc._id.toString(), type: 'expense' }
    }

    else if (type === 'groupBill') {
      const parsed = groupBillSchema.safeParse(payload)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
      }
      // GroupBill creation is complex (settlements, expense integration) —
      // delegate to the existing group-bills route via internal logic
      // For simplicity and to avoid code duplication, we just validate here
      // and inform the client to call /api/group-bills directly.
      // The client will then call DELETE on the draft with deleteOnly=true.
      return NextResponse.json({
        success: false,
        redirect: '/api/group-bills',
        message: 'Use /api/group-bills to create the group bill, then call finalize with deleteOnly=true',
      }, { status: 422 })
    }

    else if (type === 'goal') {
      const parsed = goalFinalizeSchema.safeParse(payload)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
      }
      const doc = await Goal.create({ ...parsed.data, userId, currentValue: 0, status: 'active' })
      created = { _id: doc._id.toString(), type: 'goal' }
    }

    else if (type === 'project') {
      const parsed = projectFinalizeSchema.safeParse(payload)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
      }
      const doc = await Project.create({ ...parsed.data, userId })
      created = { _id: doc._id.toString(), type: 'project' }
    }

    else if (type === 'subscription') {
      const parsed = subscriptionFinalizeSchema.safeParse(payload)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
      }
      const amountMinor = Math.round(parsed.data.amount * 100)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { amount: _amount, ...rest } = parsed.data
      const doc = await Subscription.create({ ...rest, amountMinor, userId })
      created = { _id: doc._id.toString(), type: 'subscription' }
    }

    else if (type === 'savingsGoal') {
      const parsed = savingsGoalFinalizeSchema.safeParse(payload)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
      }
      const targetAmountMinor = Math.round(parsed.data.targetAmount * 100)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { targetAmount: _ta, ...rest } = parsed.data
      const doc = await SavingsGoal.create({ ...rest, targetAmountMinor, userId })
      created = { _id: doc._id.toString(), type: 'savingsGoal' }
    }

    else if (type === 'moneyGiven' || type === 'moneyBorrowed') {
      const parsed = moneyRecordFinalizeSchema.safeParse(payload)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
      }
      const originalAmountMinor = Math.round(parsed.data.amount * 100)
      const direction = type === 'moneyGiven' ? 'given' : 'borrowed'
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { amount: _amt, ...rest } = parsed.data
      const doc = await MoneyRecord.create({
        ...rest,
        direction,
        originalAmountMinor,
        userId,
        status: 'pending',
      })
      created = { _id: doc._id.toString(), type: direction === 'given' ? 'moneyGiven' : 'moneyBorrowed' }
    }

    else {
      return NextResponse.json({ error: `Unsupported draft type: ${type}` }, { status: 400 })
    }

    // 4. Delete draft after successful creation (inside same try block for atomicity)
    await Draft.deleteOne({ _id: id, userId })

    return NextResponse.json({ success: true, created })

  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof mongoose.Error.CastError) {
      return NextResponse.json({ error: 'Invalid draft ID' }, { status: 400 })
    }
    console.error('[drafts finalize POST]', error)
    return NextResponse.json({ error: 'Failed to finalize draft' }, { status: 500 })
  }
}
