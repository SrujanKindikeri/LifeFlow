/**
 * PATCH  /api/money-records/[id]/payments/[paymentId]  — edit a payment
 * DELETE /api/money-records/[id]/payments/[paymentId]  — delete a payment
 *
 * Both operations:
 *  - verify ownership of both the record and the payment
 *  - recalculate balance + status after the mutation
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import { moneyPaymentUpdateSchema } from '@/lib/validations'
import {
  calcBalance,
  deriveStatus,
  rupeesToPaise,
  validatePaymentEdit,
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

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id: recordId, paymentId } = await params
    await connectDB()

    // Verify record ownership
    const record = await MoneyRecord.findOne({ _id: recordId, userId })
    if (!record) {
      return NextResponse.json({ error: 'Money record not found' }, { status: 404 })
    }

    // Verify payment ownership & association
    const payment = await MoneyPayment.findOne({ _id: paymentId, userId, moneyRecordId: recordId })
    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    const body = await req.json()
    const parsed = moneyPaymentUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    const { amount, paymentDate, note } = parsed.data

    // If changing the amount, validate against remaining balance
    if (amount !== undefined) {
      const newAmountMinor = rupeesToPaise(amount)

      // Remaining balance excluding the current payment (as if it were deleted)
      const otherPayments = await MoneyPayment.find({
        moneyRecordId: recordId,
        _id: { $ne: paymentId },
      }).lean()
      const balanceWithoutThisPayment = calcBalance(
        record.originalAmountMinor,
        (otherPayments as unknown as IMoneyPayment[]).map((p) => p.amountMinor)
      )

      const validation = validatePaymentEdit(
        balanceWithoutThisPayment.remainingMinor,
        payment.amountMinor,
        newAmountMinor
      )
      if (!validation.ok) {
        return NextResponse.json(
          { error: validation.error, maxAllowedMinor: validation.maxAllowedMinor },
          { status: 422 }
        )
      }

      payment.amountMinor = newAmountMinor
    }

    if (paymentDate !== undefined) payment.paymentDate = paymentDate
    if (note !== undefined) payment.note = note
    await payment.save()

    // Recalculate balance + status
    const allPayments = await MoneyPayment.find({ moneyRecordId: recordId })
      .sort({ paymentDate: 1, createdAt: 1 })
      .lean()
    const newBalance = calcBalance(
      record.originalAmountMinor,
      (allPayments as unknown as IMoneyPayment[]).map((p) => p.amountMinor)
    )
    record.status = deriveStatus(newBalance, record.dueDate)
    await record.save()

    return NextResponse.json({
      payment: serializePayment(payment as unknown as IMoneyPayment),
      record: serializeRecord(
        record as unknown as IMoneyRecord,
        allPayments as unknown as IMoneyPayment[]
      ),
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[payments/[paymentId] PATCH]', err)
    return NextResponse.json({ error: 'Failed to update payment' }, { status: 500 })
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id: recordId, paymentId } = await params
    await connectDB()

    // Verify record ownership
    const record = await MoneyRecord.findOne({ _id: recordId, userId })
    if (!record) {
      return NextResponse.json({ error: 'Money record not found' }, { status: 404 })
    }

    // Verify payment ownership & delete
    const payment = await MoneyPayment.findOneAndDelete({
      _id: paymentId,
      userId,
      moneyRecordId: recordId,
    })
    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Recalculate balance + status
    const remainingPayments = await MoneyPayment.find({ moneyRecordId: recordId })
      .sort({ paymentDate: 1, createdAt: 1 })
      .lean()
    const newBalance = calcBalance(
      record.originalAmountMinor,
      (remainingPayments as unknown as IMoneyPayment[]).map((p) => p.amountMinor)
    )
    record.status = deriveStatus(newBalance, record.dueDate)
    await record.save()

    return NextResponse.json({
      message: 'Payment deleted',
      record: serializeRecord(
        record as unknown as IMoneyRecord,
        remainingPayments as unknown as IMoneyPayment[]
      ),
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[payments/[paymentId] DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete payment' }, { status: 500 })
  }
}
