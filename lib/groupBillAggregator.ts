/**
 * lib/groupBillAggregator.ts — Person-level aggregation across Group Bills.
 *
 * PURPOSE
 * ───────
 * A person (e.g. "Rahul") can appear in many Group Bills created by the same
 * LifeFlow user.  This module aggregates their total outstanding balance across
 * ALL of that user's Group Bills so the UI can show a single unified summary:
 *
 *   Rahul  ·  4 bills  ·  ₹1,000 outstanding  (owes you)
 *
 * IDENTITY MATCHING
 * ─────────────────
 * Group Bill people are stored as {id, name, paidAmount} sub-documents.
 * There is no direct FK to the People (Person) collection.
 *
 * We match people across bills by NORMALISED NAME (lowercase + trimmed).
 * This correctly groups "Rahul", "rahul", and "RAHUL" as one person.
 *
 * If the same owner's People directory contains a Person with a matching
 * name, we attach that Person's _id and linkedLifeFlowId so the UI can
 * display the linked record and the scheduler can look up notification prefs.
 *
 * NET BALANCE
 * ───────────
 * settlements[i] = { fromPerson, toPerson, amount, settled }
 * fromPerson  → person who OWES money
 * toPerson    → person who IS OWED money
 *
 * For the bill owner (identified as the person named "You"):
 *   owesYou  += unsettled settlements where (from=person, to=you)
 *   youOwe   += unsettled settlements where (from=you,    to=person)
 *   net       = owesYou − youOwe
 *   positive net  → person owes the current user
 *   negative net  → current user owes the person
 *
 * SECURITY
 * ────────
 * All queries are scoped to the authenticated userId.
 * No cross-user data is ever returned.
 * The caller must validate userId from the session — never from client input.
 */

import type mongoose from 'mongoose'
import type { IGroupBill } from '@/models/GroupBill'
import type { IPerson }    from '@/models/Person'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PersonBillEntry {
  /** The bill's _id as a string. */
  billId:   string
  /** Human-readable bill name. */
  billName: string
  /** Bill date YYYY-MM-DD. */
  billDate: string
  /** Currency code, e.g. "INR". */
  currency: string
  /**
   * Raw amount this person owes the current user (from unsettled settlements
   * where fromPerson=them, toPerson=you), in native currency units (not paise).
   */
  owesYouAmount: number
  /**
   * Raw amount the current user owes this person (from unsettled settlements
   * where fromPerson=you, toPerson=them), in native currency units.
   */
  youOweAmount: number
  /** Amount already settled in this bill (fromPerson=them, toPerson=you, settled=true). */
  settledAmount: number
  /** Whether ALL settlements in this bill involving this person are settled. */
  fullySettled: boolean
}

export interface PersonSummary {
  /**
   * Stable key used to group the same person across multiple bills.
   * Format: normalised name (lowercase + trimmed).
   * Consumers should display person.displayName instead.
   */
  key: string
  /** Display name — the first-seen capitalisation from the bills. */
  displayName: string
  /** Number of Group Bills this person appears in. */
  billCount: number
  /** Total amount (unsettled) this person owes the current user across all bills. */
  totalOwesYou: number
  /** Total amount (unsettled) the current user owes this person across all bills. */
  totalYouOwe: number
  /**
   * Net balance:
   *   positive → person owes current user (net = totalOwesYou − totalYouOwe)
   *   negative → current user owes person
   *   zero     → fully settled
   */
  netBalance: number
  /** Total amount already settled across all bills (fromPerson=them → you). */
  totalSettled: number
  /** Direction label derived from netBalance. */
  direction: 'owes_you' | 'you_owe' | 'settled'
  /** All bill-level entries for drill-down. */
  bills: PersonBillEntry[]
  /** Most recent bill date across all their bills. */
  latestBillDate: string
  /**
   * Oldest bill date that still has an unsettled settlement involving this
   * person (null if everything is settled or they have no bills).
   */
  oldestUnpaidBillDate: string | null

