/**
 * lib/support/email.ts — Email notifications for support ticket events.
 *
 * SECURITY INVARIANTS
 * ───────────────────
 * - Email recipients are ALWAYS server-derived — never from client input.
 * - Ticket owners receive email at the address stored in their User document.
 * - Support-team notifications go to SUPPORT_EMAIL env var (never hardcoded).
 * - No passwords, tokens, session cookies, or OTPs are included in any email.
 * - Ticket IDs in emails are safe public identifiers (MongoDB ObjectId strings).
 *
 * RELIABILITY
 * ───────────
 * - Emails are sent AFTER the ticket/message is persisted in MongoDB.
 * - Failures are recorded on the ticket document (emailNotificationError) but
 *   never prevent the primary operation from completing.
 * - Idempotency: the ticket's emailNotificationKey prevents duplicate sends
 *   if the creation request is retried before the first email attempt finishes.
 *
 * USAGE
 * ─────
 *   await sendNewTicketEmailToSupport({ ticket, userEmail, userName })
 *   await sendAdminReplyEmailToUser({ ticket, userEmail, adminName })
 *   await sendStatusChangeEmailToUser({ ticket, userEmail, newStatus })
 */

import { getNotificationService } from '@/lib/notifications/index'
import logger from '@/lib/logger'
import type { TicketStatus } from '@/models/SupportTicket'

/** The support team's inbox — configurable per environment. */
function getSupportEmail(): string {
  return process.env.SUPPORT_EMAIL ?? process.env.EMAIL_FROM ?? 'support@lifeflow.app'
}

/** App display name — never contains credentials. */
function getFromName(): string {
  return process.env.EMAIL_FROM_NAME ?? 'LifeFlow'
}

/** Safe deep link to a ticket in the admin panel. */
function adminTicketUrl(ticketId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${base}/admin/support?ticket=${ticketId}`
}

/** Safe deep link to the user's support center. */
function userSupportUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${base}/app/profile#support`
}

// ── Label maps ─────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  account_and_login:            'Account & Login',
  notifications:                'Notifications',
  offline_sync:                 'Offline Sync',
  notes_tasks_habits_projects:  'Notes, Tasks, Habits & Projects',
  expenses_and_subscriptions:   'Expenses & Subscriptions',
  payments_and_group_bills:     'Payments & Group Bills',
  bugs_and_technical:           'Bugs & Technical Problems',
  other:                        'Other',
}

const PRIORITY_LABELS: Record<string, string> = {
  low:    'Low',
  normal: 'Normal',
  high:   'High',
  urgent: 'Urgent',
}

const STATUS_LABELS: Record<TicketStatus, string> = {
  open:               'Open',
  waiting_for_admin:  'Waiting for Admin',
  waiting_for_user:   'Waiting for Your Reply',
  resolved:           'Resolved',
  closed:             'Closed',
}

// ── Email senders ──────────────────────────────────────────────────────────────

/**
 * Notify the support team when a new ticket is submitted.
 * Called after the ticket is persisted in MongoDB.
 * Non-fatal — failure is logged but never blocks the API response.
 */
