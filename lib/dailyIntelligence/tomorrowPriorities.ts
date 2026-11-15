/**
 * lib/dailyIntelligence/tomorrowPriorities.ts
 *
 * Generates three realistic priorities for tomorrow using transparent,
 * deterministic rules. No AI provider is used.
 *
 * RANKING RULES (applied in order)
 * ─────────────────────────────────
 * 1. Overdue tasks (oldest first, then by priority) — label: "Carry-forward"
 * 2. Tasks due tomorrow with high priority
 * 3. Tasks due tomorrow with medium priority
 * 4. Active projects with a dueDate within 7 days (deadline approaching)
 * 5. Active goals with a targetDate within 7 days
 * 6. Incomplete high-priority tasks with no due date (undated backlog)
 * 7. Daily habits that are consistently missed (streaks broken recently)
 *
 * FEASIBILITY CHECK
 * ─────────────────
 * • We never schedule work over a period we know to be blocked.
 *   Since calendar events carry date only (no start/end time), we cannot
 *   perform precise availability checks — items with unknown timing are
 *   labelled "tentative".
 * • The limit of 3 ensures the plan is realistic rather than exhaustive.
 * • We always return at most 3 recommendations. If fewer than 3 data items
 *   qualify, we return fewer — never pad with invented work.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type TomorrowPrioritySource =
  | 'overdue_task'
  | 'task_due_tomorrow'
  | 'high_priority_task'
  | 'project_deadline'
  | 'goal_deadline'
  | 'habit_maintenance'

export interface TomorrowPriority {
  rank: 1 | 2 | 3
  title: string
  reason: string
  source: TomorrowPrioritySource
  /** YYYY-MM-DD if a deadline applies */
  deadline?: string
  /** "tentative" when we lack duration or availability data */
  confidence: 'confirmed' | 'tentative'
  href: string
  sourceId: string
}

// ─── Raw input shapes ─────────────────────────────────────────────────────────

interface RawTask {
  _id: { toString(): string }
  title: string
  priority: 'low' | 'medium' | 'high'
  dueDate?: string
  dueTime?: string
  completed: boolean
  recurring: string
}

interface RawHabit {
  _id: { toString(): string }
  name: string
  icon: string
}

interface RawHabitLog {
  habitId: { toString(): string }
  date: string
  completed: boolean
}

interface RawProject {
  _id: { toString(): string }
  title: string
  dueDate?: string
  status: string
}

interface RawGoal {
  _id: { toString(): string }
  title: string
  targetDate?: string
  status: string
  currentValue: number
  targetValue: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().split('T')[0]
}

/**
 * Count how many of the last N days the habit was completed.
 */
function recentCompletionCount(
  habitId: string,
  logs: RawHabitLog[],
  today: string,
  lookbackDays: number
): number {
  let count = 0
  for (let i = 1; i <= lookbackDays; i++) {
    const date = addDays(today, -i)
    if (logs.find((l) => l.habitId.toString() === habitId && l.date === date && l.completed)) {
      count++
    }
  }
  return count
}

// ─── Main function ─────────────────────────────────────────────────────────────

export interface BuildTomorrowPrioritiesInput {
  today: string
  tasks: RawTask[]
  habits: RawHabit[]
  habitLogs: RawHabitLog[]
  projects: RawProject[]
  goals: RawGoal[]
}

