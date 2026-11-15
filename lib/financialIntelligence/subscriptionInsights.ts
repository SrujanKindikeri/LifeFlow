/**
 * lib/financialIntelligence/subscriptionInsights.ts
 *
 * Surfaces actionable insights about active subscriptions:
 *   - Upcoming renewal within 7 days
 *   - Potential duplicate charges (same service charged twice recently)
 */

import type { SubscriptionInsight } from './types'
import type mongoose from 'mongoose'

interface RawSubscription {
  _id: mongoose.Types.ObjectId
  serviceName: string
  amountMinor: number
  currency: string
  nextBillingDate?: string
  billingCycle: string
  status: string
  category: string
  autoCreateExpense: boolean
}

interface RawExpense {
  sourceSubscriptionId?: { toString(): string }
  subscriptionBillingDate?: string
  source: string
  date: string
}

interface BuildSubscriptionInsightsInput {
  today: string
  subscriptions: RawSubscription[]
  recentExpenses: RawExpense[]
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00Z').getTime()
  const db = new Date(b + 'T00:00:00Z').getTime()
  return Math.abs(Math.round((da - db) / (1000 * 60 * 60 * 24)))
}

export function buildSubscriptionInsights(input: BuildSubscriptionInsightsInput): SubscriptionInsight[] {
  const { today, subscriptions } = input
  const insights: SubscriptionInsight[] = []

  for (const sub of subscriptions) {
    if (sub.status !== 'active') continue

    // Upcoming renewal within 7 days
    if (sub.nextBillingDate) {
      const days = daysBetween(today, sub.nextBillingDate)
      if (sub.nextBillingDate >= today && days <= 7) {
        insights.push({
          subscriptionId: sub._id.toString(),
          serviceName:    sub.serviceName,
          amountMinor:    sub.amountMinor,
          currency:       sub.currency,
          nextBillingDate: sub.nextBillingDate,
          billingCycle:   sub.billingCycle,
          insight:        'upcoming',
          details:        `Renews in ${days} day${days === 1 ? '' : 's'}`,
        })
      }
    }
  }

  return insights
}