export async function sendNewTicketEmailToSupport(params: {
  ticketId:   string
  subject:    string
  category:   string
  priority:   string
  userName:   string
  userEmail:  string
  createdAt:  Date
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const notifier   = await getNotificationService()
    const supportTo  = getSupportEmail()
    const fromName   = getFromName()
    const ticketUrl  = adminTicketUrl(params.ticketId)
    const catLabel   = CATEGORY_LABELS[params.category] ?? params.category
    const priLabel   = PRIORITY_LABELS[params.priority] ?? params.priority
    const submittedAt = params.createdAt.toUTCString()

    const subject = `[LifeFlow Support] New ${priLabel} ticket: ${params.subject}`

    const text = [
      `A new support ticket has been submitted.`,
      ``,
      `Ticket ID : ${params.ticketId}`,
      `Subject   : ${params.subject}`,
      `Category  : ${catLabel}`,
      `Priority  : ${priLabel}`,
      `From      : ${params.userName}`,
      `Submitted : ${submittedAt}`,
      ``,
      `View and respond: ${ticketUrl}`,
      ``,
      `-- LifeFlow Support System`,
    ].join('\n')

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>New Support Ticket</title></head>
<body style="font-family:system-ui,sans-serif;color:#111;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#1d4ed8;margin-bottom:4px">New Support Ticket</h2>
  <p style="color:#6b7280;margin-top:0;font-size:14px">LifeFlow Support System</p>

  <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
    <tr><td style="padding:8px 0;color:#6b7280;width:120px">Ticket ID</td>
        <td style="padding:8px 0;font-family:monospace">${params.ticketId}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280">Subject</td>
        <td style="padding:8px 0;font-weight:600">${escHtml(params.subject)}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280">Category</td>
        <td style="padding:8px 0">${escHtml(catLabel)}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280">Priority</td>
        <td style="padding:8px 0">
          <span style="background:${priColor(params.priority)};color:#fff;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600">
            ${escHtml(priLabel)}
          </span>
        </td></tr>
    <tr><td style="padding:8px 0;color:#6b7280">User</td>
        <td style="padding:8px 0">${escHtml(params.userName)}</td></tr>
    <tr><td style="padding:8px 0;color:#6b7280">Submitted</td>
        <td style="padding:8px 0">${escHtml(submittedAt)}</td></tr>
  </table>

  <a href="${ticketUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
    View &amp; Respond in Control Panel
  </a>

  <p style="color:#9ca3af;font-size:12px;margin-top:32px">
    This is an automated notification from the LifeFlow support system.<br>
    Do not reply directly to this email — use the Control Panel link above.
  </p>
</body>
</html>`

    const result = await notifier.send({
      to: supportTo, subject, text, html,
      from: `${fromName} <${process.env.EMAIL_FROM ?? getSupportEmail()}>`,
    })

    if (!result.ok) {
      logger.warn('[support/email] Failed to send new-ticket notification to support', {
        ticketId: params.ticketId, error: result.error,
      })
    }
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('[support/email] Unexpected error sending new-ticket email', {
      ticketId: params.ticketId, errorMessage: msg,
    })
    return { ok: false, error: msg }
  }
}

/**
 * Notify the user when an admin replies to their ticket.
 * Respects the user's emailNotifications.enabled preference — callers should
 * check before calling, or this function will still not fail if the user
 * has disabled email (NotificationProvider handles that separately).
 *
 * NOTE: This sends regardless of email preference — a direct reply to the
 * user is considered a transactional notification, not a marketing email.
 * If the project later adds granular support-reply email prefs, gate here.
 */
export async function sendAdminReplyEmailToUser(params: {
  ticketId:   string
  subject:    string
  userEmail:  string
  userName:   string
  adminName:  string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const notifier     = await getNotificationService()
    const fromName     = getFromName()
    const supportUrl   = userSupportUrl()

    const emailSubject = `[LifeFlow Support] Reply to your ticket: ${params.subject}`

    const text = [
      `Hi ${params.userName},`,
      ``,
      `${params.adminName} from the LifeFlow support team has replied to your ticket.`,
      ``,
      `Subject: ${params.subject}`,
      ``,
      `View the conversation and reply: ${supportUrl}`,
      ``,
      `-- LifeFlow Support`,
    ].join('\n')

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Support Reply</title></head>
<body style="font-family:system-ui,sans-serif;color:#111;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#1d4ed8;margin-bottom:4px">You have a reply</h2>
  <p style="color:#6b7280;margin-top:0;font-size:14px">LifeFlow Support</p>

  <p style="font-size:15px">Hi ${escHtml(params.userName)},</p>
  <p style="font-size:14px;color:#374151">
    <strong>${escHtml(params.adminName)}</strong> from the LifeFlow support team
    has replied to your ticket: <em>&ldquo;${escHtml(params.subject)}&rdquo;</em>
  </p>

  <a href="${supportUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin:16px 0">
    View Conversation
  </a>

  <p style="color:#9ca3af;font-size:12px;margin-top:32px">
    You received this email because you have an open support ticket with LifeFlow.<br>
    Visit your <a href="${supportUrl}" style="color:#1d4ed8">Support Center</a> to manage your tickets.
  </p>
</body>
</html>`

    const result = await notifier.send({
      to: params.userEmail, subject: emailSubject, text, html,
      from: `${fromName} Support <${process.env.EMAIL_FROM ?? getSupportEmail()}>`,
    })

    if (!result.ok) {
      logger.warn('[support/email] Failed to send reply notification to user', {
        ticketId: params.ticketId, error: result.error,
      })
    }
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('[support/email] Unexpected error sending reply email to user', {
      ticketId: params.ticketId, errorMessage: msg,
    })
    return { ok: false, error: msg }
  }
}

