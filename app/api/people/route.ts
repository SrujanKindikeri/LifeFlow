import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Person from '@/models/Person'
import User from '@/models/User'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import GroupBill from '@/models/GroupBill'
import { calcBalance } from '@/lib/moneyCalculator'
import { z } from 'zod'
import type { IMoneyRecord } from '@/models/MoneyRecord'
import type { IMoneyPayment } from '@/models/MoneyPayment'

// ─── Validation schemas ───────────────────────────────────────────────────────

const manualPersonSchema = z.object({
  source:     z.literal('manual'),
  name:       z.string().min(1, 'Name is required').max(100),
  phone:      z.string().max(20).optional(),
  email:      z.string().email('Invalid email').max(200).optional().or(z.literal('')),
  notes:      z.string().max(500).optional(),
})

const lifeflowPersonSchema = z.object({
  source:           z.literal('lifeflow'),
  /** The contact's LifeFlow ID as entered by the user (e.g. LF-XXXXXXXX). */
  linkedLifeFlowId: z.string().regex(/^LF-[A-Z2-9]{8}$/, 'Invalid LifeFlow ID format'),
})

const personSchema = z.discriminatedUnion('source', [manualPersonSchema, lifeflowPersonSchema])

async function enrichPerson(
  person: InstanceType<typeof Person>,
  userId: string
) {
  const name = person.name.toLowerCase()

  // Money records where this person is mentioned (by name, case-insensitive)
  const moneyRecords = await MoneyRecord.find({
    userId,
    'person.name': { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
  }).lean()

  let moneyGivenMinor = 0
  let moneyGivenPaidMinor = 0
  let moneyBorrowedMinor = 0
  let moneyBorrowedPaidMinor = 0

  if (moneyRecords.length > 0) {
    const recordIds = moneyRecords.map((r) => r._id)
    const payments = await MoneyPayment.find({ moneyRecordId: { $in: recordIds } }).lean()
    const paymentMap = new Map<string, IMoneyPayment[]>()
    for (const p of payments) {
      const key = p.moneyRecordId.toString()
      if (!paymentMap.has(key)) paymentMap.set(key, [])
      paymentMap.get(key)!.push(p as unknown as IMoneyPayment)
    }

    for (const r of moneyRecords) {
      const rec = r as unknown as IMoneyRecord
      const pmts = paymentMap.get(r._id.toString()) ?? []
      const bal = calcBalance(rec.originalAmountMinor, rec.additionalAmounts ?? [], pmts.map((p) => p.amountMinor))
      if (rec.direction === 'given') {
        moneyGivenMinor += bal.totalMinor
        moneyGivenPaidMinor += bal.paidMinor
      } else {
        moneyBorrowedMinor += bal.totalMinor
        moneyBorrowedPaidMinor += bal.paidMinor
      }
    }
  }

  // Group bills where this person appears
  const groupBills = await GroupBill.find({
    userId,
    'people.name': { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
  }).lean()

  let groupBillShareMinor = 0
  for (const bill of groupBills) {
    const person = bill.people.find(
      (p) => p.name.toLowerCase() === name
    )
    if (!person) continue
    // Find their settlement amount
    for (const s of bill.settlements) {
      if (!s.settled) {
        // Amount they owe to "You" or "You" owes them
        const youId = bill.people.find((p) => p.name.toLowerCase() === 'you')?.id ?? bill.people[0]?.id
        if (s.fromPerson === person.id && s.toPerson === youId) {
          groupBillShareMinor += Math.round(s.amount * 100)
        }
        if (s.toPerson === person.id && s.fromPerson === youId) {
          groupBillShareMinor += Math.round(s.amount * 100)
        }
      }
    }
  }

  return {
    _id:               person._id.toString(),
    userId:            person.userId.toString(),
    name:              person.name,
    phone:             person.phone,
    email:             person.email,
    linkedLifeFlowId:  person.linkedLifeFlowId,
    source:            person.source ?? 'manual',
    notes:             person.notes,
    createdAt:         person.createdAt.toISOString(),
    updatedAt:         person.updatedAt.toISOString(),
    // Financial summary
    moneyGivenMinor,
    moneyGivenPaidMinor,
    moneyGivenRemainingMinor: Math.max(0, moneyGivenMinor - moneyGivenPaidMinor),
    moneyBorrowedMinor,
    moneyBorrowedPaidMinor,
    moneyBorrowedRemainingMinor: Math.max(0, moneyBorrowedMinor - moneyBorrowedPaidMinor),
    groupBillShareMinor,
    moneyRecordCount: moneyRecords.length,
    groupBillCount: groupBills.length,
  }
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = req.nextUrl
    const search = searchParams.get('q')
    const withFinancials = searchParams.get('financials') !== 'false'

    const query: Record<string, unknown> = { userId }
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      query.name = { $regex: new RegExp(escaped, 'i') }
    }

    const people = await Person.find(query).sort({ name: 1 }).lean()

    if (!withFinancials) {
      return NextResponse.json({
        people: people.map((p) => ({
          _id:              p._id.toString(),
          name:             p.name,
          phone:            p.phone,
          email:            p.email,
          linkedLifeFlowId: p.linkedLifeFlowId,
          source:           p.source ?? 'manual',
          notes:            p.notes,
        })),
      })
    }

    const enriched = await Promise.all(
      people.map((p) => enrichPerson(p as unknown as InstanceType<typeof Person>, userId))
    )

    return NextResponse.json({ people: enriched })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[people GET]', error)
    return NextResponse.json({ error: 'Failed to fetch people' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, lifeFlowId } = await requireAuth()
    const body = await req.json()

    const parsed = personSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    await connectDB()

    // ── LifeFlow ID path ────────────────────────────────────────────────────
    if (parsed.data.source === 'lifeflow') {
      const { linkedLifeFlowId } = parsed.data

      // Lookup the target user by their publicId — indexed, not a collection scan.
      // Select only the fields needed; never return passwords or secrets.
      const targetUser = await User.findOne({ publicId: linkedLifeFlowId })
        .select('_id publicId name email')
        .lean()

      if (!targetUser) {
        return NextResponse.json({ error: 'LifeFlow ID not found.' }, { status: 404 })
      }

      // Prevent adding yourself
      if (targetUser._id.toString() === userId) {
        return NextResponse.json({ error: 'You cannot add yourself to your People.' }, { status: 400 })
      }

      // Duplicate check: same LifeFlow user already in this owner's directory.
      // The unique sparse index on (userId, linkedUserId) also enforces this at
      // the DB layer, but we give a friendlier error message here.
      const existing = await Person.findOne({ userId, linkedUserId: targetUser._id }).lean()
      if (existing) {
        return NextResponse.json({ error: 'This person is already in your People.' }, { status: 409 })
      }

      const person = await Person.create({
        userId,
        lifeFlowId,           // owner's LF ID
        name:             targetUser.name,
        email:            targetUser.email,
        linkedLifeFlowId: targetUser.publicId,
        linkedUserId:     targetUser._id,
        source:           'lifeflow',
      })

      return NextResponse.json({
        person: {
          _id:              person._id.toString(),
          name:             person.name,
          email:            person.email,
          linkedLifeFlowId: person.linkedLifeFlowId,
          source:           person.source,
          createdAt:        person.createdAt.toISOString(),
        },
      }, { status: 201 })
    }

    // ── Manual path ─────────────────────────────────────────────────────────
    const person = await Person.create({
      userId,
      lifeFlowId, // owner's LF ID
      source: 'manual',
      name:  parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email,
      notes: parsed.data.notes,
    })

    return NextResponse.json({
      person: {
        _id:              person._id.toString(),
        name:             person.name,
        phone:            person.phone,
        email:            person.email,
        linkedLifeFlowId: person.linkedLifeFlowId,
        source:           person.source,
        notes:            person.notes,
        createdAt:        person.createdAt.toISOString(),
      },
    }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // MongoDB unique index violation (race condition fallback)
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === '11000'
    ) {
      return NextResponse.json({ error: 'This person is already in your People.' }, { status: 409 })
    }
    console.error('[people POST]', error)
    return NextResponse.json({ error: 'Failed to create person' }, { status: 500 })
  }
}
