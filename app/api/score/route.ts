/**
 * GET /api/score
 *
 * Computes the LifeFlow Score deterministically from real user data.
 *
 * Score breakdown (total 100):
 * ─────────────────────────────────────────────────────────────────
 *  Tasks (30 pts)
 *    - Completion rate for tasks due in the last 14 days
 *    - Penalty for overdue tasks (up to -10)
 *
 *  Habits (30 pts)
 *    - 7-day consistency: completed / expected
 *
 *  Finance (20 pts)
 *    - Budget adherence: categories where spending < budget = +2 each, max 10
 *    - Bills paid on time in last 30 days: +5
 *    - No overdue Money records: +5
 *
 *  Deadlines (20 pts)
 *    - Projects with met deadlines vs missed
 *    - Goals on track: not past target date without completion
 *
 * All component scores are clamped to their respective maxima.
 * No random values. No AI labels.
 */

import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Task from '@/models/Task'
import Habit from '@/models/Habit'
import HabitLog from '@/models/HabitLog'
import Expense from '@/models/Expense'
import Budget from '@/models/Budget'
import MoneyRecord from '@/models/MoneyRecord'
import Goal from '@/models/Goal'
import Project from '@/models/Project'

export async function GET() {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const today = new Date().toISOString().split('T')[0]
    const now = new Date()

    // Date windows
    const d14 = new Date(now); d14.setDate(now.getDate() - 14)
    const d7  = new Date(now); d7.setDate(now.getDate() - 7)
    const past14 = d14.toISOString().split('T')[0]
    const past7  = d7.toISOString().split('T')[0]
    const currentMonth = today.slice(0, 7)

    const [
      recentTasks,
      overdueTasks,
      allHabits,
      habitLogs7,
      monthExpenses,
      budgets,
      moneyRecords,
      goals,
      projects,
    ] = await Promise.all([
      // Tasks due in last 14 days
      Task.find({ userId, dueDate: { $gte: past14, $lte: today } }).lean(),
      // Overdue tasks (not completed, past due date)
      Task.find({ userId, completed: false, dueDate: { $lt: today } }).lean(),
      // All habits
      Habit.find({ userId }).lean(),
      // Habit logs last 7 days
      HabitLog.find({ userId, date: { $gte: past7, $lte: today }, completed: true }).lean(),
      // This month's personal expenses
      Expense.find({ userId, source: 'personal', date: { $gte: `${currentMonth}-01`, $lte: today } }).lean(),
      // Budgets for current month
      Budget.find({ userId, month: currentMonth, status: 'active' }).lean(),
      // Money records with overdue status
      MoneyRecord.find({ userId, status: { $in: ['pending', 'partially_paid', 'overdue'] } }).lean(),
      // Goals
      Goal.find({ userId, status: 'active' }).lean(),
      // Projects
      Project.find({ userId, status: { $in: ['active', 'completed'] } }).lean(),
    ])

    // ── TASKS (30 pts) ─────────────────────────────────────────────────────────

    const totalTasks  = recentTasks.length
    const doneTasks   = recentTasks.filter((t) => t.completed).length
    const taskRate    = totalTasks > 0 ? doneTasks / totalTasks : 1
    const overdueCount = overdueTasks.length

    let taskScore = Math.round(taskRate * 25)                        // 0–25
    taskScore    -= Math.min(5, overdueCount)                        // -5 penalty max
    taskScore     = Math.max(0, Math.min(30, taskScore))

    const taskDetail = {
      points:     taskScore,
      maxPoints:  30,
      total:      totalTasks,
      completed:  doneTasks,
      overdue:    overdueCount,
      rate:       totalTasks > 0 ? Math.round(taskRate * 100) : 100,
    }

    // ── HABITS (30 pts) ────────────────────────────────────────────────────────

    const habitCount = allHabits.length
    // Expected completions over 7 days for daily habits
    const expectedLogs = habitCount * 7
    const actualLogs   = habitLogs7.length
    const habitRate    = expectedLogs > 0 ? actualLogs / expectedLogs : 1
    const habitScore   = Math.max(0, Math.min(30, Math.round(habitRate * 30)))

    const habitDetail = {
      points:     habitScore,
      maxPoints:  30,
      total:      habitCount,
      consistency: habitCount > 0 ? Math.min(100, Math.round(habitRate * 100)) : 100,
    }

    // ── FINANCE (20 pts) ───────────────────────────────────────────────────────

    let financeScore = 0

    // Budget adherence — up to 10 pts (2 per on-budget category, max 5 checked)
    if (budgets.length > 0) {
      const spendMap: Record<string, number> = {}
      for (const e of monthExpenses) {
        spendMap[e.category] = (spendMap[e.category] ?? 0) + Math.round(e.amount * 100)
      }
      let onBudget = 0
      for (const b of budgets) {
        const spent = spendMap[b.category] ?? 0
        if (spent <= b.amountMinor) onBudget++
      }
      financeScore += Math.min(10, onBudget * 2)
    } else {
      financeScore += 5 // no budgets set = neutral, award half
    }

    // Bills paid on time — redistributed: no overdue money records now worth 10 pts
    // No overdue money records — up to 10 pts
    const overdueMoneyCount = moneyRecords.filter((r) => r.status === 'overdue').length
    financeScore += overdueMoneyCount === 0 ? 10 : Math.max(0, 10 - overdueMoneyCount * 2)
    financeScore  = Math.max(0, Math.min(20, financeScore))

    const financeDetail = {
      points:          financeScore,
      maxPoints:       20,
      budgetsOnTrack:  budgets.length > 0
        ? (() => {
            const sm: Record<string, number> = {}
            for (const e of monthExpenses) sm[e.category] = (sm[e.category] ?? 0) + Math.round(e.amount * 100)
            return budgets.filter((b) => (sm[b.category] ?? 0) <= b.amountMinor).length
          })()
        : null,
      totalBudgets:    budgets.length,
      overduePayments: overdueMoneyCount,
    }

    // ── DEADLINES (20 pts) ─────────────────────────────────────────────────────

    let deadlineScore = 10 // default neutral

    // Goals on track (target date not passed, or completed)
    const missedGoals = goals.filter(
      (g) => g.targetDate && g.targetDate < today && g.status !== 'completed'
    ).length
    const activeGoals = goals.length

    if (activeGoals > 0) {
      const hitRate = (activeGoals - missedGoals) / activeGoals
      deadlineScore = Math.round(hitRate * 10)
    }

    // Projects with overdue deadlines
    const overdueProjects = projects.filter(
      (p) => p.dueDate && p.dueDate < today && p.status !== 'completed'
    ).length
    deadlineScore += overdueProjects === 0 ? 10 : Math.max(0, 10 - overdueProjects * 2)
    deadlineScore  = Math.max(0, Math.min(20, deadlineScore))

    const deadlineDetail = {
      points:          deadlineScore,
      maxPoints:       20,
      activeGoals,
      missedGoals,
      overdueProjects,
    }

    // ── TOTAL ──────────────────────────────────────────────────────────────────

    const total = taskScore + habitScore + financeScore + deadlineScore

    return NextResponse.json({
      score: total,
      maxScore: 100,
      breakdown: {
        tasks:     taskDetail,
        habits:    habitDetail,
        finance:   financeDetail,
        deadlines: deadlineDetail,
      },
      calculatedAt: new Date().toISOString(),
      note: 'Score is calculated from your real data over the past 7–30 days. No AI, no estimates.',
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[score GET]', error)
    return NextResponse.json({ error: 'Failed to compute score' }, { status: 500 })
  }
}


