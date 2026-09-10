/**
 * billCalculator.ts
 *
 * Decimal-safe money calculation engine for Group Bill Splitter.
 *
 * ALL internal arithmetic is done in integer paise (×100) to eliminate
 * floating-point drift.  Results are only converted back to rupees
 * at the very end, after rounding corrections are applied.
 *
 * Core guarantee:
 *   sum(personShare[i]) === grandTotal   (exactly, to the paise)
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CalcPerson {
  id: string
  name: string
  paidAmount: number // actual cash paid (rupees)
}

export interface CalcItem {
  id: string
  name: string
  price: number    // rupees
  quantity: number
  assignedPeople: string[] // person ids; empty = unassigned (treated as shared by all)
}

export type SplitMode = 'item' | 'equal' | 'custom'

export interface CustomSplit {
  personId: string
  value: number
  type: 'amount' | 'percent'
}

export interface ChargeConfig {
  discountType: 'amount' | 'percent'
  discountValue: number
  taxType: 'amount' | 'percent'
  taxValue: number
  serviceChargeType: 'amount' | 'percent'
  serviceChargeValue: number
  tipType: 'amount' | 'percent'
  tipValue: number
}

// ─── Per-person result ──────────────────────────────────────────────────────

export interface PersonShare {
  personId: string
  personName: string
  itemSubtotal: number    // their share of item costs (rupees)
  discountCredit: number  // discount allocated to them
  taxShare: number
  serviceChargeShare: number
  tipShare: number
  total: number           // final amount they owe
  items: PersonItemLine[] // breakdown lines
}

export interface PersonItemLine {
  itemId: string
  itemName: string
  itemTotal: number       // full price × qty for this item
  sharedWith: number      // how many people share it (1 = sole owner)
  share: number           // this person's portion (rupees)
}

// ─── Bill totals ────────────────────────────────────────────────────────────

export interface BillTotals {
  subtotal: number
  discountAmount: number
  afterDiscount: number
  taxAmount: number
  serviceChargeAmount: number
  tipAmount: number
  grandTotal: number
}

// ─── Settlement ─────────────────────────────────────────────────────────────

export interface Settlement {
  fromPerson: string
  toPerson: string
  amount: number
}

// ─── Full result ────────────────────────────────────────────────────────────

export interface BillCalculationResult {
  totals: BillTotals
  personShares: PersonShare[]
  settlements: Settlement[]
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Convert rupees → paise (integer). */
function toPaise(rupees: number): number {
  return Math.round(rupees * 100)
}

/** Convert paise → rupees (2 decimal places). */
function toRupees(paise: number): number {
  return Math.round(paise) / 100
}

/**
 * Distribute `totalPaise` among `count` slots as evenly as possible.
 * The remainder (r = totalPaise mod count) is added 1 paise to the first
 * r slots.  This guarantees sum === totalPaise exactly.
 */
function distributeEvenly(totalPaise: number, count: number): number[] {
  if (count <= 0) return []
  const base = Math.floor(totalPaise / count)
  const remainder = totalPaise - base * count
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0))
}

/**
 * Distribute `totalPaise` proportionally to `weights` (integers).
 * Uses the largest-remainder method so sum === totalPaise exactly.
 */
function distributeProportionally(totalPaise: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  if (totalWeight === 0) return distributeEvenly(totalPaise, weights.length)

  // Exact real shares
  const exact = weights.map((w) => (totalPaise * w) / totalWeight)

  // Floor each, track remainders
  const floors = exact.map(Math.floor)
  const remainders = exact.map((v, i) => v - floors[i])
  const allocated = floors.reduce((a, b) => a + b, 0)
  const deficit = totalPaise - allocated // integer ≥ 0

  // Sort indices by remainder descending, distribute leftover paise
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r - a.r)
    .map((x) => x.i)

  const result = [...floors]
  for (let k = 0; k < deficit; k++) {
    result[order[k]] += 1
  }
  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// Main calculation
// ═══════════════════════════════════════════════════════════════════════════

