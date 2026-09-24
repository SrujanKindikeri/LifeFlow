/**
 * GET /api/group-bills/people-summary
 *
 * Returns a per-person aggregated balance summary across ALL of the
 * authenticated user's Group Bills.
 *
 * WHAT IT DOES
 * ────────────
 * • Fetches all Group Bills owned by the authenticated user in one query.
 * • Fetches all Person records owned by the same user (for People-directory linking).
 * • Aggregates settlements per person (normalised by lowercase name) to produce:
 *     - totalOwesYou    how much this person still owes the current user (unsettled)
 *     - totalYouOwe     how much the current user still owes this person (unsettled)
 *     - netBalance      totalOwesYou − totalYouOwe
 *     - direction       'owes_you' | 'you_owe' | 'settled'
 *     - bills[]         per-bill drill-down entries
 *     - isLinkedToPeople whether a People-directory record was found
 *     - personId        People-directory _id (if linked)
 *     - linkedLifeFlowId the contact's LifeFlow ID (if their account is linked)
 * • Returns an overview with total outstanding and total you-owe.
 *
 * SECURITY
 * ────────
 * • Authentication is required — unauthenticated calls receive 401.
 * • userId is ALWAYS derived from the server-side session (requireAuth).
 *   No userId, personId, or groupBillId from the client is ever trusted for
 *   access-control decisions.
 * • Only data belonging to the authenticated user is returned.
 * • No other user's bill or person data is ever exposed.
 *
 * PERFORMANCE
 * ───────────
 * • Two database queries: GroupBill.find({userId}) + Person.find({userId}).
 * • All aggregation happens in-process (no N+1 queries).
 * • Both models have an index on userId so queries are fast even for large datasets.
 *
 * RESPONSE SHAPE
 * ──────────────
 * {
 *   people: PersonSummary[]
 *   overview: {
 *     totalPeopleWithBalance: number   // people where |netBalance| > 0
 *     totalOutstandingOwedToYou: number  // sum of owes_you net balances
 *     totalOutstandingYouOwe:    number  // sum of you_owe net balances
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB }    from '@/lib/db'
import { requireAuth }  from '@/lib/session'
import GroupBill        from '@/models/GroupBill'
import Person           from '@/models/Person'
import { aggregateGroupBillPeople } from '@/lib/groupBillAggregator'
import type { IGroupBill } from '@/models/GroupBill'
import type { IPerson }   from '@/models/Person'
import type mongoose from 'mongoose'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    // ── Single query for all the user's bills ────────────────────────────────
    // The userId index on GroupBill makes this fast even at scale.
    const bills = await GroupBill.find({ userId })
      .select('name date currency people settlements')
      .lean()

    // ── Single query for the user's People directory ──────────────────────────
    const people = await Person.find({ userId })
      .select('name email linkedLifeFlowId linkedUserId source')
      .lean()

    // ── Aggregate in-memory (no N+1) ──────────────────────────────────────────
    const summaries = aggregateGroupBillPeople(
      bills as unknown as (IGroupBill & { _id: mongoose.Types.ObjectId })[],
      people as unknown as (IPerson   & { _id: mongoose.Types.ObjectId })[],
    )

    // ── Build overview ────────────────────────────────────────────────────────
    let totalOutstandingOwedToYou = 0
    let totalOutstandingYouOwe    = 0
    let totalPeopleWithBalance    = 0

    for (const s of summaries) {
      if (s.direction === 'owes_you') {
        totalOutstandingOwedToYou += s.netBalance
        totalPeopleWithBalance++
      } else if (s.direction === 'you_owe') {
        totalOutstandingYouOwe += Math.abs(s.netBalance)
        totalPeopleWithBalance++
      }
    }

    return NextResponse.json({
      people: summaries,
      overview: {
        totalPeopleWithBalance,
        totalOutstandingOwedToYou: Math.round(totalOutstandingOwedToYou * 100) / 100,
        totalOutstandingYouOwe:    Math.round(totalOutstandingYouOwe    * 100) / 100,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[group-bills/people-summary GET]', error)
    return NextResponse.json(
      { error: 'Failed to fetch people summary' },
      { status: 500 },
    )
  }
}
