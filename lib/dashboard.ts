/**
 * Server-side dashboard data aggregation.
 * Fetches all dashboard data in parallel with minimal DB round-trips.
 */

import { connectDB } from '@/lib/db'
import { EXPENSE_CATEGORIES } from '@/lib/utils'
import Task from '@/models/Task'
import Habit from '@/models/Habit'
import HabitLog from '@/models/HabitLog'
import Expense from '@/models/Expense'
import Note from '@/models/Note'
import GroupBill from '@/models/GroupBill'
import Notification from '@/models/Notification'
import RecentActivity from '@/models/RecentActivity'
import DashboardPreference, { DEFAULT_SECTIONS, type IDashboardSection } from '@/models/DashboardPreference'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import { calcBalance } from '@/lib/moneyCalculator'
import type { IMoneyRecord } from '@/models/MoneyRecord'
import type { IMoneyPayment } from '@/models/MoneyPayment'

// ─── Serialized output types ──────────────────────────────────────────────────

export interface DashboardTask {
  _id: string
  title: string
  completed: boolean
  priority: 'low' | 'medium' | 'high'
  dueDate?: string
  dueTime?: string
}

export interface DashboardHabit {
  _id: string
  name: string
  icon: string
  completedToday: boolean
  streak: number
}

export interface DashboardExpenseStat {
  today: number
  week: number
  month: number
  topCategory: { name: string; emoji: string; amount: number } | null
  weeklyChart: number[] // Mon–Sun spending amounts
}

export interface DashboardNote {
  _id: string
  title: string
  content: string
  updatedAt: string
}

export interface DashboardUpcomingTask {
  _id: string
  title: string
  priority: 'low' | 'medium' | 'high'
  dueDate: string
  dueTime?: string
}

export interface DashboardGroupBill {
  _id: string
  name: string
  date: string
  total: number
  peopleCount: number
  myShare: number
  currency: string
}

export interface DashboardInsight {
  text: string
  icon: string
}

// ── New feature types ─────────────────────────────────────────────────────────

export interface FocusItem {
  _id: string
  type: 'task' | 'habit'
  title: string
  icon?: string
  completed: boolean
  priority?: 'low' | 'medium' | 'high'
  reason: 'overdue' | 'high_priority_today' | 'due_today' | 'incomplete_habit' | 'streak_risk'
}

export interface StreakRiskHabit {
  _id: string
  name: string
  icon: string
  streak: number
  completedToday: boolean
}

export interface SpendingWarning {
  type: 'category_increase' | 'daily_average' | 'unusual_day'
  message: string
  detail?: string
  severity: 'warning' | 'info'
  linkToAnalytics: boolean
}

export interface TimelineItem {
  _id: string
  title: string
  dueTime: string
  completed: boolean
  status: 'completed' | 'overdue' | 'upcoming'
}

export interface WeeklyReviewData {
  weekLabel: string
  tasks: { completed: number; total: number }
  habits: { consistency: number; total: number }
  spending: number
  notesCreated: number
  groupBillsCount: number
  bestStreak: number
  highlights: { text: string; type: 'positive' | 'negative' }[]
}

export interface GroupBillReminder {
  _id: string        // GroupBill _id
  name: string
  currency: string
  // Settlement amounts for this user specifically
  owedToMe: number        // others owe me
  iOwe: number            // I owe others
  // Individual line items
  reminders: {
    fromPerson: string
    toPerson: string
    amount: number
    direction: 'owed_to_me' | 'i_owe'
    // person names
    fromName: string
    toName: string
  }[]
}

export interface ContinueItem {
  _id: string
  type: 'note' | 'task' | 'habit' | 'expense' | 'groupBill'
  title: string
  action: string
  timestamp: string
  href: string
}

export interface DashboardSectionPref {
  id: string
  visible: boolean
  order: number
}

export interface MoneyTrackerSummary {
  toCollectMinor: number
  toPayMinor: number
  netMinor: number
  topDebtors: { name: string; owesYouMinor: number }[]
  topCreditors: { name: string; youOweMinor: number }[]
}