  // ── People directory link ──────────────────────────────────────────────────
  /** MongoDB _id of the matching Person record (if found). */
  personId:          string | null
  /** linkedLifeFlowId of the Person record (other user's LF-XXXXXXXX, if any). */
  linkedLifeFlowId:  string | null
  /** Whether a People-directory record is linked. */
  isLinkedToPeople:  boolean
  /** Whether the linked People-directory record has an email address on file. */
  hasEmail:          boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normaliseName(name: string): string {
  return name.toLowerCase().trim()
}

/** Round to 2 decimal places, same convention as billCalculator. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ─── Main aggregation ─────────────────────────────────────────────────────────

/**
 * Aggregate person-level balances from a set of already-fetched Group Bills.
 *
 * @param bills  All Group Bills belonging to the authenticated user (lean docs).
 * @param people All Person records belonging to the same user (lean docs).
 *               Used purely for linking — never for security gating.
 * @returns      Array of PersonSummary, one per unique normalised name,
 *               sorted by |netBalance| descending (largest balance first).
 *               The "You" person is excluded from results.
 */
export function aggregateGroupBillPeople(
  bills:   (IGroupBill & { _id: mongoose.Types.ObjectId })[],
  people:  (IPerson   & { _id: mongoose.Types.ObjectId })[],
): PersonSummary[] {
  // Build name→Person lookup (normalised).
  // We only match against the owner's People directory (same userId guaranteed
  // by the caller who fetches both sets with the same userId filter).
  const personByName = new Map<string, IPerson & { _id: mongoose.Types.ObjectId }>()
  for (const p of people) {
    personByName.set(normaliseName(p.name), p)
  }

  // Accumulator: normalised name → running totals
  interface Acc {
    displayName:          string
    billCount:            number
    totalOwesYou:         number
    totalYouOwe:          number
    totalSettled:         number
    bills:                PersonBillEntry[]
    latestBillDate:       string
    oldestUnpaidBillDate: string | null
  }

  const acc = new Map<string, Acc>()

  for (const bill of bills) {
    const billId   = bill._id.toString()
    const billName = bill.name
    const billDate = bill.date
    const currency = bill.currency ?? 'INR'

    // Identify the "You" person in this bill.
    // Convention used by GroupBillSplitter: the owner names themselves "You".
    const youPerson = bill.people.find(
      (p) => normaliseName(p.name) === 'you',
    )

    // If there is no "You" person we cannot determine direction of settlements,
    // so we skip net-balance calculation for this bill but still record bill
    // membership for each person.
    const youId = youPerson?.id ?? null

    for (const billPerson of bill.people) {
      const normName = normaliseName(billPerson.name)

      // Exclude "You" from the summary — we only summarise OTHER people.
      if (normName === 'you') continue

      // Find settlements that involve this person ↔ you.
      let owesYouAmount  = 0
      let youOweAmount   = 0
      let settledAmount  = 0
      let hasUnsettled   = false

      if (youId) {
        for (const s of bill.settlements) {
          const involves =
            (s.fromPerson === billPerson.id && s.toPerson === youId) ||
            (s.fromPerson === youId          && s.toPerson === billPerson.id)

          if (!involves) continue

          if (!s.settled) {
            if (s.fromPerson === billPerson.id && s.toPerson === youId) {
              owesYouAmount += s.amount
              hasUnsettled = true
            } else if (s.fromPerson === youId && s.toPerson === billPerson.id) {
              youOweAmount += s.amount
              hasUnsettled = true
            }
          } else {
            // Count settled amounts (fromPerson=them → you only, to track what
            // they have already paid you).
            if (s.fromPerson === billPerson.id && s.toPerson === youId) {
              settledAmount += s.amount
            }
          }
        }
      }

      // Determine full-settlement status for this bill's involvement.
      const allInvolved = youId
        ? bill.settlements.filter(
            (s) =>
              (s.fromPerson === billPerson.id && s.toPerson === youId) ||
              (s.fromPerson === youId          && s.toPerson === billPerson.id),
          )
        : []
      const fullySettled =
        allInvolved.length > 0 && allInvolved.every((s) => s.settled)

      const entry: PersonBillEntry = {
        billId,
        billName,
        billDate,
        currency,
        owesYouAmount:  round2(owesYouAmount),
        youOweAmount:   round2(youOweAmount),
        settledAmount:  round2(settledAmount),
        fullySettled,
      }

      if (!acc.has(normName)) {
        acc.set(normName, {
          displayName:          billPerson.name,
          billCount:            0,
          totalOwesYou:         0,
          totalYouOwe:          0,
          totalSettled:         0,
          bills:                [],
          latestBillDate:       billDate,
          oldestUnpaidBillDate: null,
        })
      }

      const a = acc.get(normName)!
      a.billCount += 1
      a.totalOwesYou   += owesYouAmount
      a.totalYouOwe    += youOweAmount
      a.totalSettled   += settledAmount
      a.bills.push(entry)

      // Track dates.
      if (billDate > a.latestBillDate) a.latestBillDate = billDate
      if (hasUnsettled) {
        if (!a.oldestUnpaidBillDate || billDate < a.oldestUnpaidBillDate) {
          a.oldestUnpaidBillDate = billDate
        }
      }
    }
  }

  // Build final summaries.
  const summaries: PersonSummary[] = []

  for (const [key, a] of acc) {
    const totalOwesYou = round2(a.totalOwesYou)
    const totalYouOwe  = round2(a.totalYouOwe)
    const netBalance   = round2(totalOwesYou - totalYouOwe)

    let direction: PersonSummary['direction']
    if (Math.abs(netBalance) < 0.005) {
      direction = 'settled'
    } else if (netBalance > 0) {
      direction = 'owes_you'
    } else {
      direction = 'you_owe'
    }

    // Lookup People directory.
    const personRecord = personByName.get(key) ?? null
    const personId          = personRecord ? personRecord._id.toString() : null
    const linkedLifeFlowId  = personRecord?.linkedLifeFlowId ?? null
    const hasEmail          = Boolean(personRecord?.email && personRecord.email.includes('@'))

    summaries.push({
      key,
      displayName:          a.displayName,
      billCount:            a.billCount,
      totalOwesYou,
      totalYouOwe,
      netBalance,
      totalSettled:         round2(a.totalSettled),
      direction,
      bills:                a.bills,
      latestBillDate:       a.latestBillDate,
      oldestUnpaidBillDate: a.oldestUnpaidBillDate,
      personId,
      linkedLifeFlowId,
      isLinkedToPeople:     personRecord !== null,
      hasEmail,
    })
  }

  // Sort: largest absolute net balance first, then alphabetically.
  summaries.sort((a, b) => {
    const diff = Math.abs(b.netBalance) - Math.abs(a.netBalance)
    if (Math.abs(diff) > 0.001) return diff
    return a.displayName.localeCompare(b.displayName)
  })

  return summaries
}
