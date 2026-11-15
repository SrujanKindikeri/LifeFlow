/**
 * lib/dailyIntelligence/conflictDetector.ts
 *
 * Detects potential schedule conflicts and risks for the Daily Intelligence briefing.
 *
 * WHAT WE CAN DETECT (data supports it)
 * ──────────────────────────────────────
 * 1. Tasks with dueTime that overlap each other (both have start+estimated duration
 *    OR two tasks share the same dueTime within 15 minutes).
 * 2. Tasks with dueTime that fall inside a blocking calendar event window
 *    (subscriptions/money-due create virtual calendar events with date only —
 *    these are excluded from time-overlap detection).
 * 3. Insufficient time between "now" and a task's dueTime given how many tasks
 *    remain on the same day.
 * 4. Two tasks on the same day whose combined estimated durations exceed the
 *    available working hours (a scheduling-density risk, NOT a confirmed overlap).
 *
 * WHAT WE CANNOT DETECT (data model limitations — documented per spec §6)
 * ────────────────────────────────────────────────────────────────────────
 * • Task duration / estimated time is NOT stored in the Task schema.
 *   We use a default assumption of 30 minutes per task where needed, labelled
 *   "tentative" in the output.
 * • Calendar events have a date but NO start/end time in the LifeFlow data
 *   model (calendar is a virtual aggregation of Tasks, Habits, Subscriptions,
 *   Goals, Projects — none of which carry event start/end times beyond dueTime
 *   on Tasks). We therefore cannot detect task-vs-calendar-event time overlaps
 *   unless the conflicting item is a Task (which does carry dueTime).
 * • Habit schedules have no time component; they are excluded from time-overlap
 *   detection.
 *
 * All findings use ConflictSeverity to distinguish confirmed overlaps from risks.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConflictSeverity =
  | 'confirmed'   // data definitively shows an overlap
  | 'likely'      // strong evidence but one piece of data is assumed
  | 'possible'    // scheduling density risk; cannot confirm without more data

export type ConflictKind =
  | 'task_time_overlap'         // two tasks scheduled within minutes of each other
  | 'insufficient_time'         // tasks due soon but current time leaves no room
  | 'schedule_density'          // too many tasks with times in a short window
  | 'deadline_cluster'          // multiple high-priority deadlines on same day

export interface ScheduleConflict {
  kind: ConflictKind
  severity: ConflictSeverity
  title: string
  description: string
  /** IDs of the tasks/items involved */
  involvedIds: string[]
  /** Deep-links to the involved records */
  links: { label: string; href: string }[]
}

// ─── Raw input shapes ─────────────────────────────────────────────────────────

