'use client'

/**
 * NotificationDetailModal
 *
 * Shows the full details of a single scheduled-notification log entry:
 *   - TimeNotificationIcon with the scheduled local time
 *   - Notification type + label
 *   - Scheduled / Sent timestamps (user's local timezone)
 *   - Delivery status badge (Scheduled / Processing / Sent / Failed)
 *   - Channel (Email)
 *   - Recipient (masked registered email)
 *   - Email subject (what was sent)
 *   - Email body snapshot (what was actually sent — historical, not regenerated)
 *
 * SECURITY
 * ────────
 * Renders data returned by GET /api/notifications/history.
 * The API never returns errorMessage, SMTP credentials, or server secrets.
 * This component never constructs mailto: links or displays raw SMTP info.
 */

import { X, Mail, Clock, CheckCircle2, XCircle, Loader2, Calendar, AlertCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { TimeNotificationIcon } from '@/components/notifications/TimeNotificationIcon'
import { cn } from '@/lib/utils'
import type { NotificationHistoryEntry } from '@/types'

interface NotificationDetailModalProps {
  entry:   NotificationHistoryEntry | null
  onClose: () => void
  /** User's registered email (for masked display). Never passed to SMTP. */
  userEmail?: string
  /** User's IANA timezone, e.g. "Asia/Kolkata" */
  timezone?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mask email: user@example.com → u***@example.com */
function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '••••@••••'
  const [local, domain] = email.split('@')
  const visible = local.length > 2 ? local[0] + '•••' : '•••'
  return `${visible}@${domain}`
}

/** Format a UTC ISO string into a locale date+time string in the user's timezone. */
function formatTimestamp(isoString: string | null, timezone: string): string {
  if (!isoString) return '—'
  try {
    const dt = new Date(isoString)
    return new Intl.DateTimeFormat('en-GB', {
      timeZone:    timezone,
      day:         'numeric',
      month:       'long',
      year:        'numeric',
      hour:        '2-digit',
      minute:      '2-digit',
      hour12:      true,
    }).format(dt)
  } catch {
    return new Date(isoString).toLocaleString()
  }
}

/** Extract HH:MM and AM/PM from a UTC ISO string in the user's timezone. */
function extractTimeParts(isoString: string | null, timezone: string): { time: string; period: 'AM' | 'PM' } {
  if (!isoString) return { time: '--:--', period: 'AM' }
  try {
    const dt = new Date(isoString)
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour:     '2-digit',
      minute:   '2-digit',
      hour12:   true,
    }).formatToParts(dt)
    const h   = parts.find((p) => p.type === 'hour')?.value   ?? '00'
    const m   = parts.find((p) => p.type === 'minute')?.value ?? '00'
    const apm = (parts.find((p) => (p.type as string) === 'dayperiod')?.value ?? 'AM').toUpperCase() as 'AM' | 'PM'
    return { time: `${h}:${m}`, period: apm }
  } catch {
    return { time: '--:--', period: 'AM' }
  }
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
    pending: {
      icon:      <Clock size={11} />,
      label:     'Scheduled',
      className: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    },
    processing: {
      icon:      <Loader2 size={11} className="animate-spin" />,
      label:     'Processing',
      className: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    },
    sent_to_smtp: {
      icon:      <CheckCircle2 size={11} />,
      label:     'Sent',
      className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    },
    failed: {
      icon:      <XCircle size={11} />,
      label:     'Failed',
      className: 'bg-red-500/10 text-red-600 border-red-500/20',
    },
  }
  const cfg = configs[status] ?? configs.pending
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border', cfg.className)}>
      {cfg.icon}
      {cfg.label}
    </span>
  )
}

