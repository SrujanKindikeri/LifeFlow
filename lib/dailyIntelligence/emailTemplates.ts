/**
 * lib/dailyIntelligence/emailTemplates.ts
 *
 * HTML + plain-text email builders for the Daily Intelligence morning
 * briefing and evening review emails.
 *
 * Follows the same design conventions as lib/auth/email-templates.ts:
 * — Table-based layout for cross-client compatibility
 * — All CSS inlined; no external resources
 * — Plain-text fallback included
 * — No secrets, no AI-generated content logged
 *
 * SERVER-ONLY — never import from client components.
 */

import type { IBriefingContent } from '@/models/DailyBriefing'

// ─── Shared constants ─────────────────────────────────────────────────────────

const BRAND_NAME  = 'LifeFlow'
const BRAND_COLOR = '#2563eb'

// ─── Shared HTML helpers ──────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wrapHtml(innerHtml: string, preheader = ''): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${BRAND_NAME}</title>
  <style type="text/css">
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
    img{border:0;height:auto;line-height:100%;outline:none;text-decoration:none}
    a{color:inherit}
    @media only screen and (max-width:640px){
      .outer-wrap{padding:16px 0 24px!important}
      .email-card{border-radius:0!important;border-left:0!important;border-right:0!important}
      .email-body{padding:24px 20px 20px!important}
      .email-header{padding:24px 20px 18px!important}
      h1.heading{font-size:20px!important}
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       class="outer-wrap" style="background-color:#eef2f7;padding:40px 16px 48px;min-width:100%;">
  <tr><td align="center" valign="top">
    <table role="presentation" class="email-card" cellpadding="0" cellspacing="0" border="0"
           style="max-width:600px;width:100%;background:#fff;border-radius:20px;
                  border:1px solid #dce3ef;
                  box-shadow:0 2px 8px rgba(15,23,42,0.06),0 8px 32px rgba(15,23,42,0.05);
                  overflow:hidden;">

      <!-- Header -->
      <tr>
        <td class="email-header" style="padding:28px 40px 22px;border-bottom:1px solid #edf0f7;text-align:center;background:#fff;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
            <tr>
              <td style="background:${BRAND_COLOR};border-radius:12px;padding:8px 16px;display:inline-block;">
                <span style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
                             font-size:15px;font-weight:700;color:#fff;letter-spacing:-0.3px;">${BRAND_NAME}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td class="email-body" style="padding:32px 40px 28px;">
          ${innerHtml}
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding:16px 40px 24px;border-top:1px solid #edf0f7;text-align:center;">
          <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
                    font-size:12px;color:#94a3b8;line-height:1.5;">
            You're receiving this because Daily Intelligence is enabled on your account.<br/>
            <a href="__APP_URL__/app/profile" style="color:${BRAND_COLOR};text-decoration:none;">Manage preferences</a>
            &nbsp;&middot;&nbsp;
            <a href="__APP_URL__/app/daily-intelligence" style="color:${BRAND_COLOR};text-decoration:none;">View in app</a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}

function buildSection(title: string, emoji: string, items: string[], emptyMsg?: string): string {
  if (items.length === 0 && !emptyMsg) return ''
  const listItems = items.length > 0
    ? items.map((i) =>
        `<tr><td style="padding:6px 0 6px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
                        font-size:14px;color:#334155;line-height:1.5;border-left:2px solid #e2e8f0;">
           ${escapeHtml(i)}
         </td></tr>`
      ).join('')
    : `<tr><td style="padding:6px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
                      font-size:13px;color:#94a3b8;">${escapeHtml(emptyMsg ?? '')}</td></tr>`

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
      <tr>
        <td>
          <p style="margin:0 0 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
                    font-size:11px;font-weight:700;color:#64748b;letter-spacing:0.08em;text-transform:uppercase;">
            ${emoji} ${escapeHtml(title)}
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="background:#f8fafc;border-radius:10px;padding:12px 16px;border:1px solid #e2e8f0;">
            ${listItems}
          </table>
        </td>
      </tr>
    </table>`
}

function buildCta(label: string, url: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto 0;">
      <tr>
        <td style="background:${BRAND_COLOR};border-radius:10px;padding:12px 28px;text-align:center;">
          <a href="${url}" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
                                  font-size:14px;font-weight:600;color:#fff;text-decoration:none;
                                  display:block;white-space:nowrap;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`
}

