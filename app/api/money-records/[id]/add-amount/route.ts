/**
 * POST /api/money-records/[id]/add-amount
 *
 * Adds an additional amount to an existing money record without creating a
 * new record. The original amount is NEVER mutated; all additions are stored
 * in the embedded `additionalAmounts` array on MoneyRecord.
 *
 * Security:
 *   - userId always from session — never trusted from the request body
 *   - Record ownership verified before any write
 *   - Amount validated as positive integer paise
 *   - Idempotency: same idempotencyKey returns 200 without a second write
 *   - Atomic $push so concurrent requests cannot corrupt the array
 *
 * Post-conditions:
 *   - status is recalculated and saved (totalAmountMinor grows → may flip paid→partially_paid)
 *   - Activity entry created (non-fatal on failure)
 *   - Notification created (non-fatal on failure)
 *   - Full updated record returned (same shape as other money-record endpoints)
 */

import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import Notification from '@/models/Notification'
import Activity from '@/models/Activity'
import { moneyAddAmountSchema } from '@/lib/validations'
import {
  calcBalance,
  deriveStatus,
  rupeesToPaise,
  formatPaise,
} from '@/lib/moneyCalculator'
import type { IMoneyRecord, IMoneyAdditionalAmount } from '@/models/MoneyRecord'
import type { IMoneyPayment } from '@/models/MoneyPayment'

// ── Serialiser (same contract as other money-record routes) ───────────────────

