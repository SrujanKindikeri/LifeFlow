/**
 * lib/financialIntelligence/monthEndForecast.ts
 *
 * Projects spending to end-of-month using the current pace.
 */

import type { MonthEndForecast } from './types'

interface ForecastExpense {
  amount:   number
  date:     string
  source:   string
  category: string
}

interface BuildMonthEndForecastInput {
  today:                string   // YYYY-MM-DD in user's timezone
  currentMonth:         string   // YYYY-MM
  currentMonthExpenses: ForecastExpense[]
  prevMonthExpenses:    ForecastExpense[]
  budgetTotalMinor:     number
}

function getDaysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

export function buildMonthEndForecast(input: BuildMonthEndForecastInput): MonthEndForecast {
  const { today, currentMonth, currentMonthExpenses, prevMonthExpenses, budgetTotalMinor } = input

  const totalDays   = getDaysInMonth(currentMonth)
  const dayOfMonth  = parseInt(today.split('-')[2], 10)
  const daysElapsed = Math.max(1, dayOfMonth)
  const daysRemaining = Math.max(0, totalDays - daysElapsed)

  // Convert expenses to minor units (paise)
  const spentToDateMinor  = currentMonthExpenses.reduce((s, e) => s + Math.round(e.amount * 100), 0)
  const dailyAverageMinor = daysElapsed > 0 ? Math.round(spentToDateMinor / daysElapsed) : 0

  const projectedTotalMinor            = spentToDateMinor + dailyAverageMinor * daysRemaining
  const projectedRemainingBudgetMinor  = Math.max(0, budgetTotalMinor - projectedTotalMinor)

  const prevMonthTotalMinor = prevMonthExpenses.reduce((s, e) => s + Math.round(e.amount * 100), 0)
  const comparedToPrevMonthMinor = projectedTotalMinor - prevMonthTotalMinor

  const onTrack = budgetTotalMinor <= 0 || projectedTotalMinor <= budgetTotalMinor

  return {
    projectedTotalMinor,
    projectedRemainingBudgetMinor,
    dailyAverageMinor,
    daysRemaining,
    comparedToPrevMonthMinor,
    onTrack,
  }
}