// ─── Morning briefing ─────────────────────────────────────────────────────────

export interface MorningIntelligenceEmailOptions {
  toName: string
  todayLabel: string       // e.g. "Saturday, 17 Oct"
  content: IBriefingContent
  appUrl: string
}

export function buildMorningIntelligenceEmail(opts: MorningIntelligenceEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, todayLabel, content, appUrl } = opts
  const firstName = toName.split(' ')[0] ?? toName
  const subject   = `Your morning briefing — ${todayLabel}`

  // ── Top priorities ──────────────────────────────────────────────────────────
  const priorityItems = content.topPriorities.map((t) => {
    const parts = [t.title]
    if (t.priority === 'high') parts.push('⚡ High')
    if (t.dueTime) parts.push(`Due ${t.dueTime}`)
    return parts.join(' · ')
  })

  // ── Today's tasks ───────────────────────────────────────────────────────────
  const taskItems = content.todayTasks.slice(0, 8).map((t) => {
    const tag = t.priority === 'high' ? ' ⚡' : t.priority === 'low' ? ' ·' : ''
    return `${t.title}${tag}${t.dueTime ? ` — ${t.dueTime}` : ''}`
  })

  // ── Overdue tasks ───────────────────────────────────────────────────────────
  const overdueItems = content.overdueTasks.slice(0, 5).map((t) =>
    `${t.title} (${t.daysOverdue === 0 ? 'due today' : `${t.daysOverdue}d overdue`})`
  )

  // ── Habits ──────────────────────────────────────────────────────────────────
  const habitItems = content.todayHabits
    .filter((h) => !h.completedToday)
    .slice(0, 6)
    .map((h) => `${h.icon} ${h.name}`)

  // ── Projects/goals ──────────────────────────────────────────────────────────
  const projectItems = content.upcomingProjects.slice(0, 3).map((p) =>
    `${p.title}${p.dueDate ? ` — due ${p.dueDate}` : ''}`
  )

  // ── Financial ───────────────────────────────────────────────────────────────
  const financialItems = content.financialAlerts.slice(0, 4).map((a) => a.description)

  // ── Conflicts ───────────────────────────────────────────────────────────────
  const conflictItems = content.conflicts.slice(0, 3).map((c) => `⚠️ ${c.title}`)

  // ── Tomorrow priorities ─────────────────────────────────────────────────────
  const tomorrowItems = content.tomorrowPriorities.map((p) =>
    `${p.rank}. ${p.title} — ${p.reason}${p.confidence === 'tentative' ? ' (tentative)' : ''}`
  )

  const innerHtml = `
    <h1 class="heading" style="margin:0 0 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
                font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      Good morning, ${escapeHtml(firstName)} ☀️
    </h1>
    <p style="margin:0 0 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;">${escapeHtml(todayLabel)}</p>

    ${priorityItems.length > 0 ? buildSection("Today's Top Priorities", '🎯', priorityItems) : ''}
    ${taskItems.length > 0 ? buildSection("Tasks Due Today", '✅', taskItems) : ''}
    ${overdueItems.length > 0 ? buildSection('Overdue — Needs Attention', '🔴', overdueItems) : ''}
    ${habitItems.length > 0 ? buildSection('Habits to Complete', '🔥', habitItems) : ''}
    ${projectItems.length > 0 ? buildSection('Upcoming Project Deadlines', '📁', projectItems) : ''}
    ${financialItems.length > 0 ? buildSection('Financial Alerts', '💰', financialItems) : ''}
    ${conflictItems.length > 0 ? buildSection('Schedule Conflicts', '⚠️', conflictItems) : ''}
    ${tomorrowItems.length > 0 ? buildSection("Tomorrow's Plan", '📅', tomorrowItems) : ''}

    ${content.suggestedPlan.length > 0 ? `
    <p style="margin:20px 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
              font-size:11px;font-weight:700;color:#64748b;letter-spacing:0.08em;text-transform:uppercase;">
      💡 Suggested Plan
    </p>
    <div style="background:#f0f9ff;border-radius:10px;padding:16px;border:1px solid #bae6fd;">
      ${content.suggestedPlan.map((s) =>
        `<p style="margin:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
                   font-size:13px;color:#0369a1;line-height:1.5;">• ${escapeHtml(s)}</p>`
      ).join('')}
    </div>` : ''}

    ${buildCta('Open Daily Intelligence', `${appUrl}/app/daily-intelligence`)}
  `

  const html = wrapHtml(innerHtml, `${priorityItems.length} priorities · ${taskItems.length} tasks · ${habitItems.length} habits`)
    .replace(/__APP_URL__/g, appUrl)

  // ── Plain text ──────────────────────────────────────────────────────────────
  const lines: string[] = [
    `Good morning, ${firstName}`,
    todayLabel,
    '',
  ]

  if (priorityItems.length > 0) {
    lines.push("TODAY'S TOP PRIORITIES", ...priorityItems.map((i) => `  • ${i}`), '')
  }
  if (taskItems.length > 0) {
    lines.push('TASKS DUE TODAY', ...taskItems.map((i) => `  • ${i}`), '')
  }
  if (overdueItems.length > 0) {
    lines.push('OVERDUE', ...overdueItems.map((i) => `  ⚠ ${i}`), '')
  }
  if (habitItems.length > 0) {
    lines.push('HABITS', ...habitItems.map((i) => `  • ${i}`), '')
  }
  if (projectItems.length > 0) {
    lines.push('PROJECTS', ...projectItems.map((i) => `  • ${i}`), '')
  }
  if (financialItems.length > 0) {
    lines.push('FINANCIAL', ...financialItems.map((i) => `  • ${i}`), '')
  }
  if (conflictItems.length > 0) {
    lines.push('CONFLICTS', ...conflictItems.map((i) => `  ${i}`), '')
  }
  if (tomorrowItems.length > 0) {
    lines.push("TOMORROW'S PLAN", ...tomorrowItems.map((i) => `  ${i}`), '')
  }
  if (content.suggestedPlan.length > 0) {
    lines.push('SUGGESTED PLAN', ...content.suggestedPlan.map((s) => `  • ${s}`), '')
  }
  lines.push(`Open LifeFlow: ${appUrl}/app/daily-intelligence`)
  lines.push(`Manage preferences: ${appUrl}/app/profile`)

  return { subject, html, text: lines.join('\n') }
}