export interface DashboardData {
  user: { name: string; email: string }
  today: {
    tasks: DashboardTask[]
    completedCount: number
    habits: DashboardHabit[]
    completedHabits: number
    progress: number
    streak: number
  }
  spending: DashboardExpenseStat
  recentNotes: DashboardNote[]
  upcomingTasks: DashboardUpcomingTask[]
  recentGroupBills: DashboardGroupBill[]
  unreadNotifications: number
  insights: DashboardInsight[]
  // ── New features ──────────────────────────────────────────────────────────
  focus: FocusItem[]
  streakRisks: StreakRiskHabit[]
  spendingWarnings: SpendingWarning[]
  timeline: TimelineItem[]
  weeklyReview: WeeklyReviewData
  groupBillReminders: GroupBillReminder[]
  continueItems: ContinueItem[]
  sectionPrefs: DashboardSectionPref[]
  moneySummary: MoneyTrackerSummary
}

// ─── Helper: streak calculation ───────────────────────────────────────────────

export function calcStreak(logs: { date: string }[], today: string): number {
  const dates = new Set(logs.map((l) => l.date))
  let streak = 0
  const d = new Date(today)
  while (true) {
    const str = d.toISOString().split('T')[0]
    if (!dates.has(str)) break
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

// ─── Helper: "you" person id detection ───────────────────────────────────────
// The creator of a GroupBill is represented as the first person whose name
// is "You" (case-insensitive) or simply the first person in the list.
function getYouPersonId(people: { id: string; name: string }[]): string {
  const you = people.find((p) => p.name.toLowerCase() === 'you')
  return you ? you.id : (people[0]?.id ?? '')
}

// ─── Main aggregation function ────────────────────────────────────────────────

export async function getDashboardData(
  userId: string,
  userName: string,
  userEmail: string
): Promise<DashboardData> {
  await connectDB()

  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`

  // ── Date window calculations ──
  const todayDate = new Date(today)

  // Start of current week (Monday)
  const dayOfWeek = todayDate.getDay() // 0=Sun, 1=Mon ...
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const weekStart = new Date(todayDate)
  weekStart.setDate(todayDate.getDate() - daysToMonday)
  const weekStartStr = weekStart.toISOString().split('T')[0]

  // Previous week
  const prevWeekStart = new Date(weekStart)
  prevWeekStart.setDate(weekStart.getDate() - 7)
  const prevWeekEnd = new Date(weekStart)
  prevWeekEnd.setDate(weekStart.getDate() - 1)
  const prevWeekStartStr = prevWeekStart.toISOString().split('T')[0]
  const prevWeekEndStr = prevWeekEnd.toISOString().split('T')[0]

  // Start of current month
  const monthStart = `${today.slice(0, 7)}-01`

  // Previous month
  const prevMonthDate = new Date(todayDate)
  prevMonthDate.setDate(1)
  prevMonthDate.setMonth(prevMonthDate.getMonth() - 1)
  const prevMonthStart = prevMonthDate.toISOString().split('T')[0].slice(0, 8) + '01'
  const prevMonthEnd = new Date(todayDate.getFullYear(), todayDate.getMonth(), 0)
    .toISOString().split('T')[0]

  // Upcoming: tomorrow + next 7 days
  const tomorrow = new Date(todayDate)
  tomorrow.setDate(todayDate.getDate() + 1)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]
  const nextWeek = new Date(todayDate)
  nextWeek.setDate(todayDate.getDate() + 7)
  const nextWeekStr = nextWeek.toISOString().split('T')[0]

  // 30-day rolling window for habits
  const thirtyDaysAgo = new Date(todayDate)
  thirtyDaysAgo.setDate(todayDate.getDate() - 30)
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0]

  // 7-day chart window (Mon–Sun of current week)
  const chartDates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    chartDates.push(d.toISOString().split('T')[0])
  }

  // Overdue tasks: due before today, not completed
  const threeDaysAgo = new Date(todayDate)
  threeDaysAgo.setDate(todayDate.getDate() - 3)
  const threeDaysAgoStr = threeDaysAgo.toISOString().split('T')[0]

  // ── Parallel DB fetch ──────────────────────────────────────────────────────
  const [
    todayTasks,
    overdueTasks,
    allHabits,
    todayHabitLogs,
    allHabitLogsLast30,
    todayExpenses,
    weekExpenses,
    monthExpenses,
    prevMonthExpenses,
    recentNotesRaw,
    upcomingTasksRaw,
    recentGroupBillsRaw,
    allGroupBillsRaw,
    unreadNotifCount,
    recentActivityRaw,
    prefDoc,
    weekTasksQuery,
    prevWeekExpenses,
    weekHabitLogsRaw,
    , // prevWeekHabitLogs — reserved for future week-over-week habit comparison
    thisWeekNotes,
    thisWeekGroupBills,
    rollingDailyExpenses,
    moneyRecordsRaw,
  ] = await Promise.all([
    // Today's tasks (with dueDate = today)
    Task.find({ userId, dueDate: today }).sort({ priority: -1 }).lean(),

    // Overdue tasks (not completed, dueDate in last 3 days up to yesterday)
    Task.find({
      userId,
      completed: false,
      dueDate: { $gte: threeDaysAgoStr, $lt: today },
    }).sort({ dueDate: 1, priority: -1 }).limit(5).lean(),

    // All habits
    Habit.find({ userId }).lean(),

    // Today's habit logs
    HabitLog.find({ userId, date: today }).lean(),

    // Last 30 days habit logs for streak
    HabitLog.find({
      userId,
      date: { $gte: thirtyDaysAgoStr },
      completed: true,
    }).lean(),

    // Today's expenses
    Expense.find({ userId, date: today }).lean(),

    // This week's expenses
    Expense.find({ userId, date: { $gte: weekStartStr, $lte: today } }).lean(),

    // This month's expenses
    Expense.find({ userId, date: { $gte: monthStart, $lte: today } }).lean(),

    // Previous month's expenses (for spending warning comparison)
    Expense.find({ userId, date: { $gte: prevMonthStart, $lte: prevMonthEnd } }).lean(),

    // Recent notes (not archived)
    Note.find({ userId, archived: false })
      .sort({ updatedAt: -1 })
      .limit(4)
      .lean(),

    // Upcoming tasks (tomorrow through next 7 days, not completed)
    Task.find({
      userId,
      dueDate: { $gte: tomorrowStr, $lte: nextWeekStr },
      completed: false,
    })
      .sort({ dueDate: 1, priority: -1 })
      .limit(6)
      .lean(),

    // Recent group bills for "recent group bills" widget (3)
    GroupBill.find({ userId })
      .sort({ createdAt: -1 })
      .limit(3)
      .lean(),

    // All group bills for reminders (unsettled settlements)
    GroupBill.find({ userId })
      .sort({ date: -1 })
      .lean(),

    // Unread notification count
    Notification.countDocuments({ userId, read: false }),

    // Recent activity for "Continue" section
    RecentActivity.find({ userId })
      .sort({ timestamp: -1 })
      .limit(10)
      .lean(),

    // Dashboard section preferences
    DashboardPreference.findOne({ userId }).lean(),

    // This week's tasks for weekly review
    Task.find({
      userId,
      dueDate: { $gte: weekStartStr, $lte: today },
    }).lean(),

    // Previous week expenses
    Expense.find({
      userId,
      date: { $gte: prevWeekStartStr, $lte: prevWeekEndStr },
    }).lean(),

    // This week habit logs (for weekly review consistency)
    HabitLog.find({
      userId,
      date: { $gte: weekStartStr, $lte: today },
      completed: true,
    }).lean(),

    // Previous week habit logs — kept for future comparison features
    HabitLog.find({
      userId,
      date: { $gte: prevWeekStartStr, $lte: prevWeekEndStr },
      completed: true,
    }).lean(),

    // Notes created this week
    Note.countDocuments({
      userId,
      createdAt: { $gte: weekStart, $lte: now },
    }),

    // Group bills created this week
    GroupBill.countDocuments({
      userId,
      createdAt: { $gte: weekStart, $lte: now },
    }),

    // Rolling 30-day daily expenses for average
    Expense.find({
      userId,
      date: { $gte: thirtyDaysAgoStr, $lt: today },
    }).lean(),

    // Money records for dashboard summary
    MoneyRecord.find({ userId }).lean(),
  ])

  // ── Process today's tasks ──────────────────────────────────────────────────
  const tasks: DashboardTask[] = todayTasks.map((t) => ({
    _id: t._id.toString(),
    title: t.title,
    completed: t.completed,
    priority: t.priority as 'low' | 'medium' | 'high',
    dueDate: t.dueDate,
    dueTime: t.dueTime,
  }))
  const completedCount = tasks.filter((t) => t.completed).length

  // ── Process habits with streak ─────────────────────────────────────────────
  const completedHabitIds = new Set(
    todayHabitLogs.filter((l) => l.completed).map((l) => l.habitId.toString())
  )

  const habits: DashboardHabit[] = allHabits.map((h) => {
    const hid = h._id.toString()
    const logsForHabit = allHabitLogsLast30.filter(
      (l) => l.habitId.toString() === hid
    )
    const streak = calcStreak(logsForHabit, today)
    return {
      _id: hid,
      name: h.name,
      icon: h.icon,
      completedToday: completedHabitIds.has(hid),
      streak,
    }
  })

  const completedHabits = habits.filter((h) => h.completedToday).length
  const totalItems = tasks.length + habits.length
  const completedItems = completedCount + completedHabits
  const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0
  const streak = habits.length > 0 ? Math.max(...habits.map((h) => h.streak)) : 0

  // ── Process spending ───────────────────────────────────────────────────────
  const todaySpend = todayExpenses.reduce((s, e) => s + e.amount, 0)
  const weekSpend = weekExpenses.reduce((s, e) => s + e.amount, 0)
  const monthSpend = monthExpenses.reduce((s, e) => s + e.amount, 0)

  // Top category (from month)
  const catTotals: Record<string, number> = {}
  for (const e of monthExpenses) {
    catTotals[e.category] = (catTotals[e.category] || 0) + e.amount
  }
  const topCatEntry = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0]
  const topCategory = topCatEntry
    ? {
        name: topCatEntry[0],
        emoji: EXPENSE_CATEGORIES.find((c) => c.value === topCatEntry[0])?.emoji ?? '📦',
        amount: topCatEntry[1],
      }
    : null

  // Weekly chart (Mon–Sun)
  const weeklyChart = chartDates.map((d) =>
    weekExpenses.filter((e) => e.date === d).reduce((s, e) => s + e.amount, 0)
  )

  const spending: DashboardExpenseStat = {
    today: todaySpend,
    week: weekSpend,
    month: monthSpend,
    topCategory,
    weeklyChart,
  }

  // ── Recent notes ───────────────────────────────────────────────────────────
  const recentNotes: DashboardNote[] = recentNotesRaw.map((n) => ({
    _id: n._id.toString(),
    title: n.title,
    content: n.content,
    updatedAt: n.updatedAt.toISOString(),
  }))

  // ── Upcoming tasks ─────────────────────────────────────────────────────────
  const upcomingTasks: DashboardUpcomingTask[] = upcomingTasksRaw.map((t) => ({
    _id: t._id.toString(),
    title: t.title,
    priority: t.priority as 'low' | 'medium' | 'high',
    dueDate: t.dueDate!,
    dueTime: t.dueTime,
  }))

  // ── Group bills (recent widget) ────────────────────────────────────────────
  const recentGroupBills: DashboardGroupBill[] = recentGroupBillsRaw.map((b) => {
    const peopleCount = b.people.length || 1
    const myShare = b.total / peopleCount
    return {
      _id: b._id.toString(),
      name: b.name,
      date: b.date,
      total: b.total,
      peopleCount: b.people.length,
      myShare: Math.round(myShare * 100) / 100,
      currency: b.currency,
    }
  })

  // ── Insights ───────────────────────────────────────────────────────────────
  const insights: DashboardInsight[] = []
  const weekTasksTotal = weekTasksQuery.length
  const weekTasksDone = weekTasksQuery.filter((t) => t.completed).length
  if (weekTasksTotal >= 3) {
    const rate = Math.round((weekTasksDone / weekTasksTotal) * 100)
    insights.push({ text: `You completed ${rate}% of your tasks this week.`, icon: '✅' })
  }
  if (streak >= 3) {
    const habitWithStreak = habits.find((h) => h.streak === streak)
    if (habitWithStreak) {
      insights.push({
        text: `${habitWithStreak.icon} ${habitWithStreak.name} — ${streak} day streak. Keep it up!`,
        icon: '🔥',
      })
    }
  }
  if (topCategory && monthSpend > 0) {
    insights.push({
      text: `${topCategory.emoji} ${topCategory.name.charAt(0).toUpperCase() + topCategory.name.slice(1)} is your top spending category this month.`,
      icon: '💰',
    })
  }
  const lastWeekSpend = prevWeekExpenses.reduce((s, e) => s + e.amount, 0)
  if (lastWeekSpend > 0 && weekSpend > 0) {
    const diff = Math.round(Math.abs(((weekSpend - lastWeekSpend) / lastWeekSpend) * 100))
    if (weekSpend < lastWeekSpend && diff >= 5) {
      insights.push({ text: `You spent ${diff}% less this week than last week. Great discipline!`, icon: '📉' })
    } else if (weekSpend > lastWeekSpend && diff >= 10) {
      insights.push({ text: `You spent ${diff}% more this week than last week.`, icon: '📈' })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NEW FEATURES
  // ═══════════════════════════════════════════════════════════════════════════

  // ── 1. FOCUS FOR TODAY ────────────────────────────────────────────────────
  const focus: FocusItem[] = []

  // Priority 1: overdue tasks (due before today, not completed)
  for (const t of overdueTasks.slice(0, 2)) {
    focus.push({
      _id: t._id.toString(),
      type: 'task',
      title: t.title,
      completed: t.completed,
      priority: t.priority as 'low' | 'medium' | 'high',
      reason: 'overdue',
    })
  }

  // Priority 2: high-priority tasks due today, not completed
  const highPriorityToday = tasks.filter((t) => t.priority === 'high' && !t.completed)
  for (const t of highPriorityToday.slice(0, 2)) {
    if (!focus.find((f) => f._id === t._id)) {
      focus.push({ _id: t._id, type: 'task', title: t.title, completed: false, priority: 'high', reason: 'high_priority_today' })
    }
  }

  // Priority 3: medium tasks due today, not completed (fill up to 3)
  if (focus.length < 3) {
    const mediumToday = tasks.filter((t) => t.priority === 'medium' && !t.completed)
    for (const t of mediumToday) {
      if (focus.length >= 3) break
      if (!focus.find((f) => f._id === t._id)) {
        focus.push({ _id: t._id, type: 'task', title: t.title, completed: false, priority: 'medium', reason: 'due_today' })
      }
    }
  }

  // Priority 4: incomplete habits (fill up to 3)
  if (focus.length < 3) {
    const incompleteHabits = habits.filter((h) => !h.completedToday)
    for (const h of incompleteHabits) {
      if (focus.length >= 3) break
      focus.push({ _id: h._id, type: 'habit', title: h.name, icon: h.icon, completed: false, reason: 'incomplete_habit' })
    }
  }

  // ── 2. STREAK PROTECTION ──────────────────────────────────────────────────
  // Show habits that have an active streak AND are not yet completed today
  // AND there is still time left in the day (before 22:00)
  const streakRisks: StreakRiskHabit[] = habits
    .filter((h) => h.streak >= 2 && !h.completedToday && currentHour < 22)
    .map((h) => ({ _id: h._id, name: h.name, icon: h.icon, streak: h.streak, completedToday: false }))

  // ── 3. SPENDING WARNINGS ──────────────────────────────────────────────────
  const spendingWarnings: SpendingWarning[] = []

  // Only generate warnings if there is meaningful historical data
  const prevMonthSpend = prevMonthExpenses.reduce((s, e) => s + e.amount, 0)

  // 3a. Category month-over-month comparison
  if (prevMonthSpend > 0 && monthSpend > 0) {
    const prevCatTotals: Record<string, number> = {}
    for (const e of prevMonthExpenses) {
      prevCatTotals[e.category] = (prevCatTotals[e.category] || 0) + e.amount
    }
    for (const [cat, curAmt] of Object.entries(catTotals)) {
      const prevAmt = prevCatTotals[cat] ?? 0
      if (prevAmt > 0 && curAmt > 0) {
        const pct = Math.round(((curAmt - prevAmt) / prevAmt) * 100)
        if (pct >= 20) {
          const catInfo = EXPENSE_CATEGORIES.find((c) => c.value === cat)
          spendingWarnings.push({
            type: 'category_increase',
            message: `You've spent ${catInfo?.emoji ?? '📦'} ${catInfo?.label ?? cat} ${pct}% more this month vs last month.`,
            detail: undefined,
            severity: pct >= 40 ? 'warning' : 'info',
            linkToAnalytics: true,
          })
          break // one category warning is enough
        }
      }
    }
  }

  // 3b. Today vs rolling daily average (only if 7+ days of history)
  const rollingDays: Record<string, number> = {}
  for (const e of rollingDailyExpenses) {
    rollingDays[e.date] = (rollingDays[e.date] || 0) + e.amount
  }
  const rollingDayValues = Object.values(rollingDays)
  if (rollingDayValues.length >= 7 && todaySpend > 0) {
    const avg = rollingDayValues.reduce((s, v) => s + v, 0) / rollingDayValues.length
    if (avg > 0 && todaySpend > avg * 1.5) {
      spendingWarnings.push({
        type: 'daily_average',
        message: `Your spending today is higher than your usual daily average.`,
        detail: `Today: ₹${Math.round(todaySpend)} · Typical: ₹${Math.round(avg)}`,
        severity: 'info',
        linkToAnalytics: false,
      })
    }
  }

  // ── 4. TODAY TIMELINE ─────────────────────────────────────────────────────
  // Only tasks for today that have a dueTime
  const timeline: TimelineItem[] = tasks
    .filter((t) => !!t.dueTime)
    .sort((a, b) => (a.dueTime! > b.dueTime! ? 1 : -1))
    .map((t) => {
      let status: TimelineItem['status']
      if (t.completed) {
        status = 'completed'
      } else if (t.dueTime! < currentTimeStr) {
        status = 'overdue'
      } else {
        status = 'upcoming'
      }
      return { _id: t._id, title: t.title, dueTime: t.dueTime!, completed: t.completed, status }
    })

  // ── 5. WEEKLY REVIEW ──────────────────────────────────────────────────────
  const weekTasksCompletedCount = weekTasksDone
  const weekTasksTotalCount = weekTasksTotal

  // Habit consistency this week
  const weekHabitCompletedIds = new Set(weekHabitLogsRaw.map((l) => l.habitId.toString()))
  const habitsWithLogs = allHabits.length
  // Calculate expected habit completions this week (days elapsed × habits)
  const daysElapsed = daysToMonday + 1 // how many days Mon–today
  const expectedHabitCompletions = Math.max(1, habitsWithLogs * daysElapsed)
  const actualHabitCompletions = weekHabitLogsRaw.length
  const habitConsistency = habitsWithLogs > 0
    ? Math.min(100, Math.round((actualHabitCompletions / expectedHabitCompletions) * 100))
    : 0

  const bestStreakThisWeek = habits.length > 0 ? Math.max(...habits.map((h) => h.streak)) : 0

  // Deterministic weekly highlights
  const highlights: WeeklyReviewData['highlights'] = []

  if (weekTasksTotalCount >= 3) {
    const rate = Math.round((weekTasksCompletedCount / weekTasksTotalCount) * 100)
    if (rate >= 70) {
      highlights.push({ text: `You completed ${rate}% of your tasks this week.`, type: 'positive' })
    } else if (rate < 50 && weekTasksTotalCount - weekTasksCompletedCount >= 3) {
      highlights.push({ text: `${weekTasksTotalCount - weekTasksCompletedCount} tasks became overdue this week.`, type: 'negative' })
    }
  }
  if (habitConsistency >= 75) {
    highlights.push({ text: `You completed ${habitConsistency}% of your habits this week.`, type: 'positive' })
  } else if (habitsWithLogs > 0 && habitConsistency < 50) {
    highlights.push({ text: `Habit consistency was ${habitConsistency}% this week — room to improve.`, type: 'negative' })
  }
  if (prevMonthSpend > 0 && monthSpend > 0) {
    const prevCatTotals2: Record<string, number> = {}
    for (const e of prevMonthExpenses) prevCatTotals2[e.category] = (prevCatTotals2[e.category] || 0) + e.amount
    for (const [cat, curAmt] of Object.entries(catTotals)) {
      const prevAmt = prevCatTotals2[cat] ?? 0
      if (prevAmt > 0 && curAmt > prevAmt) {
        const pct = Math.round(((curAmt - prevAmt) / prevAmt) * 100)
        const catInfo = EXPENSE_CATEGORIES.find((c) => c.value === cat)
        if (pct >= 15) {
          highlights.push({ text: `${catInfo?.label ?? cat} spending increased ${pct}% vs last month.`, type: 'negative' })
          break
        }
      }
    }
  }
  if (weekHabitCompletedIds.size > 0 && bestStreakThisWeek >= 5) {
    highlights.push({ text: `Your best habit streak is ${bestStreakThisWeek} days — keep it going!`, type: 'positive' })
  }

  // Current week label
  const weekLabel = `${new Date(weekStartStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(today).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  const weeklyReview: WeeklyReviewData = {
    weekLabel,
    tasks: { completed: weekTasksCompletedCount, total: weekTasksTotalCount },
    habits: { consistency: habitConsistency, total: habitsWithLogs },
    spending: weekSpend,
    notesCreated: thisWeekNotes,
    groupBillsCount: thisWeekGroupBills,
    bestStreak: bestStreakThisWeek,
    highlights,
  }

  // ── 6. GROUP BILL REMINDERS ───────────────────────────────────────────────
  const groupBillReminders: GroupBillReminder[] = []

  for (const bill of allGroupBillsRaw) {
    const youId = getYouPersonId(bill.people)
    if (!youId) continue

    const unsettled = bill.settlements.filter((s) => !s.settled)
    if (unsettled.length === 0) continue

    // Find settlements involving the user (as "you" person)
    const relevant = unsettled.filter(
      (s) => s.fromPerson === youId || s.toPerson === youId
    )
    if (relevant.length === 0) continue

    // Build a map of person id → name
    const nameMap: Record<string, string> = {}
    for (const p of bill.people) nameMap[p.id] = p.name

    const reminders: GroupBillReminder['reminders'] = []
    let owedToMe = 0
    let iOwe = 0

    for (const s of relevant) {
      if (s.toPerson === youId) {
        // someone owes me
        owedToMe += s.amount
        reminders.push({
          fromPerson: s.fromPerson,
          toPerson: s.toPerson,
          amount: s.amount,
          direction: 'owed_to_me',
          fromName: nameMap[s.fromPerson] ?? s.fromPerson,
          toName: nameMap[s.toPerson] ?? s.toPerson,
        })
      } else if (s.fromPerson === youId) {
        // I owe someone
        iOwe += s.amount
        reminders.push({
          fromPerson: s.fromPerson,
          toPerson: s.toPerson,
          amount: s.amount,
          direction: 'i_owe',
          fromName: nameMap[s.fromPerson] ?? s.fromPerson,
          toName: nameMap[s.toPerson] ?? s.toPerson,
        })
      }
    }

    if (reminders.length > 0) {
      groupBillReminders.push({
        _id: bill._id.toString(),
        name: bill.name,
        currency: bill.currency,
        owedToMe: Math.round(owedToMe * 100) / 100,
        iOwe: Math.round(iOwe * 100) / 100,
        reminders,
      })
    }
  }

  // ── 7. CONTINUE WHERE YOU LEFT OFF ────────────────────────────────────────
  const hrefMap: Record<string, string> = {
    note: '/app/notes',
    task: '/app/tasks',
    habit: '/app/habits',
    expense: '/app/expenses',
    groupBill: '/app/expenses',
  }

  const continueItems: ContinueItem[] = recentActivityRaw.slice(0, 5).map((a) => ({
    _id: a._id.toString(),
    type: a.type,
    title: a.entityTitle,
    action: a.action,
    timestamp: a.timestamp.toISOString(),
    href: hrefMap[a.type] ?? '/app/dashboard',
  }))

  // ── 8. SECTION PREFERENCES ────────────────────────────────────────────────
  const sectionPrefs: DashboardSectionPref[] = prefDoc
    ? (prefDoc.sections as IDashboardSection[]).map((s) => ({
        id: s.id,
        visible: s.visible,
        order: s.order,
      }))
    : DEFAULT_SECTIONS.map((s) => ({ id: s.id, visible: s.visible, order: s.order }))

  // ── 9. MONEY TRACKER SUMMARY ──────────────────────────────────────────────
  const moneySummary = await (async (): Promise<MoneyTrackerSummary> => {
    if (moneyRecordsRaw.length === 0) {
      return { toCollectMinor: 0, toPayMinor: 0, netMinor: 0, topDebtors: [], topCreditors: [] }
    }

    const recordIds = moneyRecordsRaw.map((r) => r._id)
    const moneyPayments = await MoneyPayment.find({ moneyRecordId: { $in: recordIds } }).lean()

    const paymentMap = new Map<string, IMoneyPayment[]>()
    for (const p of moneyPayments) {
      const key = p.moneyRecordId.toString()
      if (!paymentMap.has(key)) paymentMap.set(key, [])
      paymentMap.get(key)!.push(p as unknown as IMoneyPayment)
    }

    let toCollectMinor = 0
    let toPayMinor = 0
    const personMap = new Map<string, { name: string; owesYouMinor: number; youOweMinor: number }>()

    for (const r of moneyRecordsRaw) {
      const rec = r as unknown as IMoneyRecord
      const payments = paymentMap.get(r._id.toString()) ?? []
      const balance = calcBalance(rec.originalAmountMinor, rec.additionalAmounts ?? [], payments.map((p) => p.amountMinor))

      const name = rec.person.name
      if (!personMap.has(name)) personMap.set(name, { name, owesYouMinor: 0, youOweMinor: 0 })

      if (rec.direction === 'given') {
        toCollectMinor += balance.remainingMinor
        personMap.get(name)!.owesYouMinor += balance.remainingMinor
      } else {
        toPayMinor += balance.remainingMinor
        personMap.get(name)!.youOweMinor += balance.remainingMinor
      }
    }

    const people = Array.from(personMap.values())
    const topDebtors = people
      .filter((p) => p.owesYouMinor > 0)
      .sort((a, b) => b.owesYouMinor - a.owesYouMinor)
      .slice(0, 5)
      .map(({ name, owesYouMinor }) => ({ name, owesYouMinor }))
    const topCreditors = people
      .filter((p) => p.youOweMinor > 0)
      .sort((a, b) => b.youOweMinor - a.youOweMinor)
      .slice(0, 5)
      .map(({ name, youOweMinor }) => ({ name, youOweMinor }))

    return { toCollectMinor, toPayMinor, netMinor: toCollectMinor - toPayMinor, topDebtors, topCreditors }
  })()

  return {
    user: { name: userName, email: userEmail },
    today: {
      tasks,
      completedCount,
      habits,
      completedHabits,
      progress,
      streak,
    },
    spending,
    recentNotes,
    upcomingTasks,
    recentGroupBills,
    unreadNotifications: unreadNotifCount,
    insights,
    focus,
    streakRisks,
    spendingWarnings,
    timeline,
    weeklyReview,
    groupBillReminders,
    continueItems,
    sectionPrefs,
    moneySummary,
  }
}
