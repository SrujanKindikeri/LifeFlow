/**
 * lib/financialIntelligence/budgetRisk.ts
 *
 * Evaluates how close each budget category is to its limit.
 */

import type { BudgetRisk } from './types'
import type mongoose from 'mongoose'

interface RawBudget {
  _id: mongoose.Types.ObjectId
  category: string
  amountMinor: number
  currency: string
  month: string
  status: string
}

interface RawExpense {
  amount:   number    // in rupees
  category: string
  source:   string
  date:     string
}

interface BuildBudgetRisksInput {
  today:        string
  currentMonth: string
  budgets:      RawBudget[]
  expenses:     RawExpense[]
}

export function buildBudgetRisks(input: BuildBudgetRisksInput): BudgetRisk[] {
  const { budgets, expenses } = input

  // Sum expenses per category (convert rupees to paise)
  const spentByCategory = new Map<string, number>()
  for (const e of expenses) {
    if (e.source !== 'personal') continue
    const prev = spentByCategory.get(e.category) ?? 0
    spentByCategory.set(e.category, prev + Math.round(e.amount * 100))
  }

  const risks: BudgetRisk[] = []

  for (const b of budgets) {
    if (b.status !== 'active' || b.amountMinor <= 0) continue

    const spentMinor  = spentByCategory.get(b.category) ?? 0
    const percentUsed = Math.round((spentMinor / b.amountMinor) * 100)

    let riskLevel: BudgetRisk['riskLevel']
    if (percentUsed >= 100)      riskLevel = 'exceeded'
    else if (percentUsed >= 80)  riskLevel = 'high'
    else if (percentUsed >= 60)  riskLevel = 'medium'
    else                          riskLevel = 'low'

    risks.push({
      category:    b.category,
      budgetMinor: b.amountMinor,
      spentMinor,
      percentUsed,
      riskLevel,
    })
  }

  // Sort by percentUsed descending (most at-risk first)
  return risks.sort((a, b) => b.percentUsed - a.percentUsed)
}