// ─── Detail row ───────────────────────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
        {label}
      </span>
      <div className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
        {children}
      </div>
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function NotificationDetailModal({
  entry,
  onClose,
  userEmail = '',
  timezone  = 'UTC',
}: NotificationDetailModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Escape key closes
  useEffect(() => {
    if (!entry) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handle)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', handle)
    }
  }, [entry, onClose])

  const { time, period } = extractTimeParts(entry?.scheduledAt ?? null, timezone)
  const scheduledLabel   = formatTimestamp(entry?.scheduledAt ?? null, timezone)
  const sentLabel        = formatTimestamp(entry?.sentAt      ?? null, timezone)

  return (
    <AnimatePresence>
      {entry && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-5">
          {/* Backdrop */}
          <motion.div
            ref={overlayRef}
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Notification detail: ${entry.typeLabel}`}
            className="glass-floating relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col"
            style={{
              boxShadow:    'var(--glass-shadow-xl)',
              maxHeight:    '90dvh',
            }}
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0, transition: { type: 'spring', damping: 26, stiffness: 340 } }}
            exit={{ opacity: 0, y: 24 }}
          >
            {/* Drag handle (mobile) */}
            <div className="sm:hidden flex justify-center pt-2.5 pb-1 flex-shrink-0">
              <div className="w-8 h-1 rounded-full" style={{ background: 'var(--border-strong)' }} />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-3 pb-0 flex-shrink-0">
              <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>
                Notification Details
              </h2>
              <button
                onClick={onClose}
                className="nav-hover p-1.5 rounded-lg transition-colors"
                aria-label="Close"
                style={{ color: 'var(--text-muted)' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="overflow-y-auto overscroll-contain flex-1 px-5 py-4 flex flex-col gap-5">

              {/* Icon + type header */}
              <div className="flex items-center gap-4">
                <TimeNotificationIcon
                  time={time}
                  period={period}
                  notificationType={entry.type}
                  status={entry.status}
                  size={76}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[16px] font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
                    {entry.typeLabel}
                  </p>
                  <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {time} {period} · {entry.forDate}
                  </p>
                  <div className="mt-1.5">
                    <StatusBadge status={entry.status} />
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="h-px" style={{ background: 'var(--border)' }} />

              {/* Timestamps + channel */}
              <div className="grid grid-cols-1 gap-3.5">
                <DetailRow label="Scheduled">
                  <span className="flex items-center gap-1.5">
                    <Calendar size={12} style={{ color: 'var(--text-faint)' }} />
                    {scheduledLabel}
                  </span>
                </DetailRow>

                <DetailRow label="Sent">
                  <span className="flex items-center gap-1.5">
                    {entry.sentAt ? (
                      <>
                        <CheckCircle2 size={12} className="text-emerald-500 flex-shrink-0" />
                        {sentLabel}
                      </>
                    ) : entry.status === 'failed' ? (
                      <>
                        <XCircle size={12} className="text-red-500 flex-shrink-0" />
                        <span style={{ color: 'var(--text-muted)' }}>Delivery failed</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>Not yet sent</span>
                    )}
                  </span>
                </DetailRow>

                <DetailRow label="Channel">
                  <span className="flex items-center gap-1.5">
                    <Mail size={12} style={{ color: 'var(--text-faint)' }} />
                    Email
                  </span>
                </DetailRow>

                {userEmail && (
                  <DetailRow label="Recipient">
                    <span className="font-mono text-[12px]">{maskEmail(userEmail)}</span>
                  </DetailRow>
                )}
              </div>

              {/* Email subject */}
              {entry.emailSubject && (
                <>
                  <div className="h-px" style={{ background: 'var(--border)' }} />
                  <DetailRow label="Subject">
                    <span className="font-medium">{entry.emailSubject}</span>
                  </DetailRow>
                </>
              )}

              {/* Email body snapshot */}
              {entry.emailBodySnapshot ? (
                <>
                  <div className="h-px" style={{ background: 'var(--border)' }} />
                  <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
                      Email Content
                    </span>
                    <div
                      className="rounded-xl p-3.5 text-[12px] leading-relaxed whitespace-pre-wrap font-mono"
                      style={{
                        background:  'var(--glass-subtle-bg)',
                        border:      '1px solid var(--border)',
                        color:       'var(--text-primary)',
                        maxHeight:   '260px',
                        overflowY:   'auto',
                      }}
                    >
                      {entry.emailBodySnapshot}
                    </div>
                    <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                      Snapshot captured at send time · historical record
                    </p>
                  </div>
                </>
              ) : (
                /* Content preview fallback for older records without snapshot */
                entry.contentPreview && (
                  <>
                    <div className="h-px" style={{ background: 'var(--border)' }} />
                    <DetailRow label="Summary">
                      <span style={{ color: 'var(--text-muted)' }}>{entry.contentPreview}</span>
                    </DetailRow>
                  </>
                )
              )}

              {/* Failed notice */}
              {entry.status === 'failed' && (
                <div
                  className="flex items-start gap-2.5 rounded-xl p-3.5"
                  style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}
                >
                  <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[12px] font-semibold text-red-600">Delivery failed</p>
                    <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      LifeFlow attempted to send this notification but delivery was unsuccessful.
                      The system will retry on the next scheduled run if still within the delivery window.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