export function calculateBill(
  people: CalcPerson[],
  items: CalcItem[],
  charges: ChargeConfig,
  splitMode: SplitMode,
  customSplits: CustomSplit[]
): BillCalculationResult {
  if (people.length === 0) {
    return {
      totals: {
        subtotal: 0,
        discountAmount: 0,
        afterDiscount: 0,
        taxAmount: 0,
        serviceChargeAmount: 0,
        tipAmount: 0,
        grandTotal: 0,
      },
      personShares: [],
      settlements: [],
    }
  }

  const personIds = people.map((p) => p.id)

  // ── 1. Subtotal ────────────────────────────────────────────────────────
  const subtotalPaise = items.reduce(
    (sum, item) => sum + toPaise(item.price) * item.quantity,
    0
  )

  // ── 2. Discount ───────────────────────────────────────────────────────
  const discountPaise =
    charges.discountValue <= 0
      ? 0
      : charges.discountType === 'percent'
      ? Math.round((subtotalPaise * charges.discountValue) / 100)
      : toPaise(charges.discountValue)

  const afterDiscountPaise = Math.max(0, subtotalPaise - discountPaise)

  // ── 3. Tax ────────────────────────────────────────────────────────────
  const taxPaise =
    charges.taxValue <= 0
      ? 0
      : charges.taxType === 'percent'
      ? Math.round((afterDiscountPaise * charges.taxValue) / 100)
      : toPaise(charges.taxValue)

  // ── 4. Service charge ─────────────────────────────────────────────────
  const serviceChargePaise =
    charges.serviceChargeValue <= 0
      ? 0
      : charges.serviceChargeType === 'percent'
      ? Math.round((afterDiscountPaise * charges.serviceChargeValue) / 100)
      : toPaise(charges.serviceChargeValue)

  // ── 5. Tip ────────────────────────────────────────────────────────────
  const tipPaise =
    charges.tipValue <= 0
      ? 0
      : charges.tipType === 'percent'
      ? Math.round((afterDiscountPaise * charges.tipValue) / 100)
      : toPaise(charges.tipValue)

  // ── 6. Grand total ────────────────────────────────────────────────────
  const grandTotalPaise =
    afterDiscountPaise + taxPaise + serviceChargePaise + tipPaise

  const totals: BillTotals = {
    subtotal: toRupees(subtotalPaise),
    discountAmount: toRupees(discountPaise),
    afterDiscount: toRupees(afterDiscountPaise),
    taxAmount: toRupees(taxPaise),
    serviceChargeAmount: toRupees(serviceChargePaise),
    tipAmount: toRupees(tipPaise),
    grandTotal: toRupees(grandTotalPaise),
  }

  // ── 7. Per-person item subtotals ──────────────────────────────────────
  //
  // personItemPaise[personId] = their raw item subtotal in paise
  // personItemLines[personId] = breakdown array

  const personItemPaise: Record<string, number> = {}
  const personItemLines: Record<string, PersonItemLine[]> = {}

  for (const person of people) {
    personItemPaise[person.id] = 0
    personItemLines[person.id] = []
  }

  for (const item of items) {
    const itemTotalPaise = toPaise(item.price) * item.quantity

    // Determine who this item is assigned to.
    // If assignedPeople is empty or has people not in our list, treat as shared by all.
    const assigned = item.assignedPeople.filter((id) => personIds.includes(id))
    const owners = assigned.length > 0 ? assigned : personIds

    const shares = distributeEvenly(itemTotalPaise, owners.length)

    owners.forEach((ownerId, idx) => {
      personItemPaise[ownerId] += shares[idx]
      personItemLines[ownerId].push({
        itemId: item.id,
        itemName: item.name,
        itemTotal: toRupees(itemTotalPaise),
        sharedWith: owners.length,
        share: toRupees(shares[idx]),
      })
    })
  }

  // ── 8. Base share before surcharges ──────────────────────────────────
  //
  // Depending on splitMode, compute each person's base pre-surcharge amount
  // (in paise).  Surcharges are then allocated proportionally to this base.

  let baseSharePaise: Record<string, number> = {}

  if (splitMode === 'item') {
    baseSharePaise = { ...personItemPaise }

    // Handle items unassigned in item mode: they're already distributed above
    // by falling back to "all people".  Nothing extra needed.

  } else if (splitMode === 'equal') {
    const equalShares = distributeEvenly(afterDiscountPaise, people.length)
    people.forEach((p, i) => {
      baseSharePaise[p.id] = equalShares[i]
    })

  } else {
    // custom split
    // Validate: if percents given, they must sum to 100; amounts must sum to afterDiscount.
    // We trust the UI to validate; here we just normalize.

    const splitsMap = new Map(customSplits.map((s) => [s.personId, s]))

    if (customSplits.length === 0 || customSplits.some((s) => !personIds.includes(s.personId))) {
      // Fallback: equal
      const equalShares = distributeEvenly(afterDiscountPaise, people.length)
      people.forEach((p, i) => {
        baseSharePaise[p.id] = equalShares[i]
      })
    } else {
      const firstType = customSplits[0].type

      if (firstType === 'percent') {
        // Distribute afterDiscount by percent weights
        const weights = people.map((p) => {
          const s = splitsMap.get(p.id)
          return s ? Math.round(s.value * 100) : 0 // ×100 to keep integer
        })
        const distributed = distributeProportionally(afterDiscountPaise, weights)
        people.forEach((p, i) => {
          baseSharePaise[p.id] = distributed[i]
        })
      } else {
        // Fixed amounts — convert to paise and apply largest-remainder for total
        const rawPaise = people.map((p) => {
          const s = splitsMap.get(p.id)
          return s ? toPaise(s.value) : 0
        })
        const specifiedSum = rawPaise.reduce((a, b) => a + b, 0)
        if (specifiedSum === 0) {
          // Fallback equal
          const eq = distributeEvenly(afterDiscountPaise, people.length)
          people.forEach((p, i) => { baseSharePaise[p.id] = eq[i] })
        } else {
          // Scale proportionally to afterDiscountPaise
          const distributed = distributeProportionally(afterDiscountPaise, rawPaise)
          people.forEach((p, i) => {
            baseSharePaise[p.id] = distributed[i]
          })
        }
      }
    }
  }

  // ── 9. Discount credit (item & custom modes: proportional to item subtotal)
  //       Equal mode: discount is already baked into baseSharePaise
  const discountCreditPaise: Record<string, number> = {}
  if (splitMode === 'equal') {
    // The discount is factored into the equal base, no separate credit line
    for (const p of people) discountCreditPaise[p.id] = 0
  } else {
    // Distribute discount proportional to raw item subtotals
    const weights = people.map((p) => personItemPaise[p.id])
    const discountShares = distributeProportionally(discountPaise, weights)
    people.forEach((p, i) => { discountCreditPaise[p.id] = discountShares[i] })
  }

  // ── 10. Surcharge allocation (proportional to baseSharePaise) ─────────

  const baseWeights = people.map((p) => baseSharePaise[p.id])
  const totalBaseWeight = baseWeights.reduce((a, b) => a + b, 0)

  // Helper: distribute a surcharge proportionally (or evenly if base is zero)
  function allocateSurcharge(surchargePaise: number): Record<string, number> {
    const alloc: Record<string, number> = {}
    if (surchargePaise === 0) {
      for (const p of people) alloc[p.id] = 0
      return alloc
    }
    const shares =
      totalBaseWeight > 0
        ? distributeProportionally(surchargePaise, baseWeights)
        : distributeEvenly(surchargePaise, people.length)
    people.forEach((p, i) => { alloc[p.id] = shares[i] })
    return alloc
  }

  const taxAlloc = allocateSurcharge(taxPaise)
  const serviceAlloc = allocateSurcharge(serviceChargePaise)
  const tipAlloc = allocateSurcharge(tipPaise)

  // ── 11. Assemble PersonShare objects ──────────────────────────────────

  const personShares: PersonShare[] = people.map((p) => {
    const itemSubtotalPaise = personItemPaise[p.id]
    const dCredit = discountCreditPaise[p.id]
    const tax = taxAlloc[p.id]
    const service = serviceAlloc[p.id]
    const tip = tipAlloc[p.id]

    let totalPaise: number
    if (splitMode === 'equal') {
      // base already is their share of afterDiscount; add surcharges
      totalPaise = baseSharePaise[p.id] + tax + service + tip
    } else {
      // item / custom: start from raw item total, subtract discount credit, add surcharges
      totalPaise = itemSubtotalPaise - dCredit + tax + service + tip
    }

    return {
      personId: p.id,
      personName: p.name,
      itemSubtotal: toRupees(itemSubtotalPaise),
      discountCredit: toRupees(dCredit),
      taxShare: toRupees(tax),
      serviceChargeShare: toRupees(service),
      tipShare: toRupees(tip),
      total: toRupees(totalPaise),
      items: personItemLines[p.id] ?? [],
    }
  })

  // ── 12. Rounding correction ───────────────────────────────────────────
  //
  // Due to integer division, the sum of person totals may be off by ±1 paise.
  // Fix: adjust the person with the largest share by the discrepancy.

  const sumTotalsPaise = personShares.reduce((s, ps) => s + toPaise(ps.total), 0)
  const diff = grandTotalPaise - sumTotalsPaise // typically 0 or ±1

  if (diff !== 0) {
    // Add diff to the person with the largest share (least noticeable rounding)
    const maxIdx = personShares.reduce(
      (best, ps, i) => (ps.total > personShares[best].total ? i : best),
      0
    )
    personShares[maxIdx].total = toRupees(toPaise(personShares[maxIdx].total) + diff)
  }

  // ── 13. Settlement calculation ────────────────────────────────────────

  const settlements = calculateSettlements(people, personShares)

  return { totals, personShares, settlements }
}

