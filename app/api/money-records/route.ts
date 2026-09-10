/**
 * GET  /api/money-records  — list the authenticated user's money records
 * POST /api/money-records  — create a new money record
 *
 * Security: userId is ALWAYS read from the session. Never trusted from body.
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import { moneyRecordSchema } from '@/lib/validations'
import { calcBalance, rupeesToPaise } from '@/lib/moneyCalculator'
import type { IMoneyRecord } from '@/models/MoneyRecord'
import type { IMoneyPayment } from '@/models/MoneyPayment'

// ── Serialiser ────────────────────────────────────────────────────────────────

function serializeRecord(
  record: IMoneyRecord,
  payments: IMoneyPayment[]
) {
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

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = req.nextUrl
    const direction = searchParams.get('direction') // 'given' | 'borrowed' | null
    const status    = searchParams.get('status')    // 'pending' | 'partially_paid' | 'paid' | 'overdue' | null
    const sort      = searchParams.get('sort') ?? 'newest'
    const person    = searchParams.get('person')    // name search

    const query: Record<string, unknown> = { userId }
    if (direction && ['given', 'borrowed'].includes(direction)) query.direction = direction
    if (status && ['pending', 'partially_paid', 'paid', 'overdue'].includes(status)) query.status = status
    if (person) {
      const escaped = person.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      query['person.name'] = new RegExp(escaped, 'i')
    }

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      newest:      { givenDate: -1, createdAt: -1 },
      oldest:      { givenDate:  1, createdAt:  1 },
      highest:     { originalAmountMinor: -1 },
      due_soon:    { dueDate: 1 },
    }
    const sortObj = sortMap[sort] ?? sortMap.newest

    const records = await MoneyRecord.find(query).sort(sortObj).lean()

    if (records.length === 0) {
      return NextResponse.json({ records: [] })
    }

    // Fetch all payments for these records in a single query
    const recordIds = records.map((r) => r._id)
    const allPayments = await MoneyPayment.find({
      moneyRecordId: { $in: recordIds },
    })
      .sort({ paymentDate: 1, createdAt: 1 })
      .lean()

    // Group payments by record
    const paymentMap = new Map<string, IMoneyPayment[]>()
    for (const p of allPayments) {
      const key = p.moneyRecordId.toString()
      if (!paymentMap.has(key)) paymentMap.set(key, [])
      paymentMap.get(key)!.push(p)
    }

    const serialized = records.map((r) =>
      serializeRecord(r as unknown as IMoneyRecord, paymentMap.get(r._id.toString()) ?? [])
    )

    // For 'highest_outstanding' sort, re-sort in memory after balance calc
    if (sort === 'highest_outstanding') {
      serialized.sort((a, b) => b.remainingMinor - a.remainingMinor)
    }

    return NextResponse.json({ records: serialized })
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[money-records GET]', err)
    return NextResponse.json({ error: 'Failed to fetch money records' }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const body = await req.json()
    const parsed = moneyRecordSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    const { amount, currency, ...rest } = parsed.data
    const originalAmountMinor = rupeesToPaise(amount)

    const record = await MoneyRecord.create({
      userId,
      ...rest,
      originalAmountMinor,
      currency: currency ?? 'INR',
      status: 'pending',
    })

    return NextResponse.json(
      { record: serializeRecord(record as unknown as IMoneyRecord, []) },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[money-records POST]', err)
    return NextResponse.json({ error: 'Failed to create money record' }, { status: 500 })
  }
}
