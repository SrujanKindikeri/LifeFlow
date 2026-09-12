/**
 * POST /api/money-records/[id]/payments
 *
 * Record a new payment against a money record.
 *
 * Security:
 *   - userId always from session
 *   - Record ownership verified before any write
 *   - Overpayment protection: validates new payment ≤ remaining balance
 *   - Idempotency: duplicate key returns 200 (not 201) without creating a second payment
 *   - Status recalculated server-side after every successful payment
 *
 * Notification:
 *   - "Payment received" or "Payment made" created after save
 *   - "Fully paid" notification created when remaining reaches 0
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import Notification from '@/models/Notification'
import { moneyPaymentSchema } from '@/lib/validations'
import {
  calcBalance,
  deriveStatus,
  rupeesToPaise,
  formatPaise,
  validatePayment,
} from '@/lib/moneyCalculator'
import type { IMoneyRecord } from '@/models/MoneyRecord'
import type { IMoneyPayment } from '@/models/MoneyPayment'

function serializePayment(p: IMoneyPayment) {
  return {
    _id:           p._id.toString(),
    userId:        p.userId.toString(),
    moneyRecordId: p.moneyRecordId.toString(),
    amountMinor:   p.amountMinor,
    paymentDate:   p.paymentDate,
    note:          p.note,
    createdAt:     p.createdAt.toISOString(),
    updatedAt:     p.updatedAt.toISOString(),
  }
}

function serializeRecord(record: IMoneyRecord, payments: IMoneyPayment[]) {
  const balance = calcBalance(
    record.originalAmountMinor,
    payments.map((p) => p.amountMinor)
  )
  return {
    _id:                 record._id.toString(),
    person:              record.person,
    direction:           record.direction,
    originalAmountMinor: record.originalAmountMinor,
    currency:            record.currency,
    reason:              record.reason,
    givenDate:           record.givenDate,
    dueDate:             record.dueDate,
    note:                record.note,
    status:              record.status,
    paidMinor:           balance.paidMinor,
    remainingMinor:      balance.remainingMinor,
    payments:            payments.map(serializePayment),
    createdAt:           record.createdAt.toISOString(),
    updatedAt:           record.updatedAt.toISOString(),
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, lifeFlowId } = await requireAuth()
    const { id: recordId } = await params
    await connectDB()

    // ── 1. Find and verify ownership ──────────────────────────────────────────
    const record = await MoneyRecord.findOne({ _id: recordId, userId })
    if (!record) {
      return NextResponse.json({ error: 'Money record not found' }, { status: 404 })
    }

    // Already fully paid — no more payments allowed
    if (record.status === 'paid') {
      return NextResponse.json({ error: 'This record is already fully paid.' }, { status: 400 })
    }

    // ── 2. Parse & validate input ─────────────────────────────────────────────
    const body = await req.json()
    const parsed = moneyPaymentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    const { amount, paymentDate, note, idempotencyKey } = parsed.data
    const amountMinor = rupeesToPaise(amount)

    // ── 3. Idempotency check ──────────────────────────────────────────────────
    if (idempotencyKey) {
      const existing = await MoneyPayment.findOne({ userId, idempotencyKey }).lean()
      if (existing) {
        // Already recorded — return the existing data without creating a duplicate
        const allPayments = await MoneyPayment.find({ moneyRecordId: recordId })
          .sort({ paymentDate: 1, createdAt: 1 })
          .lean()
        return NextResponse.json(
          { record: serializeRecord(record as unknown as IMoneyRecord, allPayments as unknown as IMoneyPayment[]), idempotent: true },
          { status: 200 }
        )
      }
    }

    // ── 4. Calculate current remaining balance ────────────────────────────────
    const existingPayments = await MoneyPayment.find({ moneyRecordId: recordId }).lean()
    const balance = calcBalance(
      record.originalAmountMinor,
      (existingPayments as unknown as IMoneyPayment[]).map((p) => p.amountMinor)
    )

    // ── 5. Overpayment guard ──────────────────────────────────────────────────
    const validation = validatePayment(balance.remainingMinor, amountMinor)
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error, maxAllowedMinor: validation.maxAllowedMinor },
        { status: 422 }
      )
    }

    // ── 6. Create payment ─────────────────────────────────────────────────────
    const payment = await MoneyPayment.create({
      userId,
      lifeFlowId,
      moneyRecordId: recordId,
      amountMinor,
      paymentDate,
      note: note ?? undefined,
      idempotencyKey: idempotencyKey ?? undefined,
    })

    // ── 7. Recalculate balance & status ───────────────────────────────────────
    const updatedPayments = [...existingPayments, payment]
    const newBalance = calcBalance(
      record.originalAmountMinor,
      (updatedPayments as unknown as IMoneyPayment[]).map((p) => p.amountMinor)
    )
    const newStatus = deriveStatus(newBalance, record.dueDate)
    record.status = newStatus
    await record.save()

    // ── 8. Sort payments for response ─────────────────────────────────────────
    const sortedPayments = await MoneyPayment.find({ moneyRecordId: recordId })
      .sort({ paymentDate: 1, createdAt: 1 })
      .lean()

    // ── 9. Notifications ──────────────────────────────────────────────────────
    const personName = record.person.name
    const amountStr  = formatPaise(amountMinor, record.currency)

    try {
      if (newStatus === 'paid') {
        // Fully paid notification
        const title =
          record.direction === 'given'
            ? `${personName} fully repaid you`
            : 'You fully repaid'
        const message =
          record.direction === 'given'
            ? `${personName} has fully repaid ${formatPaise(record.originalAmountMinor, record.currency)}.`
            : `You have fully repaid ${formatPaise(record.originalAmountMinor, record.currency)} to ${personName}.`
        await Notification.create({ userId, lifeFlowId, title, message, type: 'general' })
      } else {
        // Partial payment notification
        const title =
          record.direction === 'given'
            ? `${personName} paid you ${amountStr}`
            : `You paid ${personName} ${amountStr}`
        const remainingStr = formatPaise(newBalance.remainingMinor, record.currency)
        const noteClause = note ? ` Note: "${note}"` : ''
        const message =
          record.direction === 'given'
            ? `${personName} paid you ${amountStr}.${noteClause} Remaining: ${remainingStr}.`
            : `You paid ${personName} ${amountStr}.${noteClause} Remaining: ${remainingStr}.`
        await Notification.create({ userId, lifeFlowId, title, message, type: 'general' })
      }
    } catch (notifErr) {
      // Non-fatal — log but do not fail the payment
      console.error('[payments POST] notification error', notifErr)
    }

    return NextResponse.json(
      {
        payment: serializePayment(payment as unknown as IMoneyPayment),
        record: serializeRecord(
          record as unknown as IMoneyRecord,
          sortedPayments as unknown as IMoneyPayment[]
        ),
      },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[money-records/[id]/payments POST]', err)
    return NextResponse.json({ error: 'Failed to record payment' }, { status: 500 })
  }
}