// ─── Evening review ───────────────────────────────────────────────────────────

export interface EveningIntelligenceEmailOptions {
  toName: string
  todayLabel: string
  content: IBriefingContent
  appUrl: string
}

export function buildEveningIntelligenceEmail(opts: EveningIntelligenceEmailOptions): {
  subject: string
  html: string
  text: string
} {
  const { toName, todayLabel, content, appUrl } = opts
  const firstName = toName.split(' ')[0] ?? toName

  const incompleteTodayCount = content.todayTasks.length
  const overdueCount = content.overdueTasks.length
  const incompleteHabitCount = content.habitsAtRisk.filter((h) => !h.completedToday).length

  const subject = incompleteTodayCount + overdueCount + incompleteHabitCount > 0
    ? `Evening review — ${incompleteTodayCount + overdueCount} items still open`
    : `Evening check-in — ${todayLabel}`

  const incompleteTaskItems = content.todayTasks.slice(0, 8).map((t) =>
    `${t.title}${t.priority === 'high' ? ' ⚡' : ''}`
  )
  const overdueItems = content.overdueTasks.slice(0, 5).map((t) =>
    `${t.title} (${t.daysOverdue}d overdue)`
  )
  const incompleteHabitItems = content.habitsAtRisk
    .filter((h) => !h.completedToday)
    .slice(0, 6)
    .map((h) => `${h.icon} ${h.name}${h.isOverdueWindow ? ' — running late!' : ''}`)

  const riskProjectItems = content.overdueProjects.slice(0, 3).map((p) =>
    `${p.title} (${p.daysOverdue}d past deadline)`
  )
  const tomorrowItems = content.tomorrowPriorities.map((p) =>
    `${p.rank}. ${p.title}${p.confidence === 'tentative' ? ' (tentative)' : ''}`
  )

  const innerHtml = `
    <h1 class="heading" style="margin:0 0 4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
                font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
      Evening review 🌙
    </h1>
    <p style="margin:0 0 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
              font-size:13px;color:#64748b;">Hi ${escapeHtml(firstName)} · ${escapeHtml(todayLabel)}</p>

    ${incompleteTaskItems.length > 0 ? buildSection('Incomplete Tasks Today', '📋', incompleteTaskItems) : ''}
    ${overdueItems.length > 0 ? buildSection('Overdue — Still Needs Attention', '🔴', overdueItems) : ''}
    ${incompleteHabitItems.length > 0 ? buildSection('Habits Not Yet Done', '🔥', incompleteHabitItems) : ''}
    ${riskProjectItems.length > 0 ? buildSection('Projects Past Deadline', '⚠️', riskProjectItems) : ''}
    ${tomorrowItems.length > 0 ? buildSection("Tomorrow's Priorities", '📅', tomorrowItems) : ''}

    ${content.suggestedPlan.length > 0 ? `
    <p style="margin:20px 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
              font-size:11px;font-weight:700;color:#64748b;letter-spacing:0.08em;text-transform:uppercase;">
      💡 Suggested Carry-Forwards
    </p>
    <div style="background:#fefce8;border-radius:10px;padding:16px;border:1px solid #fde68a;">
      ${content.suggestedPlan.map((s) =>
        `<p style="margin:0 0 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
                   font-size:13px;color:#92400e;line-height:1.5;">• ${escapeHtml(s)}</p>`
      ).join('')}
    </div>` : ''}

    ${buildCta('Plan Tomorrow', `${appUrl}/app/daily-intelligence`)}
  `

  const html = wrapHtml(innerHtml, `${incompleteTaskItems.length} incomplete · ${overdueCount} overdue`)
    .replace(/__APP_URL__/g, appUrl)

  const lines: string[] = [
    `Evening review — ${firstName}`,
    todayLabel,
    '',
  ]
  if (incompleteTaskItems.length > 0) {
    lines.push('INCOMPLETE TODAY', ...incompleteTaskItems.map((i) => `  • ${i}`), '')
  }
  if (overdueItems.length > 0) {
    lines.push('OVERDUE', ...overdueItems.map((i) => `  ⚠ ${i}`), '')
  }
  if (incompleteHabitItems.length > 0) {
    lines.push('HABITS NOT DONE', ...incompleteHabitItems.map((i) => `  • ${i}`), '')
  }
  if (riskProjectItems.length > 0) {
    lines.push('PROJECT RISKS', ...riskProjectItems.map((i) => `  • ${i}`), '')
  }
  if (tomorrowItems.length > 0) {
    lines.push("TOMORROW'S PRIORITIES", ...tomorrowItems.map((i) => `  ${i}`), '')
  }
  if (content.suggestedPlan.length > 0) {
    lines.push('CARRY FORWARDS', ...content.suggestedPlan.map((s) => `  • ${s}`), '')
  }
  lines.push(`Open LifeFlow: ${appUrl}/app/daily-intelligence`)
  lines.push(`Manage preferences: ${appUrl}/app/profile`)

  return { subject, html, text: lines.join('\n') }
}