// ═══════════════════════════════════════════════════════════════════════════
// Settlement: minimise number of transfers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Given what each person actually paid vs what they owe, compute
 * the minimal set of transfers using a greedy creditor/debtor matching.
 *
 * Algorithm:
 *  1. Compute net[i] = paidAmount[i] - share[i]
 *     positive net  → creditor (is owed money)
 *     negative net  → debtor  (owes money)
 *  2. Greedily match largest debtor with largest creditor.
 */
export function calculateSettlements(
  people: CalcPerson[],
  personShares: PersonShare[]
): Settlement[] {
  // net in paise (positive = creditor, negative = debtor)
  const net: { id: string; name: string; amount: number }[] = people.map((p) => {
    const share = personShares.find((ps) => ps.personId === p.id)
    const owed = share ? toPaise(share.total) : 0
    const paid = toPaise(p.paidAmount)
    return { id: p.id, name: p.name, amount: paid - owed }
  })

  const creditors = net.filter((n) => n.amount > 0).map((n) => ({ ...n }))
  const debtors = net.filter((n) => n.amount < 0).map((n) => ({ ...n, amount: -n.amount }))

  // Sort descending by absolute amount
  creditors.sort((a, b) => b.amount - a.amount)
  debtors.sort((a, b) => b.amount - a.amount)

  const result: Settlement[] = []

  let ci = 0
  let di = 0

  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci]
    const d = debtors[di]

    const transfer = Math.min(c.amount, d.amount)

    if (transfer > 0) {
      result.push({
        fromPerson: d.id,
        toPerson: c.id,
        amount: toRupees(transfer),
      })
    }

    c.amount -= transfer
    d.amount -= transfer

    if (c.amount <= 1) ci++ // ≤1 paise tolerance for rounding
    if (d.amount <= 1) di++
  }

  return result
}