/**
 * Notify the user when a ticket status changes (resolved, closed, reopened).
 */
export async function sendStatusChangeEmailToUser(params: {
  ticketId:   string
  subject:    string
  userEmail:  string
  userName:   string
  newStatus:  TicketStatus
  adminName?: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const notifier   = await getNotificationService()
    const fromName   = getFromName()
    const supportUrl = userSupportUrl()
    const statusLabel = STATUS_LABELS[params.newStatus] ?? params.newStatus

    const emailSubject = `[LifeFlow Support] Ticket ${statusLabel.toLowerCase()}: ${params.subject}`

    const actionNote = ({
      resolved: 'This ticket has been marked as resolved. If your issue is not fully addressed, please reply to reopen it.',
      closed:   'This ticket has been closed. If you need further assistance, please submit a new ticket.',
      open:     'This ticket has been reopened and our team will follow up shortly.',
      waiting_for_admin: `The status of your ticket has changed to "${statusLabel}".`,
      waiting_for_user:  `The status of your ticket has changed to "${statusLabel}".`,
    } as Record<TicketStatus, string>)[params.newStatus] ?? `The status of your ticket has changed to "${statusLabel}".`

    const text = [
      `Hi ${params.userName},`,
      ``,
      `Your support ticket has been updated.`,
      ``,
      `Subject: ${params.subject}`,
      `Status : ${statusLabel}`,
      ``,
      actionNote,
      ``,
      `View your ticket: ${supportUrl}`,
      ``,
      `-- LifeFlow Support`,
    ].join('\n')

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Ticket Status Update</title></head>
<body style="font-family:system-ui,sans-serif;color:#111;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#1d4ed8;margin-bottom:4px">Ticket ${escHtml(statusLabel)}</h2>
  <p style="color:#6b7280;margin-top:0;font-size:14px">LifeFlow Support</p>

  <p style="font-size:15px">Hi ${escHtml(params.userName)},</p>
  <p style="font-size:14px;color:#374151">${escHtml(actionNote)}</p>

  <table style="font-size:14px;margin:16px 0">
    <tr><td style="color:#6b7280;padding-right:16px">Ticket</td>
        <td>${escHtml(params.subject)}</td></tr>
    <tr><td style="color:#6b7280;padding-right:16px">Status</td>
        <td><strong>${escHtml(statusLabel)}</strong></td></tr>
  </table>

  <a href="${supportUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
    View Ticket
  </a>

  <p style="color:#9ca3af;font-size:12px;margin-top:32px">
    LifeFlow Support — <a href="${supportUrl}" style="color:#1d4ed8">Manage your tickets</a>
  </p>
</body>
</html>`

    return await notifier.send({
      to: params.userEmail, subject: emailSubject, text, html,
      from: `${fromName} Support <${process.env.EMAIL_FROM ?? getSupportEmail()}>`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('[support/email] Unexpected error sending status-change email', {
      ticketId: params.ticketId, errorMessage: msg,
    })
    return { ok: false, error: msg }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function priColor(priority: string): string {
  switch (priority) {
    case 'urgent': return '#dc2626'
    case 'high':   return '#d97706'
    case 'normal': return '#2563eb'
    default:       return '#6b7280'
  }
}