export function buildTomorrowPriorities(
  input: BuildTomorrowPrioritiesInput
): TomorrowPriority[] {
  const { today, tasks, habits, habitLogs, projects, goals } = input
  const tomorrow = addDays(today, 1)
  const in7Days  = addDays(today, 7)

  const candidates: Omit<TomorrowPriority, 'rank'>[] = []
  const seenIds = new Set<string>()

  const add = (p: Omit<TomorrowPriority, 'rank'>) => {
    if (!seenIds.has(p.sourceId)) {
      seenIds.add(p.sourceId)
      candidates.push(p)
    }
  }

  // ── 1. Overdue tasks (carry-forward) ──────────────────────────────────────
  const overdueTasks = tasks
    .filter((t) => !t.completed && t.dueDate && t.dueDate < today)
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      const dateA = a.dueDate ?? ''
      const dateB = b.dueDate ?? ''
      if (dateA !== dateB) return dateA < dateB ? -1 : 1 // oldest first
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })

  for (const t of overdueTasks.slice(0, 2)) {
    add({
      title: t.title,
      reason: `Overdue since ${t.dueDate} — carrying forward.`,
      source: 'overdue_task',
      deadline: t.dueDate,
      confidence: 'confirmed',
      href: `/app/tasks?highlight=${t._id.toString()}`,
      sourceId: t._id.toString(),
    })
  }

  // ── 2. Tasks due tomorrow — high priority ──────────────────────────────────
  const tomorrowHighTasks = tasks.filter(
    (t) => !t.completed && t.dueDate === tomorrow && t.priority === 'high'
  )
  for (const t of tomorrowHighTasks) {
    add({
      title: t.title,
      reason: `High-priority task due tomorrow${t.dueTime ? ` at ${t.dueTime}` : ''}.`,
      source: 'task_due_tomorrow',
      deadline: tomorrow,
      confidence: 'confirmed',
      href: `/app/tasks?highlight=${t._id.toString()}`,
      sourceId: t._id.toString(),
    })
  }

  // ── 3. Tasks due tomorrow — medium priority ────────────────────────────────
  const tomorrowMediumTasks = tasks.filter(
    (t) => !t.completed && t.dueDate === tomorrow && t.priority === 'medium'
  )
  for (const t of tomorrowMediumTasks) {
    add({
      title: t.title,
      reason: `Due tomorrow — medium priority.`,
      source: 'task_due_tomorrow',
      deadline: tomorrow,
      confidence: 'confirmed',
      href: `/app/tasks?highlight=${t._id.toString()}`,
      sourceId: t._id.toString(),
    })
  }

  // ── 4. Projects with deadline approaching ─────────────────────────────────
  const urgentProjects = projects
    .filter(
      (p) =>
        (p.status === 'active' || p.status === 'on_hold') &&
        p.dueDate &&
        p.dueDate >= tomorrow &&
        p.dueDate <= in7Days
    )
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))

  for (const p of urgentProjects) {
    add({
      title: p.title,
      reason: `Project deadline on ${p.dueDate} — work now to avoid a rush.`,
      source: 'project_deadline',
      deadline: p.dueDate,
      confidence: 'tentative',
      href: `/app/projects`,
      sourceId: `project-${p._id.toString()}`,
    })
  }

  // ── 5. Goals with target date approaching ─────────────────────────────────
  const urgentGoals = goals
    .filter(
      (g) =>
        g.status === 'active' &&
        g.targetDate &&
        g.targetDate >= tomorrow &&
        g.targetDate <= in7Days &&
        g.currentValue < g.targetValue
    )
    .sort((a, b) => (a.targetDate! < b.targetDate! ? -1 : 1))

  for (const g of urgentGoals) {
    add({
      title: g.title,
      reason: `Goal target date is ${g.targetDate} — progress needed.`,
      source: 'goal_deadline',
      deadline: g.targetDate,
      confidence: 'tentative',
      href: `/app/goals`,
      sourceId: `goal-${g._id.toString()}`,
    })
  }

  // ── 6. High-priority undated tasks (backlog) ───────────────────────────────
  const undatedHigh = tasks.filter(
    (t) => !t.completed && t.priority === 'high' && !t.dueDate
  )
  for (const t of undatedHigh) {
    add({
      title: t.title,
      reason: 'High-priority task with no deadline — schedule it before it slips.',
      source: 'high_priority_task',
      confidence: 'tentative',
      href: `/app/tasks?highlight=${t._id.toString()}`,
      sourceId: t._id.toString(),
    })
  }

  // ── 7. Habits frequently missed in the last 7 days ────────────────────────
  const LOOKBACK = 7
  const strugglingHabits = habits
    .map((h) => ({
      habit: h,
      completions: recentCompletionCount(h._id.toString(), habitLogs, today, LOOKBACK),
    }))
    .filter(({ completions }) => completions < Math.floor(LOOKBACK / 2)) // missed more than half
    .sort((a, b) => a.completions - b.completions) // worst first

  for (const { habit, completions } of strugglingHabits) {
    add({
      title: `${habit.icon} ${habit.name}`,
      reason: `Only completed ${completions}/${LOOKBACK} days recently — habit at risk.`,
      source: 'habit_maintenance',
      confidence: 'tentative',
      href: `/app/habits`,
      sourceId: `habit-${habit._id.toString()}`,
    })
  }

  // ── Cap at 3, assign ranks ────────────────────────────────────────────────
  return candidates.slice(0, 3).map((c, i) => ({
    ...c,
    rank: (i + 1) as 1 | 2 | 3,
  }))
}
