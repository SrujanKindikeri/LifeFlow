'use client'

/**
 * NotificationHistorySection
 *
 * Shows the user's scheduled-notification delivery history, sourced from
 * GET /api/notifications/history (NotificationLog collection).
 *
 * Features:
 *  - Filter tabs: All · Email · Tasks · Habits · Summary · Failed
 *  - Cards with TimeNotificationIcon showing the actual scheduled local time
 *  - Delivery status badge per card
 *  - Infinite-scroll "Load more" (25 records per page)
 *  - Click → NotificationDetailModal
 *  - Empty state when no history yet
 *
 * This component is intentionally self-contained so it can be dropped into
 * ProfileClient without changing any surrounding layout.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, Clock, Loader2, MailCheck, ChevronDown, RefreshCw } from 'lucide-react'
import { TimeNotificationIcon } from '@/components/notifications/TimeNotificationIcon'
import { NotificationDetailModal } from '@/components/notifications/NotificationDetailModal'
import { cn } from '@/lib/utils'
import type { NotificationHistoryEntry } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'email' | 'tasks' | 'habits' | 'summary' | 'failed'

interface NotificationHistorySectionProps {
  /** User's registered email for masked display in the detail modal */
  userEmail?: string
  /** User's IANA timezone, e.g. "Asia/Kolkata" */
  timezone?: string
}

const PAGE_SIZE = 25

// ─── Tab config ───────────────────────────────────────────────────────────────

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all',     label: 'All'     },
  { key: 'email',   label: 'Email'   },
  { key: 'tasks',   label: 'Tasks'   },
  { key: 'habits',  label: 'Habits'  },
  { key: 'summary', label: 'Summary' },
  { key: 'failed',  label: 'Failed'  },
]

/** Map UI filter tab → API query params */
function tabToParams(tab: FilterTab): Record<string, string> {
  switch (tab) {
    case 'email':   return { channel: 'email' }
    case 'tasks':   return { type: 'TASK_DUE_SOON' }   // main task type; others overlap
    case 'habits':  return { type: 'HABIT_REMINDER' }
    case 'summary': return { type: 'DAILY_SUMMARY' }
    case 'failed':  return { status: 'failed' }
    default:        return {}
  }
}

// ─── Time extraction ──────────────────────────────────────────────────────────

function extractTimeParts(
  isoString: string | null,
  timezone: string
): { time: string; period: 'AM' | 'PM' } {
  if (!isoString) return { time: '--:--', period: 'AM' }
  try {
    const dt    = new Date(isoString)
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour:     '2-digit',
      minute:   '2-digit',
      hour12:   true,
    }).formatToParts(dt)
    const h   = parts.find((p) => p.type === 'hour')?.value   ?? '00'
    const m   = parts.find((p) => p.type === 'minute')?.value ?? '00'
    const apm = (
      parts.find((p) => (p.type as string) === 'dayperiod')?.value ?? 'AM'
    ).toUpperCase() as 'AM' | 'PM'
    return { time: `${h}:${m}`, period: apm }
  } catch {
    return { time: '--:--', period: 'AM' }
  }
}

function formatLocalDate(isoString: string, timezone: string): string {
  try {
    const dt = new Date(isoString)
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      day:      'numeric',
      month:    'short',
      year:     'numeric',
    }).format(dt)
  } catch {
    return isoString.split('T')[0]
  }
}

// ─── Status badge (compact) ───────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  if (status === 'sent_to_smtp') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
        <CheckCircle2 size={10} />
        Email sent
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-500">
        <XCircle size={10} />
        Email failed
      </span>
    )
  }
  if (status === 'processing') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-500">
        <Loader2 size={10} className="animate-spin" />
        Processing
      </span>
    )
  }
  // pending / anything else
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: 'var(--text-faint)' }}>
      <Clock size={10} />
      Scheduled
    </span>
  )
}

// ─── Single history card ──────────────────────────────────────────────────────