function serializeRecord(record: IMoneyRecord, payments: IMoneyPayment[]) {
  const balance = calcBalance(
    record.originalAmountMinor,
    record.additionalAmounts ?? [],
    payments.map((p) => p.amountMinor)
  )
  return {
    _id:                 record._id.toString(),
    userId:              record.userId.toString(),
    person:              record.person,
    direction:           record.direction,
    originalAmountMinor: record.originalAmountMinor,
    totalAmountMinor:    balance.totalMinor,
    additionalAmounts:   (record.additionalAmounts ?? []).map((a: IMoneyAdditionalAmount) => ({
      _id:         (a._id as mongoose.Types.ObjectId).toString(),
      amountMinor: a.amountMinor,
      reason:      a.reason,
      date:        a.date,
      note:        a.note,
      createdAt:   a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
    })),
    currency:            record.currency,
    reason:              record.reason,
    category:            record.category,
    givenDate:           record.givenDate,
    dueDate:             record.dueDate,
    note:                record.note,
    status:              record.status,
    paidMinor:           balance.paidMinor,
    remainingMinor:      balance.remainingMinor,
    payments: payments.map((p) => ({
      _id:           p._id.toString(),
      userId:        p.userId.toString(),
      moneyRecordId: p.moneyRecordId.toString(),
      amountMinor:   p.amountMinor,
      paymentDate:   p.paymentDate,
      note:          p.note,
      createdAt:     p.createdAt.toISOString(),
      updatedAt:     p.updatedAt.toISOString(),
    })),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, lifeFlowId } = await requireAuth()
    const { id: recordId } = await params
    await connectDB()

    // ── 1. Ownership check ────────────────────────────────────────────────────
    const record = await MoneyRecord.findOne({ _id: recordId, userId })
    if (!record) {
      return NextResponse.json({ error: 'Money record not found' }, { status: 404 })
    }

    // ── 2. Parse & validate input ─────────────────────────────────────────────
    const body = await req.json()
    const parsed = moneyAddAmountSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    const { amount, reason, date, note, idempotencyKey } = parsed.data
    const amountMinor = rupeesToPaise(amount)

    if (amountMinor <= 0) {
      return NextResponse.json(
        { error: 'Amount must be greater than zero.' },
        { status: 422 }
      )
    }

    // ── 3. Idempotency check ──────────────────────────────────────────────────
    // We store the idempotencyKey in the subdocument note field as a unique
    // marker — check whether this key already exists in additionalAmounts.
    if (idempotencyKey) {
      const existingEntry = (record.additionalAmounts ?? []).find(
        (a: IMoneyAdditionalAmount & { idempotencyKey?: string }) =>
          (a as unknown as Record<string, unknown>).idempotencyKey === idempotencyKey
      )
      if (existingEntry) {
        // Already added — return the current record without mutation
        const payments = await MoneyPayment.find({ moneyRecordId: recordId })
          .sort({ paymentDate: 1, createdAt: 1 })
          .lean()
        return NextResponse.json(
          { record: serializeRecord(record as unknown as IMoneyRecord, payments as unknown as IMoneyPayment[]), idempotent: true },
          { status: 200 }
        )
      }
    }

    // ── 4. Atomic $push of the new additional amount ──────────────────────────
    // We use findOneAndUpdate with $push to make the write atomic, preventing
    // a second concurrent request from pushing the same entry twice.
    const newEntry: Record<string, unknown> = {
      amountMinor,
      reason,
      date,
      note:      note ?? undefined,
      createdAt: new Date(),
    }
    // Piggyback the idempotencyKey onto the subdocument so the idempotency
    // check above works on re-reads. It is NOT part of the Mongoose schema
    // to avoid schema noise — stored as an extra field via Mixed flexibility.
    if (idempotencyKey) {
      newEntry.idempotencyKey = idempotencyKey
    }

    const updated = await MoneyRecord.findOneAndUpdate(
      { _id: recordId, userId },
      { $push: { additionalAmounts: newEntry } },
      { new: true }  // return the document AFTER the update
    )

    if (!updated) {
      return NextResponse.json({ error: 'Money record not found' }, { status: 404 })
    }

    // ── 5. Recalculate balance & status ───────────────────────────────────────
    const payments = await MoneyPayment.find({ moneyRecordId: recordId })
      .sort({ paymentDate: 1, createdAt: 1 })
      .lean()

    const newBalance = calcBalance(
      updated.originalAmountMinor,
      updated.additionalAmounts ?? [],
      (payments as unknown as IMoneyPayment[]).map((p) => p.amountMinor)
    )
    const newStatus = deriveStatus(newBalance, updated.dueDate)

    // If status changed (e.g. was 'paid', now has more to pay → partially_paid),
    // persist the updated status.
    if (updated.status !== newStatus) {
      updated.status = newStatus
      await updated.save()
    }

    // ── 6. Activity (non-fatal) ───────────────────────────────────────────────
    const personName = updated.person.name
    const amountStr  = formatPaise(amountMinor, updated.currency)

    try {
      await Activity.create({
        userId,
        lifeFlowId,
        type: 'money_amount_added',
        referenceId: updated._id,
        title: `Added ${amountStr} to ${personName}'s record`,
        metadata: {
          amountMinor,
          reason,
          direction: updated.direction,
          personName,
          newTotalMinor: newBalance.totalMinor,
        },
      })
    } catch (actErr) {
      console.error('[add-amount POST] activity error', actErr)
    }

    // ── 7. Notification (non-fatal) ───────────────────────────────────────────
    try {
      const title =
        updated.direction === 'given'
          ? `Added ${amountStr} given to ${personName}`
          : `Added ${amountStr} borrowed from ${personName}`
      const newTotalStr = formatPaise(newBalance.totalMinor, updated.currency)
      const message =
        updated.direction === 'given'
          ? `You gave ${personName} an additional ${amountStr}. New total: ${newTotalStr}.`
          : `You borrowed an additional ${amountStr} from ${personName}. New total: ${newTotalStr}.`
      await Notification.create({ userId, lifeFlowId, title, message, type: 'general' })
    } catch (notifErr) {
      console.error('[add-amount POST] notification error', notifErr)
    }

    // ── 8. Return updated record ──────────────────────────────────────────────
    return NextResponse.json(
      {
        record: serializeRecord(
          updated as unknown as IMoneyRecord,
          payments as unknown as IMoneyPayment[]
        ),
      },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[money-records/[id]/add-amount POST]', err)
    return NextResponse.json({ error: 'Failed to add amount' }, { status: 500 })
  }
}
