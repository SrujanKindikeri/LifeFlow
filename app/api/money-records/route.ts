/**
 * GET  /api/money-records  — list the authenticated user's money records
 * POST /api/money-records  — create a new money record
 *
 * Security: userId is ALWAYS read from the session. Never trusted from body.
 *
 * personId handling (POST):
 *   If the client supplies a personId the server:
 *     1. Verifies the Person document exists AND belongs to the same userId.
 *     2. Copies the current name/email/phone from that Person into the
 *        embedded person sub-document so the record is self-contained.
 *     3. Stores the personId reference for live-lookup and future sync.
 *   If personId is absent the submitted person fields are used as-is
 *   (backward-compatible path for legacy / manual entry).
 */

import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import Person from '@/models/Person'
import { moneyRecordSchema } from '@/lib/validations'
import { calcBalance, rupeesToPaise } from '@/lib/moneyCalculator'
import type { IMoneyRecord } from '@/models/MoneyRecord'
import type { IMoneyAdditionalAmount } from '@/models/MoneyRecord'
import type { IMoneyPayment } from '@/models/MoneyPayment'
import type { IPerson } from '@/models/Person'

// ── Serialiser ────────────────────────────────────────────────────────────────

function serializeRecord(
  record: IMoneyRecord,
  payments: IMoneyPayment[]
) {
  const balance = calcBalance(
    record.originalAmountMinor,
    record.additionalAmounts ?? [],
    payments.map((p) => p.amountMinor)
  )
  return {
    _id:                 record._id.toString(),
    userId:              record.userId.toString(),
    personId:            record.personId ? record.personId.toString() : undefined,
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

// ── Shared helper: resolve + verify a personId ─────────────────────────────
/**
 * If personId is supplied, look it up and confirm it belongs to userId.
 * Returns the Person document (lean) on success.
 * Returns null if personId is absent (caller uses submitted person fields).
 * Throws a Response-shaped error object on ownership/not-found failures so
 * callers can return it directly.
 */
async function resolvePersonId(
  personId: string | undefined,
  userId: string
): Promise<{ person: IPerson | null; errorResponse: NextResponse | null }> {
  if (!personId) return { person: null, errorResponse: null }

  if (!mongoose.Types.ObjectId.isValid(personId)) {
    return {
      person: null,
      errorResponse: NextResponse.json({ error: 'Invalid personId' }, { status: 400 }),
    }
  }

  // Find the Person — the userId filter guarantees cross-user access is impossible.
  const found = await Person.findOne({ _id: personId, userId })
    .select('_id name phone email linkedLifeFlowId')
    .lean<IPerson>()

  if (!found) {
    return {
      person: null,
      errorResponse: NextResponse.json(
        { error: 'Person not found or does not belong to you.' },
        { status: 404 }
      ),
    }
  }

  return { person: found, errorResponse: null }
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
    const { userId, lifeFlowId } = await requireAuth()
    await connectDB()

    const body = await req.json()
    const parsed = moneyRecordSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    const { amount, currency, personId, person: submittedPerson, ...rest } = parsed.data

    // ── personId ownership check ───────────────────────────────────────────
    const { person: linkedPerson, errorResponse } = await resolvePersonId(personId, userId)
    if (errorResponse) return errorResponse

    // If a valid linked person was found, use their current details for the
    // embedded sub-document so names/emails stay in sync with the People directory.
    // Fall back to whatever the client submitted if no link is provided.
    const personData = linkedPerson
      ? {
          name:             linkedPerson.name,
          phone:            linkedPerson.phone,
          email:            linkedPerson.email,
          linkedLifeFlowId: linkedPerson.linkedLifeFlowId,
        }
      : submittedPerson

    const originalAmountMinor = rupeesToPaise(amount)

    const record = await MoneyRecord.create({
      userId,
      lifeFlowId,
      ...(personId ? { personId: new mongoose.Types.ObjectId(personId) } : {}),
      person: personData,
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