function HistoryCard({
  entry,
  timezone,
  onClick,
}: {
  entry:    NotificationHistoryEntry
  timezone: string
  onClick:  (e: NotificationHistoryEntry) => void
}) {
  const { time, period } = extractTimeParts(entry.scheduledAt, timezone)
  const dateLabel        = formatLocalDate(entry.scheduledAt, timezone)

  return (
    <motion.button
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.18 }}
      onClick={() => onClick(entry)}
      className={cn(
        'w-full text-left glass rounded-xl flex items-center gap-3.5 px-3.5 py-3',
        'hover:bg-black/[0.025] active:bg-black/[0.04] transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40',
        entry.status === 'failed' && 'border-l-[3px] border-red-500',
        entry.status === 'sent_to_smtp' && 'border-l-[3px] border-emerald-500',
        (entry.status === 'pending' || entry.status === 'processing') &&
          'border-l-[3px] border-amber-400',
      )}
      aria-label={`${entry.typeLabel} — ${dateLabel} ${time} ${period} — ${entry.status}`}
    >
      {/* Time icon */}
      <div className="flex-shrink-0">
        <TimeNotificationIcon
          time={time}
          period={period}
          notificationType={entry.type}
          status={entry.status}
          size={56}
        />
      </div>

      {/* Text content */}
      <div className="flex-1 min-w-0">
        {/* Subject or type label */}
        <p className="text-[13px] font-semibold leading-snug truncate" style={{ color: 'var(--text-primary)' }}>
          {entry.emailSubject ?? entry.typeLabel}
        </p>

        {/* Type label (shown when subject is available, for context) */}
        {entry.emailSubject && (
          <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {entry.typeLabel}
          </p>
        )}

        {/* Date + time */}
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {dateLabel} · {time} {period}
        </p>

        {/* Status */}
        <div className="mt-1">
          <StatusPill status={entry.status} />
        </div>
      </div>

      {/* Chevron hint */}
      <ChevronDown
        size={13}
        className="-rotate-90 flex-shrink-0"
        style={{ color: 'var(--text-faint)' }}
      />
    </motion.button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NotificationHistorySection({
  userEmail = '',
  timezone  = 'UTC',
}: NotificationHistorySectionProps) {
  const [activeTab,   setActiveTab]   = useState<FilterTab>('all')
  const [entries,     setEntries]     = useState<NotificationHistoryEntry[]>([])
  const [total,       setTotal]       = useState(0)
  const [page,        setPage]        = useState(1)
  const [hasMore,     setHasMore]     = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [selected,    setSelected]    = useState<NotificationHistoryEntry | null>(null)

  // Track current fetch so stale responses from old tabs don't overwrite new ones
  const fetchIdRef = useRef(0)

  const fetchPage = useCallback(async (tab: FilterTab, pg: number, append: boolean) => {
    const fetchId = ++fetchIdRef.current
    if (!append) setLoading(true)
    else         setLoadingMore(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        page:  String(pg),
        limit: String(PAGE_SIZE),
        ...tabToParams(tab),
      })
      const res  = await fetch(`/api/notifications/history?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as {
        history: NotificationHistoryEntry[]
        total:   number
        hasMore: boolean
      }

      // Discard if a newer fetch has already started
      if (fetchId !== fetchIdRef.current) return

      setEntries((prev) => append ? [...prev, ...data.history] : data.history)
      setTotal(data.total)
      setHasMore(data.hasMore)
    } catch {
      if (fetchId !== fetchIdRef.current) return
      setError('Failed to load notification history')
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  // Initial + tab-change fetch
  useEffect(() => {
    setPage(1)
    setEntries([])
    void fetchPage(activeTab, 1, false)
  }, [activeTab, fetchPage])

  function handleLoadMore() {
    const nextPage = page + 1
    setPage(nextPage)
    void fetchPage(activeTab, nextPage, true)
  }

  function handleTabChange(tab: FilterTab) {
    if (tab === activeTab) return
    setActiveTab(tab)
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 glass rounded-xl w-fit flex-wrap">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-[11.5px] font-medium transition-all',
              activeTab === key
                ? 'glass-segment-active text-white'
                : 'hover:bg-black/[0.04]'
            )}
            style={activeTab === key ? {} : { color: 'var(--text-muted)' }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Count */}
      {!loading && (
        <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
          {total === 0
            ? 'No notifications yet'
            : `${total} notification${total !== 1 ? 's' : ''}${total > entries.length ? ` · showing ${entries.length}` : ''}`
          }
        </p>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="flex flex-col gap-2">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="glass rounded-xl h-[76px] animate-pulse"
              style={{ background: 'rgba(0,0,0,0.04)', opacity: 1 - i * 0.15 }}
            />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
          <p className="text-[12px] text-red-600">{error}</p>
          <button
            onClick={() => void fetchPage(activeTab, 1, false)}
            className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-600 transition-colors"
          >
            <RefreshCw size={11} />
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && entries.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <MailCheck size={28} style={{ color: 'var(--text-faint)' }} />
          <p className="text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>
            {activeTab === 'failed'
              ? 'No failed notifications'
              : 'No notification history yet'}
          </p>
          <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
            {activeTab === 'all'
              ? 'Once LifeFlow sends your scheduled emails, they will appear here.'
              : 'Try a different filter above.'}
          </p>
        </div>
      )}

      {/* History list */}
      {!loading && entries.length > 0 && (
        <motion.div layout className="flex flex-col gap-2">
          <AnimatePresence mode="popLayout">
            {entries.map((entry) => (
              <HistoryCard
                key={entry._id}
                entry={entry}
                timezone={timezone}
                onClick={setSelected}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Load more */}
      {hasMore && !loading && (
        <button
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-[12px] font-medium transition-colors hover:bg-black/[0.04] disabled:opacity-50"
          style={{ color: 'var(--text-muted)' }}
        >
          {loadingMore ? (
            <><Loader2 size={13} className="animate-spin" /> Loading…</>
          ) : (
            <>Load more</>
          )}
        </button>
      )}

      {/* Detail modal */}
      <NotificationDetailModal
        entry={selected}
        onClose={() => setSelected(null)}
        userEmail={userEmail}
        timezone={timezone}
      />
    </div>
  )
}
