/**
 * GET    /api/money-records/[id]  — fetch single record + payments
 * PATCH  /api/money-records/[id]  — update record fields
 * DELETE /api/money-records/[id]  — delete record + all its payments
 *
 * Security: ownership verified via userId from session on every operation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import { moneyRecordUpdateSchema } from '@/lib/validations'
import { calcBalance, deriveStatus, rupeesToPaise } from '@/lib/moneyCalculator'
import type { IMoneyRecord } from '@/models/MoneyRecord'
import type { IMoneyPayment } from '@/models/MoneyPayment'

function serializeRecord(record: IMoneyRecord, payments: IMoneyPayment[]) {
  const balance = calcBalance(
    record.originalAmountMinor,
    payments.map((p) => p.amountMinor)
  )
  return {
    _id:                 record._id.toString(),
    userId:              record.userId.toString(),
    person:              record.person,
    direction:           record.direction,
    originalAmountMinor: record.originalAmountMinor,
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

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    await connectDB()

    const record = await MoneyRecord.findOne({ _id: id, userId }).lean()
    if (!record) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const payments = await MoneyPayment.find({ moneyRecordId: id })
      .sort({ paymentDate: 1, createdAt: 1 })
      .lean()

    return NextResponse.json({
      record: serializeRecord(record as unknown as IMoneyRecord, payments as unknown as IMoneyPayment[]),
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[money-records/[id] GET]', err)
    return NextResponse.json({ error: 'Failed to fetch money record' }, { status: 500 })
  }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    await connectDB()

    const record = await MoneyRecord.findOne({ _id: id, userId })
    if (!record) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await req.json()
    const parsed = moneyRecordUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    const { amount, ...rest } = parsed.data
    const updateData: Record<string, unknown> = { ...rest }
    if (amount !== undefined) {
      updateData.originalAmountMinor = rupeesToPaise(amount)
    }

    Object.assign(record, updateData)

    // Recalculate status after potential amount/dueDate change
    const payments = await MoneyPayment.find({ moneyRecordId: id }).lean()
    const balance = calcBalance(
      record.originalAmountMinor,
      (payments as unknown as IMoneyPayment[]).map((p) => p.amountMinor)
    )
    record.status = deriveStatus(balance, record.dueDate)
    await record.save()

    return NextResponse.json({
      record: serializeRecord(record as unknown as IMoneyRecord, payments as unknown as IMoneyPayment[]),
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[money-records/[id] PATCH]', err)
    return NextResponse.json({ error: 'Failed to update money record' }, { status: 500 })
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    await connectDB()

    const record = await MoneyRecord.findOneAndDelete({ _id: id, userId })
    if (!record) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Cascade-delete all payments for this record
    await MoneyPayment.deleteMany({ moneyRecordId: id })

    return NextResponse.json({ message: 'Deleted' })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[money-records/[id] DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete money record' }, { status: 500 })
  }
}
