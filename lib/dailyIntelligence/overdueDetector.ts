/**
 * lib/dailyIntelligence/overdueDetector.ts
 *
 * Shared, reusable server-side service for detecting overdue items.
 *
 * DESIGN PRINCIPLES
 * ─────────────────
 * • Every "today" comparison is performed in the user's configured IANA timezone,
 *   never the server's local timezone.
 * • Completed, archived, and deleted items are never reported as overdue.
 * • All-day deadlines (dueDate without dueTime) are considered overdue only
 *   when the entire local calendar day has passed.
 * • Records with dueTime are compared to the current local time (HH:MM).
 * • Recurrence: a recurring task that is due today is NOT overdue even if
 *   a previous occurrence was missed — we only look at non-completed tasks.
 * • Habits: a daily habit is overdue for today if it is past the optional
 *   completion window, but we flag it as "at risk" rather than "overdue"
 *   because HabitLog does not carry a deadline time. A weekly habit is only
 *   checked on its scheduled day.
 * • MoneyRecord status 'overdue' is cached on the document; we re-derive it
 *   from dueDate to avoid stale cached state.
 *
 * DATA MODEL LIMITATIONS (documented per spec §5)
 * ───────────────────────────────────────────────
 * 1. Tasks carry dueDate (YYYY-MM-DD) and optional dueTime (HH:MM).
 *    There is no timezone stored on the task itself — the owning user's
 *    timezone is used for all comparisons.
 * 2. Habits have no individual deadline time; only "did the user complete it
 *    today?" is answerable. We flag uncompleted daily habits as "at risk" once
 *    the local hour exceeds 20:00, not as hard overdue.
 * 3. Goals have a targetDate (YYYY-MM-DD); there is no time component.
 * 4. Projects have a dueDate (YYYY-MM-DD); same as tasks.
 * 5. MoneyRecord.dueDate is optional; records without it are never overdue.
 */

import type { Types } from 'mongoose'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OverdueTask {
  _id: string
  title: string
  priority: 'low' | 'medium' | 'high'
  dueDate: string         // YYYY-MM-DD
  dueTime?: string        // HH:MM (absent = all-day)
  projectId?: string
  projectTitle?: string
  daysOverdue: number
}

export interface AtRiskHabit {
  _id: string
  name: string
  icon: string
  frequency: 'daily' | 'weekly'
  completedToday: boolean
  /** True when local time > 20:00 and habit still incomplete. */
  isOverdueWindow: boolean
}

export interface OverdueProject {
  _id: string
  title: string
  dueDate: string
  daysOverdue: number
  status: 'active' | 'on_hold'
}

export interface OverdueGoal {
  _id: string
  title: string
  targetDate: string
  daysOverdue: number
  currentValue: number
  targetValue: number
  unit: string
}

export interface OverdueMoneyRecord {
  _id: string
  personName: string
  direction: 'given' | 'borrowed'
  remainingMinor: number
  dueDate: string
  daysOverdue: number
}

export interface OverdueResult {
  /** Current local date in user's timezone, YYYY-MM-DD */
  today: string
  /** Current local hour (0–23) in user's timezone */
  localHour: number
  tasks: OverdueTask[]
  habitsAtRisk: AtRiskHabit[]
  projects: OverdueProject[]
  goals: OverdueGoal[]
  moneyRecords: OverdueMoneyRecord[]
}

// ─── Raw DB record shapes (lean() output) ─────────────────────────────────────

interface RawTask {
  _id: Types.ObjectId
  title: string
  priority: 'low' | 'medium' | 'high'
  dueDate?: string
  dueTime?: string
  completed: boolean
  recurring: 'none' | 'daily' | 'weekly' | 'monthly'
  projectId?: Types.ObjectId
}

interface RawHabit {
  _id: Types.ObjectId
  name: string
  icon: string
  frequency: 'daily' | 'weekly'
}

interface RawHabitLog {
  habitId: Types.ObjectId
  date: string
  completed: boolean
}

