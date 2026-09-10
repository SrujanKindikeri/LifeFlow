/**
 * GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns all events from all sources for a given date range.
 * Each event includes: date, type, title, id, metadata.
 * Sources: Tasks, Habits (completion status), Bills, MoneyRecords (due),
 *          GroupBills, Subscriptions, Goals (target date), Projects (due date).
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Task from '@/models/Task'
import HabitLog from '@/models/HabitLog'
import Habit from '@/models/Habit'
import MoneyRecord from '@/models/MoneyRecord'
import GroupBill from '@/models/GroupBill'
import Subscription from '@/models/Subscription'
import Goal from '@/models/Goal'
import Project from '@/models/Project'

export interface CalendarEvent {
  date:     string
  type:     'task' | 'habit' | 'money' | 'group_bill' | 'subscription' | 'goal' | 'project'
  id:       string
  title:    string
  status?:  string
  metadata?: Record<string, unknown>
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = req.nextUrl
    const from = searchParams.get('from') ?? new Date().toISOString().slice(0, 7) + '-01'
    const to   = searchParams.get('to')   ?? (() => {
      const d = new Date(from)
      d.setMonth(d.getMonth() + 1)
      d.setDate(0)
      return d.toISOString().split('T')[0]
    })()

    const [
      tasks,
      habits,
      habitLogs,
      moneyRecords,
      groupBills,
      subscriptions,
      goals,
      projects,
    ] = await Promise.all([
      Task.find({ userId, dueDate: { $gte: from, $lte: to } }).lean(),
      Habit.find({ userId }).lean(),
      HabitLog.find({ userId, date: { $gte: from, $lte: to } }).lean(),
      MoneyRecord.find({ userId, dueDate: { $gte: from, $lte: to } }).lean(),
      GroupBill.find({ userId, date: { $gte: from, $lte: to } }).lean(),
      Subscription.find({ userId, status: 'active', nextBillingDate: { $gte: from, $lte: to } }).lean(),
      Goal.find({ userId, targetDate: { $gte: from, $lte: to } }).lean(),
      Project.find({ userId, dueDate: { $gte: from, $lte: to } }).lean(),
    ])

    const events: CalendarEvent[] = []

    // Tasks
    for (const t of tasks) {
      events.push({
        date:  t.dueDate!,
        type:  'task',
        id:    t._id.toString(),
        title: t.title,
        status: t.completed ? 'completed' : 'pending',
        metadata: { priority: t.priority },
      })
    }

    // Habit completions
    const habitMap = new Map(habits.map((h) => [h._id.toString(), h]))
    const logMap = new Map<string, Set<string>>()
    for (const l of habitLogs) {
      if (!logMap.has(l.date)) logMap.set(l.date, new Set())
      if (l.completed) logMap.get(l.date)!.add(l.habitId.toString())
    }
    for (const [date, completed] of logMap.entries()) {
      for (const habitId of completed) {
        const habit = habitMap.get(habitId)
        if (habit) {
          events.push({
            date,
            type:  'habit',
            id:    habitId,
            title: `${habit.icon} ${habit.name}`,
            status: 'completed',
          })
        }
      }
    }

    // Money due dates
    for (const r of moneyRecords) {
      if (r.dueDate) {
        events.push({
          date:  r.dueDate,
          type:  'money',
          id:    r._id.toString(),
          title: `${r.direction === 'given' ? r.person.name + ' owes you' : 'You owe ' + r.person.name}`,
          status: r.status,
        })
      }
    }

    // Group Bills (created date)
    for (const b of groupBills) {
      events.push({
        date:  b.date,
        type:  'group_bill',
        id:    b._id.toString(),
        title: b.name,
        metadata: { total: b.total, peopleCount: b.people.length },
      })
    }

    // Subscriptions
    for (const s of subscriptions) {
      events.push({
        date:  s.nextBillingDate,
        type:  'subscription',
        id:    s._id.toString(),
        title: `${s.serviceName} renewal`,
        metadata: { amountMinor: s.amountMinor, billingCycle: s.billingCycle },
      })
    }

    // Goal deadlines
    for (const g of goals) {
      if (g.targetDate) {
        events.push({
          date:  g.targetDate,
          type:  'goal',
          id:    g._id.toString(),
          title: `Goal: ${g.title}`,
          status: g.status,
        })
      }
    }

    // Project deadlines
    for (const p of projects) {
      if (p.dueDate) {
        events.push({
          date:  p.dueDate,
          type:  'project',
          id:    p._id.toString(),
          title: `Project: ${p.title}`,
          status: p.status,
        })
      }
    }

    // Group by date for efficient client rendering
    const byDate: Record<string, CalendarEvent[]> = {}
    for (const e of events) {
      if (!byDate[e.date]) byDate[e.date] = []
      byDate[e.date].push(e)
    }

    return NextResponse.json({ events, byDate, from, to })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[calendar GET]', error)
    return NextResponse.json({ error: 'Failed to fetch calendar data' }, { status: 500 })
  }
}