// ═══════════════════════════════════════════════════════════════════════════
// Convenience: recalculate and return only totals (for live preview)
// ═══════════════════════════════════════════════════════════════════════════

export function calculateTotalsOnly(
  items: CalcItem[],
  charges: ChargeConfig
): BillTotals {
  const subtotalPaise = items.reduce(
    (sum, item) => sum + toPaise(item.price) * item.quantity,
    0
  )

  const discountPaise =
    charges.discountValue <= 0
      ? 0
      : charges.discountType === 'percent'
      ? Math.round((subtotalPaise * charges.discountValue) / 100)
      : toPaise(charges.discountValue)

  const afterDiscountPaise = Math.max(0, subtotalPaise - discountPaise)

  const taxPaise =
    charges.taxValue <= 0
      ? 0
      : charges.taxType === 'percent'
      ? Math.round((afterDiscountPaise * charges.taxValue) / 100)
      : toPaise(charges.taxValue)

  const serviceChargePaise =
    charges.serviceChargeValue <= 0
      ? 0
      : charges.serviceChargeType === 'percent'
      ? Math.round((afterDiscountPaise * charges.serviceChargeValue) / 100)
      : toPaise(charges.serviceChargeValue)

  const tipPaise =
    charges.tipValue <= 0
      ? 0
      : charges.tipType === 'percent'
      ? Math.round((afterDiscountPaise * charges.tipValue) / 100)
      : toPaise(charges.tipValue)

  const grandTotalPaise =
    afterDiscountPaise + taxPaise + serviceChargePaise + tipPaise

  return {
    subtotal: toRupees(subtotalPaise),
    discountAmount: toRupees(discountPaise),
    afterDiscount: toRupees(afterDiscountPaise),
    taxAmount: toRupees(taxPaise),
    serviceChargeAmount: toRupees(serviceChargePaise),
    tipAmount: toRupees(tipPaise),
    grandTotal: toRupees(grandTotalPaise),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Default charge config
// ═══════════════════════════════════════════════════════════════════════════

export const DEFAULT_CHARGE_CONFIG: ChargeConfig = {
  discountType: 'amount',
  discountValue: 0,
  taxType: 'percent',
  taxValue: 0,
  serviceChargeType: 'percent',
  serviceChargeValue: 0,
  tipType: 'amount',
  tipValue: 0,
}
