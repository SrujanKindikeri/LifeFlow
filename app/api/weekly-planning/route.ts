import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Task from '@/models/Task'
import Habit from '@/models/Habit'
import HabitLog from '@/models/HabitLog'
import Expense from '@/models/Expense'
import MoneyRecord from '@/models/MoneyRecord'
import SavingsContribution from '@/models/SavingsContribution'
import Goal from '@/models/Goal'
import Subscription from '@/models/Subscription'
import { paiseToRupees } from '@/lib/moneyCalculator'

function getWeekBounds(offset = 0) {
  const now = new Date()
  const day = now.getDay()
  const daysToMon = day === 0 ? 6 : day - 1
  const mon = new Date(now)
  mon.setDate(now.getDate() - daysToMon + offset * 7)
  mon.setHours(0, 0, 0, 0)
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return {
    start: mon.toISOString().split('T')[0],
    end:   sun.toISOString().split('T')[0],
    label: `${mon.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })} – ${sun.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}`,
  }
}

export async function GET() {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const currentWeek  = getWeekBounds(0)
    const previousWeek = getWeekBounds(-1)
    const today = new Date().toISOString().split('T')[0]

    const [
      // Previous week
      prevTasks,
      prevHabitLogs,
      prevExpenses,
      prevSavings,
      prevMoneyPayments,
      // Current week
      currTasks,
      currHabits,
      currHabitLogs,
      currMoneyDue,
      currGoals,
      currSubscriptions,
    ] = await Promise.all([
      Task.find({ userId, dueDate: { $gte: previousWeek.start, $lte: previousWeek.end } }).lean(),
      HabitLog.find({ userId, date: { $gte: previousWeek.start, $lte: previousWeek.end }, completed: true }).lean(),
      Expense.find({ userId, source: 'personal', date: { $gte: previousWeek.start, $lte: previousWeek.end } }).lean(),
      SavingsContribution.find({ userId, date: { $gte: previousWeek.start, $lte: previousWeek.end } }).lean(),
      // Money payments received/made last week
      import('@/models/MoneyPayment').then(m =>
        m.default.find({ userId, paymentDate: { $gte: previousWeek.start, $lte: previousWeek.end } }).lean()
      ),
      // Current week tasks
      Task.find({ userId, dueDate: { $gte: currentWeek.start, $lte: currentWeek.end }, completed: false }).sort({ priority: -1, dueDate: 1 }).lean(),
      Habit.find({ userId }).lean(),
      HabitLog.find({ userId, date: { $gte: currentWeek.start, $lte: today }, completed: true }).lean(),
      MoneyRecord.find({ userId, dueDate: { $gte: currentWeek.start, $lte: currentWeek.end }, status: { $in: ['pending','partially_paid','overdue'] } }).lean(),
      Goal.find({ userId, status: 'active', targetDate: { $gte: currentWeek.start, $lte: currentWeek.end } }).lean(),
      Subscription.find({ userId, status: 'active', nextBillingDate: { $gte: currentWeek.start, $lte: currentWeek.end } }).lean(),
    ])

    // Previous week summary
    const prevCompleted = prevTasks.filter((t) => t.completed).length
    const prevUnfinished = prevTasks.filter((t) => !t.completed).length

    const allHabits = currHabits.length
    const daysInPrevWeek = 7
    const expectedPrevLogs = allHabits * daysInPrevWeek
    const habitConsistency = expectedPrevLogs > 0
      ? Math.min(100, Math.round((prevHabitLogs.length / expectedPrevLogs) * 100))
      : 100

    const prevSpendMinor = Math.round(prevExpenses.reduce((s, e) => s + e.amount, 0) * 100)
    const prevSavedMinor = prevSavings.reduce((s, c) => s + c.amountMinor, 0)

    // Current week habits
    const completedHabitIds = new Set(currHabitLogs.map((l) => l.habitId.toString()))
    const habitsThisWeek = currHabits.map((h) => ({
      _id:            h._id.toString(),
      name:           h.name,
      icon:           h.icon,
      completedToday: completedHabitIds.has(h._id.toString()),
    }))

    return NextResponse.json({
      previousWeek: {
        label:            previousWeek.label,
        tasksCompleted:   prevCompleted,
        tasksUnfinished:  prevUnfinished,
        totalTasks:       prevTasks.length,
        habitConsistency,
        spendMinor:       prevSpendMinor,
        spend:            paiseToRupees(prevSpendMinor),
        savedMinor:       prevSavedMinor,
        saved:            paiseToRupees(prevSavedMinor),
        paymentsCount:    prevMoneyPayments.length,
      },
      currentWeek: {
        label:  currentWeek.label,
        start:  currentWeek.start,
        end:    currentWeek.end,
        tasks:  currTasks.map((t) => ({
          _id:      t._id.toString(),
          title:    t.title,
          priority: t.priority,
          dueDate:  t.dueDate,
        })),
        habits: habitsThisWeek,
        moneyDue: currMoneyDue.map((r) => ({
          _id:       r._id.toString(),
          person:    r.person.name,
          direction: r.direction,
          dueDate:   r.dueDate,
        })),
        goals: currGoals.map((g) => ({
          _id:        g._id.toString(),
          title:      g.title,
          targetDate: g.targetDate,
          currentValue: g.currentValue,
          targetValue:  g.targetValue,
        })),
        subscriptions: currSubscriptions.map((s) => ({
          _id:             s._id.toString(),
          serviceName:     s.serviceName,
          nextBillingDate: s.nextBillingDate,
          amountMinor:     s.amountMinor,
        })),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[weekly-planning GET]', error)
    return NextResponse.json({ error: 'Failed to fetch weekly planning data' }, { status: 500 })
  }
}