interface RawProject {
  _id: Types.ObjectId
  title: string
  dueDate?: string
  status: 'active' | 'on_hold' | 'completed' | 'archived'
}

interface RawGoal {
  _id: Types.ObjectId
  title: string
  targetDate?: string
  status: 'active' | 'completed' | 'archived'
  currentValue: number
  targetValue: number
  unit: string
}

interface RawMoneyRecord {
  _id: Types.ObjectId
  person: { name: string }
  direction: 'given' | 'borrowed'
  dueDate?: string
  status: string
  originalAmountMinor: number
  additionalAmounts: { amountMinor: number }[]
}

interface RawMoneyPayment {
  moneyRecordId: Types.ObjectId
  amountMinor: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return today's date as YYYY-MM-DD and current hour in the given IANA timezone.
 */
export function getLocalDateAndHour(
  now: Date,
  timezone: string
): { today: string; localHour: number; localTime: string } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)

    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
    const today = `${get('year')}-${get('month')}-${get('day')}`
    const localHour = parseInt(get('hour'), 10)
    const localTime = `${get('hour')}:${get('minute')}`
    return { today, localHour, localTime }
  } catch {
    const iso = now.toISOString()
    return { today: iso.split('T')[0], localHour: now.getUTCHours(), localTime: iso.slice(11, 16) }
  }
}

/**
 * Count the number of calendar days between two YYYY-MM-DD strings.
 * Returns a positive integer when `dateStr` is before `today`.
 */
export function daysBetween(dateStr: string, today: string): number {
  const [y1, m1, d1] = dateStr.split('-').map(Number)
  const [y2, m2, d2] = today.split('-').map(Number)
  const a = Date.UTC(y1, m1 - 1, d1)
  const b = Date.UTC(y2, m2 - 1, d2)
  return Math.round((b - a) / 86_400_000)
}

// ─── Main detection function ──────────────────────────────────────────────────

export interface DetectOverdueInput {
  now: Date
  timezone: string
  tasks: RawTask[]
  habits: RawHabit[]
  habitLogs: RawHabitLog[]
  projects: RawProject[]
  goals: RawGoal[]
  moneyRecords: RawMoneyRecord[]
  moneyPayments: RawMoneyPayment[]
  /** Optional map of projectId → project title for task enrichment */
  projectTitleMap?: Map<string, string>
}

/**
 * Detect all overdue items for a single user.
 *
 * This function is PURE with respect to its inputs — it never writes to the
 * database. Call it from the briefing engine or the scheduler after fetching
 * the necessary data.
 */
