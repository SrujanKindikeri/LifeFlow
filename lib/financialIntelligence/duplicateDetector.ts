/**
 * lib/financialIntelligence/duplicateDetector.ts
 *
 * Detects potentially duplicate expense entries.
 * Heuristic: same amount + same category within 3 days → medium confidence.
 * Same amount + same description within 7 days → high confidence.
 */

import type { DuplicateCandidate } from './types'

interface RawExpense {
  _id:                     string
  amount:                  number
  date:                    string   // YYYY-MM-DD
  description?:            string
  category?:               string
  source:                  string
  sourceSubscriptionId?:   string
  subscriptionBillingDate?: string
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00Z').getTime()
  const db = new Date(b + 'T00:00:00Z').getTime()
  return Math.abs(Math.round((da - db) / (1000 * 60 * 60 * 24)))
}

export function detectDuplicates(expenses: RawExpense[]): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = []
  const seen = new Set<string>() // pairs already reported

  for (let i = 0; i < expenses.length; i++) {
    const a = expenses[i]
    // Skip subscription-linked expenses — those are intentional recurrences
    if (a.sourceSubscriptionId) continue

    for (let j = i + 1; j < expenses.length; j++) {
      const b = expenses[j]
      if (b.sourceSubscriptionId) continue

      const pairKey = [a._id, b._id].sort().join(':')
      if (seen.has(pairKey)) continue

      const diff = daysBetween(a.date, b.date)
      const sameAmount = a.amount === b.amount

      // High confidence: same amount + non-empty description match within 7 days
      if (
        sameAmount &&
        diff <= 7 &&
        a.description &&
        b.description &&
        a.description.trim().toLowerCase() === b.description.trim().toLowerCase()
      ) {
        seen.add(pairKey)
        candidates.push({
          id:          a._id,
          amount:      a.amount,
          date:        a.date,
          description: a.description,
          category:    a.category,
          matchedId:   b._id,
          confidence:  'high',
        })
        continue
      }

      // Medium confidence: same amount + same category within 3 days
      if (sameAmount && diff <= 3 && a.category && b.category && a.category === b.category) {
        seen.add(pairKey)
        candidates.push({
          id:         a._id,
          amount:     a.amount,
          date:       a.date,
          category:   a.category,
          matchedId:  b._id,
          confidence: 'medium',
        })
      }
    }
  }

  return candidates
}