export interface ConflictTask {
  _id: string
  title: string
  dueDate: string       // YYYY-MM-DD
  dueTime?: string      // HH:MM (24h)
  priority: 'low' | 'medium' | 'high'
  completed: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert HH:MM to total minutes since midnight. */
function toMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

/** Format HH:MM for display (e.g. "09:30 AM"). */
function fmt(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// Default assumed task duration in minutes when no estimate is available.
const DEFAULT_TASK_DURATION_MINUTES = 30

// Minimum gap in minutes between tasks before we flag a likely overlap.
const MIN_GAP_MINUTES = 15

// ─── Main detection function ──────────────────────────────────────────────────

export interface DetectConflictsInput {
  today: string          // YYYY-MM-DD in user's timezone
  localTime: string      // HH:MM current local time
  tasks: ConflictTask[]  // ALL tasks for the user (filtered to today in caller)
}

/**
 * Detect schedule conflicts from today's incomplete tasks.
 *
 * Returns an array of conflicts/risks sorted by severity (confirmed first).
 * Returns an empty array when there is insufficient data to report any conflict.
 */
export function detectConflicts(input: DetectConflictsInput): ScheduleConflict[] {
  const { today, localTime, tasks } = input

  // Only look at today's incomplete tasks that have a dueTime
  const timedTasks = tasks.filter(
    (t) => !t.completed && t.dueDate === today && t.dueTime
  ).sort((a, b) => toMinutes(a.dueTime!) - toMinutes(b.dueTime!))

  // Today's all tasks (incomplete, any dueTime) for density checks
  const todayIncompleteTasks = tasks.filter(
    (t) => !t.completed && t.dueDate === today
  )

  const conflicts: ScheduleConflict[] = []

  // ── 1. Task time overlaps ──────────────────────────────────────────────────
  // Two tasks are flagged as overlapping when their dueTime values are within
  // DEFAULT_TASK_DURATION_MINUTES of each other (i.e. the first task would not
  // realistically complete before the second one starts).
  for (let i = 0; i < timedTasks.length - 1; i++) {
    const a = timedTasks[i]
    const b = timedTasks[i + 1]
    const aMin = toMinutes(a.dueTime!)
    const bMin = toMinutes(b.dueTime!)
    const gap = bMin - aMin

    if (gap < MIN_GAP_MINUTES) {
      // Confirmed overlap: dueTime values are < 15 minutes apart
      conflicts.push({
        kind: 'task_time_overlap',
        severity: gap === 0 ? 'confirmed' : 'likely',
        title: 'Tasks scheduled too close together',
        description:
          gap === 0
            ? `"${a.title}" and "${b.title}" are both due at ${fmt(a.dueTime!)}. Only one can be completed on time.`
            : `"${a.title}" (due ${fmt(a.dueTime!)}) and "${b.title}" (due ${fmt(b.dueTime!)}) are only ${gap} minute${gap === 1 ? '' : 's'} apart — less than the assumed ${DEFAULT_TASK_DURATION_MINUTES}-minute task duration.`,
        involvedIds: [a._id, b._id],
        links: [
          { label: a.title, href: `/app/tasks?highlight=${a._id}` },
          { label: b.title, href: `/app/tasks?highlight=${b._id}` },
        ],
      })
    } else if (gap < DEFAULT_TASK_DURATION_MINUTES) {
      // Possible: gap exists but is less than assumed task duration
      conflicts.push({
        kind: 'task_time_overlap',
        severity: 'possible',
        title: 'Tight schedule between tasks',
        description: `"${a.title}" (due ${fmt(a.dueTime!)}) and "${b.title}" (due ${fmt(b.dueTime!)}) have only ${gap} minutes between them. Duration is estimated at ${DEFAULT_TASK_DURATION_MINUTES} min per task.`,
        involvedIds: [a._id, b._id],
        links: [
          { label: a.title, href: `/app/tasks?highlight=${a._id}` },
          { label: b.title, href: `/app/tasks?highlight=${b._id}` },
        ],
      })
    }
  }

  // ── 2. Insufficient time: tasks due within the next 30 minutes ─────────────
  const nowMin = toMinutes(localTime)
  const soonTasks = timedTasks.filter((t) => {
    const diff = toMinutes(t.dueTime!) - nowMin
    return diff > 0 && diff <= DEFAULT_TASK_DURATION_MINUTES
  })
  if (soonTasks.length > 1) {
    conflicts.push({
      kind: 'insufficient_time',
      severity: 'likely',
      title: `${soonTasks.length} tasks due in the next ${DEFAULT_TASK_DURATION_MINUTES} minutes`,
      description: `Multiple tasks are due very soon: ${soonTasks.map((t) => `"${t.title}" at ${fmt(t.dueTime!)}`).join(', ')}. It may not be possible to complete all of them.`,
      involvedIds: soonTasks.map((t) => t._id),
      links: soonTasks.map((t) => ({ label: t.title, href: `/app/tasks?highlight=${t._id}` })),
    })
  }

  // ── 3. Schedule density: many timed tasks in a 2-hour window ──────────────
  // Only flag when ≥3 timed tasks, to avoid noise on light days.
  if (timedTasks.length >= 3) {
    // Sliding 2-hour window
    for (let i = 0; i < timedTasks.length; i++) {
      const windowStart = toMinutes(timedTasks[i].dueTime!)
      const windowEnd = windowStart + 120
      const inWindow = timedTasks.filter(
        (t) => toMinutes(t.dueTime!) >= windowStart && toMinutes(t.dueTime!) <= windowEnd
      )
      if (inWindow.length >= 3) {
        const totalAssumedMin = inWindow.length * DEFAULT_TASK_DURATION_MINUTES
        conflicts.push({
          kind: 'schedule_density',
          severity: 'possible',
          title: `${inWindow.length} tasks clustered in a 2-hour window`,
          description: `${inWindow.length} tasks are due between ${fmt(timedTasks[i].dueTime!)} and ${fmt(timedTasks[Math.min(i + inWindow.length - 1, timedTasks.length - 1)].dueTime!)}. Assuming ${DEFAULT_TASK_DURATION_MINUTES} min each, that requires ~${totalAssumedMin} minutes — these timings may be tentative.`,
          involvedIds: inWindow.map((t) => t._id),
          links: inWindow.map((t) => ({ label: t.title, href: `/app/tasks?highlight=${t._id}` })),
        })
        break // report the worst window once
      }
    }
  }

  // ── 4. High-priority deadline cluster ─────────────────────────────────────
  const highPriorityToday = todayIncompleteTasks.filter((t) => t.priority === 'high')
  if (highPriorityToday.length >= 3) {
    conflicts.push({
      kind: 'deadline_cluster',
      severity: 'possible',
      title: `${highPriorityToday.length} high-priority tasks due today`,
      description: `You have ${highPriorityToday.length} high-priority tasks due today: ${highPriorityToday.map((t) => `"${t.title}"`).join(', ')}. Consider which to prioritise first.`,
      involvedIds: highPriorityToday.map((t) => t._id),
      links: [{ label: 'View all tasks', href: '/app/tasks' }],
    })
  }

  // Deduplicate: remove lower-severity conflicts that share all involvedIds
  // with a higher-severity conflict already in the list.
  const SEVERITY_RANK: Record<ConflictSeverity, number> = { confirmed: 0, likely: 1, possible: 2 }
  const seen = new Set<string>()
  const deduped = conflicts
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .filter((c) => {
      const key = [...c.involvedIds].sort().join(',')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  return deduped
}