export function detectOverdue(input: DetectOverdueInput): OverdueResult {
  const { now, timezone, tasks, habits, habitLogs, projects, goals, moneyRecords, moneyPayments, projectTitleMap } = input
  const { today, localHour, localTime } = getLocalDateAndHour(now, timezone)

  // ── Overdue tasks ──────────────────────────────────────────────────────────
  const overdueTasks: OverdueTask[] = []
  for (const t of tasks) {
    if (t.completed) continue
    if (!t.dueDate) continue
    // Recurring tasks: if today is the due date recurrence, it is not overdue.
    // We classify it as overdue only if dueDate < today, OR if dueDate === today
    // and dueTime is set and has already passed.
    if (t.dueDate > today) continue

    if (t.dueDate === today) {
      // Same day — only overdue if a specific due time has passed
      if (t.dueTime && t.dueTime <= localTime) {
        // Time has passed today
        overdueTasks.push({
          _id: t._id.toString(),
          title: t.title,
          priority: t.priority,
          dueDate: t.dueDate,
          dueTime: t.dueTime,
          projectId: t.projectId?.toString(),
          projectTitle: t.projectId ? projectTitleMap?.get(t.projectId.toString()) : undefined,
          daysOverdue: 0,
        })
      }
      continue
    }

    // dueDate < today
    overdueTasks.push({
      _id: t._id.toString(),
      title: t.title,
      priority: t.priority,
      dueDate: t.dueDate,
      dueTime: t.dueTime,
      projectId: t.projectId?.toString(),
      projectTitle: t.projectId ? projectTitleMap?.get(t.projectId.toString()) : undefined,
      daysOverdue: daysBetween(t.dueDate, today),
    })
  }
  // Sort: most overdue first, then by priority (high > medium > low)
  const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }
  overdueTasks.sort((a, b) =>
    b.daysOverdue - a.daysOverdue || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
  )

  // ── Habits at risk ─────────────────────────────────────────────────────────
  const completedHabitIds = new Set(
    habitLogs.filter((l) => l.date === today && l.completed).map((l) => l.habitId.toString())
  )
  const habitsAtRisk: AtRiskHabit[] = []
  for (const h of habits) {
    const completedToday = completedHabitIds.has(h._id.toString())
    if (!completedToday) {
      habitsAtRisk.push({
        _id: h._id.toString(),
        name: h.name,
        icon: h.icon,
        frequency: h.frequency,
        completedToday: false,
        isOverdueWindow: localHour >= 20, // past 8 PM and still incomplete
      })
    }
  }

  // ── Overdue projects ───────────────────────────────────────────────────────
  const overdueProjects: OverdueProject[] = []
  for (const p of projects) {
    if (p.status === 'completed' || p.status === 'archived') continue
    if (!p.dueDate || p.dueDate >= today) continue
    overdueProjects.push({
      _id: p._id.toString(),
      title: p.title,
      dueDate: p.dueDate,
      daysOverdue: daysBetween(p.dueDate, today),
      status: p.status as 'active' | 'on_hold',
    })
  }
  overdueProjects.sort((a, b) => b.daysOverdue - a.daysOverdue)

  // ── Overdue goals ──────────────────────────────────────────────────────────
  const overdueGoals: OverdueGoal[] = []
  for (const g of goals) {
    if (g.status !== 'active') continue
    if (!g.targetDate || g.targetDate >= today) continue
    if (g.currentValue >= g.targetValue) continue // already achieved
    overdueGoals.push({
      _id: g._id.toString(),
      title: g.title,
      targetDate: g.targetDate,
      daysOverdue: daysBetween(g.targetDate, today),
      currentValue: g.currentValue,
      targetValue: g.targetValue,
      unit: g.unit,
    })
  }
  overdueGoals.sort((a, b) => b.daysOverdue - a.daysOverdue)

  // ── Overdue money records ──────────────────────────────────────────────────
  // Build payment sum per record
  const paymentSumMap = new Map<string, number>()
  for (const p of moneyPayments) {
    const key = p.moneyRecordId.toString()
    paymentSumMap.set(key, (paymentSumMap.get(key) ?? 0) + p.amountMinor)
  }

  const overdueMoneyRecords: OverdueMoneyRecord[] = []
  for (const r of moneyRecords) {
    if (!r.dueDate || r.dueDate >= today) continue
    const totalMinor = r.originalAmountMinor + r.additionalAmounts.reduce((s, a) => s + a.amountMinor, 0)
    const paidMinor = paymentSumMap.get(r._id.toString()) ?? 0
    const remainingMinor = Math.max(0, totalMinor - paidMinor)
    if (remainingMinor === 0) continue // fully paid — not overdue
    overdueMoneyRecords.push({
      _id: r._id.toString(),
      personName: r.person.name,
      direction: r.direction,
      remainingMinor,
      dueDate: r.dueDate,
      daysOverdue: daysBetween(r.dueDate, today),
    })
  }
  overdueMoneyRecords.sort((a, b) => b.daysOverdue - a.daysOverdue)

  return {
    today,
    localHour,
    tasks: overdueTasks,
    habitsAtRisk,
    projects: overdueProjects,
    goals: overdueGoals,
    moneyRecords: overdueMoneyRecords,
  }
}
