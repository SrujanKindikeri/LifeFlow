/**
 * GET /api/briefing
 * Returns today's briefing data from real MongoDB.
 * All amounts are in minor units unless suffixed _display.
 */

import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Task from '@/models/Task'
import Habit from '@/models/Habit'
import HabitLog from '@/models/HabitLog'
import Expense from '@/models/Expense'
import MoneyRecord from '@/models/MoneyRecord'
import Subscription from '@/models/Subscription'
import Goal from '@/models/Goal'
import Project from '@/models/Project'
import { paiseToRupees } from '@/lib/moneyCalculator'

export async function GET() {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const today = new Date().toISOString().split('T')[0]
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split('T')[0]

    const next7 = new Date()
    next7.setDate(next7.getDate() + 7)
    const next7Str = next7.toISOString().split('T')[0]

    const [
      todayTasks,
      overdueTasks,
      highPriorityTasks,
      allHabits,
      todayHabitLogs,
      yesterdayExpenses,
      dueTodayMoney,
      overdueMoneyRecords,
      upcomingSubscriptions,
      upcomingGoalDeadlines,
      upcomingProjectDeadlines,
    ] = await Promise.all([
      Task.find({ userId, dueDate: today, completed: false }).sort({ priority: -1 }).lean(),
      Task.find({ userId, completed: false, dueDate: { $lt: today } }).sort({ dueDate: 1 }).limit(5).lean(),
      Task.find({ userId, priority: 'high', completed: false }).sort({ dueDate: 1 }).limit(5).lean(),
      Habit.find({ userId }).lean(),
      HabitLog.find({ userId, date: today }).lean(),
      Expense.find({ userId, source: 'personal', date: yesterdayStr }).lean(),
      MoneyRecord.find({ userId, dueDate: today, status: { $in: ['pending', 'partially_paid'] } }).lean(),
      MoneyRecord.find({ userId, status: 'overdue' }).sort({ dueDate: 1 }).limit(5).lean(),
      Subscription.find({ userId, status: 'active', nextBillingDate: { $lte: next7Str } }).sort({ nextBillingDate: 1 }).limit(5).lean(),
      Goal.find({ userId, status: 'active', targetDate: { $gte: today, $lte: next7Str } }).sort({ targetDate: 1 }).lean(),
      Project.find({ userId, status: 'active', dueDate: { $gte: today, $lte: next7Str } }).sort({ dueDate: 1 }).lean(),
    ])

    const completedHabitIds = new Set(todayHabitLogs.filter((l) => l.completed).map((l) => l.habitId.toString()))
    const todayHabits = allHabits.map((h) => ({
      _id:            h._id.toString(),
      name:           h.name,
      icon:           h.icon,
      completedToday: completedHabitIds.has(h._id.toString()),
    }))
    const habitsAtRisk = todayHabits.filter((h) => !h.completedToday)

    const yesterdaySpendMinor = Math.round(yesterdayExpenses.reduce((s, e) => s + e.amount, 0) * 100)

    // Focus: pick the single most important thing
    let focusItem: { type: string; _id: string; title: string; reason: string } | null = null
    if (overdueTasks.length > 0) {
      focusItem = { type: 'task', _id: overdueTasks[0]._id.toString(), title: overdueTasks[0].title, reason: 'overdue' }
    } else if (highPriorityTasks.length > 0 && highPriorityTasks[0].dueDate) {
      focusItem = { type: 'task', _id: highPriorityTasks[0]._id.toString(), title: highPriorityTasks[0].title, reason: 'high_priority' }
    } else if (todayTasks.length > 0) {
      focusItem = { type: 'task', _id: todayTasks[0]._id.toString(), title: todayTasks[0].title, reason: 'due_today' }
    }

    return NextResponse.json({
      today: today,
      todayTasks: todayTasks.map((t) => ({
        _id:      t._id.toString(),
        title:    t.title,
        priority: t.priority,
        dueTime:  t.dueTime,
      })),
      overdueTasks: overdueTasks.map((t) => ({
        _id:     t._id.toString(),
        title:   t.title,
        dueDate: t.dueDate,
      })),
      highPriorityTasks: highPriorityTasks.map((t) => ({
        _id:     t._id.toString(),
        title:   t.title,
        dueDate: t.dueDate,
      })),
      todayHabits,
      habitsAtRisk,
      yesterdaySpendMinor,
      yesterdaySpend: paiseToRupees(yesterdaySpendMinor),
      dueTodayMoney: dueTodayMoney.map((r) => ({
        _id:    r._id.toString(),
        person: r.person.name,
        direction: r.direction,
      })),
      overdueMoneyRecords: overdueMoneyRecords.map((r) => ({
        _id:    r._id.toString(),
        person: r.person.name,
        direction: r.direction,
      })),
      upcomingSubscriptions: upcomingSubscriptions.map((s) => ({
        _id:             s._id.toString(),
        serviceName:     s.serviceName,
        amountMinor:     s.amountMinor,
        nextBillingDate: s.nextBillingDate,
      })),
      upcomingGoalDeadlines: upcomingGoalDeadlines.map((g) => ({
        _id:        g._id.toString(),
        title:      g.title,
        targetDate: g.targetDate,
      })),
      upcomingProjectDeadlines: upcomingProjectDeadlines.map((p) => ({
        _id:     p._id.toString(),
        title:   p.title,
        dueDate: p.dueDate,
      })),
      focusItem,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[briefing GET]', error)
    return NextResponse.json({ error: 'Failed to fetch briefing' }, { status: 500 })
  }
}


