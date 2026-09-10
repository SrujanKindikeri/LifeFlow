import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Person from '@/models/Person'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import GroupBill from '@/models/GroupBill'
import { calcBalance } from '@/lib/moneyCalculator'
import { z } from 'zod'
import type { IMoneyRecord } from '@/models/MoneyRecord'
import type { IMoneyPayment } from '@/models/MoneyPayment'

const personSchema = z.object({
  name:       z.string().min(1, 'Name is required').max(100),
  phone:      z.string().max(20).optional(),
  email:      z.string().email().max(200).optional().or(z.literal('')),
  lifeFlowId: z.string().max(20).optional(),
  notes:      z.string().max(500).optional(),
})

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
      const bal = calcBalance(rec.originalAmountMinor, pmts.map((p) => p.amountMinor))
      if (rec.direction === 'given') {
        moneyGivenMinor += rec.originalAmountMinor
        moneyGivenPaidMinor += bal.paidMinor
      } else {
        moneyBorrowedMinor += rec.originalAmountMinor
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
    lifeFlowId:        person.lifeFlowId,
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
          _id:   p._id.toString(),
          name:  p.name,
          phone: p.phone,
          email: p.email,
          lifeFlowId: p.lifeFlowId,
          notes: p.notes,
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
    const { userId } = await requireAuth()
    const body = await req.json()

    const parsed = personSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    await connectDB()

    const person = await Person.create({ userId, ...parsed.data })

    return NextResponse.json({
      person: {
        _id:       person._id.toString(),
        name:      person.name,
        phone:     person.phone,
        email:     person.email,
        lifeFlowId: person.lifeFlowId,
        notes:     person.notes,
        createdAt: person.createdAt.toISOString(),
      },
    }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[people POST]', error)
    return NextResponse.json({ error: 'Failed to create person' }, { status: 500 })
  }
}
