/**
 * GET    /api/money-records/[id]  — fetch single record + payments
 * PATCH  /api/money-records/[id]  — update record fields
 * DELETE /api/money-records/[id]  — delete record + all its payments
 *
 * Security: ownership verified via userId from session on every operation.
 *
 * personId handling (PATCH):
 *   If the client sends personId the server verifies ownership (same userId)
 *   and refreshes the embedded person sub-document from the People record.
 *   Sending personId: null explicitly unlinks the record (embedded person
 *   fields remain as a snapshot).
 */

import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import Person from '@/models/Person'
import { moneyRecordUpdateSchema } from '@/lib/validations'
import { calcBalance, deriveStatus, rupeesToPaise } from '@/lib/moneyCalculator'
import type { IMoneyRecord, IMoneyAdditionalAmount } from '@/models/MoneyRecord'
import type { IMoneyPayment } from '@/models/MoneyPayment'
import type { IPerson } from '@/models/Person'

// ── Serialiser ────────────────────────────────────────────────────────────────

function serializeRecord(record: IMoneyRecord, payments: IMoneyPayment[]) {
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

  // The userId filter is the ownership gate — cross-user access is impossible.
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

    const { amount, personId, person: submittedPerson, ...rest } = parsed.data

    // ── personId ownership check ───────────────────────────────────────────
    // personId present in body → validate + refresh embedded person fields
    // personId explicitly absent (not in body at all) → leave existing link
    if (personId !== undefined) {
      const { person: linkedPerson, errorResponse } = await resolvePersonId(personId, userId)
      if (errorResponse) return errorResponse

      if (linkedPerson) {
        // Refresh embedded sub-document from the live People record
        record.personId = linkedPerson._id as mongoose.Types.ObjectId
        record.person = {
          name:             linkedPerson.name,
          phone:            linkedPerson.phone,
          email:            linkedPerson.email,
          linkedLifeFlowId: linkedPerson.linkedLifeFlowId,
        }
      }
    } else if (submittedPerson) {
      // No personId in this PATCH — update embedded fields directly if provided
      record.person = { ...record.person, ...submittedPerson }
    }

    // Apply remaining scalar fields
    const updateData: Record<string, unknown> = { ...rest }
    if (amount !== undefined) {
      updateData.originalAmountMinor = rupeesToPaise(amount)
    }
    // Remove person/personId from rest since we handled them above
    delete updateData.person
    delete updateData.personId

    Object.assign(record, updateData)

    // Recalculate status after potential amount/dueDate change
    const payments = await MoneyPayment.find({ moneyRecordId: id }).lean()
    const balance = calcBalance(
      record.originalAmountMinor,
      record.additionalAmounts ?? [],
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
