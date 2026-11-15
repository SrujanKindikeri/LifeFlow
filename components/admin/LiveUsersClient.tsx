'use client'

/**
 * LiveUsersClient.tsx — Real-time active user sessions panel.
 *
 * Polls GET /api/admin/live-users every 30 seconds (configurable).
 * Shows active/idle sessions with device info, IP, last module, duration.
 *
 * Important caveats (shown in UI):
 *   • "Active" / "idle" are ESTIMATES based on the last heartbeat.
 *   • Browser closure, network loss, or device sleep can prevent
 *     immediate logout detection.
 *   • IP addresses are never proof of identity.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Monitor, Smartphone, Tablet, HelpCircle, RefreshCw, Wifi, WifiOff,
  Clock, Info, MapPin, Globe, Layers,
} from 'lucide-react'
import {
  AdminCard, SectionHeader, StatCard, ErrorState, LoadingSpinner,
  StatusBadge, EmptyState,
} from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SessionRow {
  publicId:           string
  name:               string
  email:              string
  accountStatus:      string
  sessionId:          string
  status:             'active' | 'idle' | 'expired'
  estimated:          boolean
  sessionStartedAt:   string | null
  lastSeenAt:         string | null
  lastModule:         string | null
  durationSeconds:    number
  browser:            string
  browserVersion:     string
  os:                 string
  osVersion:          string
  deviceCategory:     'desktop' | 'mobile' | 'tablet' | 'unknown'
  ip:                 string | null
  ipSource:           string
  approximateLocation: string | null
  sessionCountForUser: number
}

interface LiveUsersData {
  generatedAt: string
  thresholds:  { activeMinutes: number; recentMinutes: number; ttlHours: number }
  sessions:    SessionRow[]
  summary:     { totalSessions: number; activeCount: number; idleCount: number; expiredCount: number; uniqueUsers: number }
}

// ── Device icon ───────────────────────────────────────────────────────────────

function DeviceIcon({ category }: { category: string }) {
  const style = { color: 'var(--text-muted)', flexShrink: 0 } as const
  if (category === 'mobile')  return <Smartphone size={13} style={style} />
  if (category === 'tablet')  return <Tablet size={13} style={style} />
  if (category === 'desktop') return <Monitor size={13} style={style} />
  return <HelpCircle size={13} style={style} />
}

// ── Status pill ───────────────────────────────────────────────────────────────

function PresencePill({ status, estimated }: { status: string; estimated: boolean }) {
  const cfg = {
    active:     { bg: 'var(--success-dim)', text: 'var(--success-text)', dot: '#22c55e' },
    idle:       { bg: 'var(--warning-dim)', text: 'var(--warning-text)', dot: '#f59e0b' },
    expired:    { bg: 'rgba(0,0,0,0.06)',   text: 'var(--text-muted)',    dot: '#9ca3af' },
    revoked:    { bg: 'var(--danger-dim)',  text: 'var(--danger-text)',   dot: '#ef4444' },
    logged_out: { bg: 'rgba(0,0,0,0.06)',   text: 'var(--text-muted)',    dot: '#6b7280' },
  }[status] ?? { bg: 'rgba(0,0,0,0.06)', text: 'var(--text-muted)', dot: '#9ca3af' }

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: cfg.bg, color: cfg.text }}
      title={estimated ? 'Status is estimated based on last heartbeat' : 'Confirmed status'}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${status === 'active' ? 'animate-pulse' : ''}`}
        style={{ background: cfg.dot, flexShrink: 0 }}
      />
      {status}{estimated ? '*' : ''}
    </span>
  )
}

// ── Duration formatter ────────────────────────────────────────────────────────

function fmtDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '—'
  if (seconds < 60)   return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

// ── Session row ───────────────────────────────────────────────────────────────

function SessionCard({ session }: { session: SessionRow }) {
  const browserFull = session.browserVersion
    ? `${session.browser} ${session.browserVersion}`
    : session.browser
  const osFull = session.osVersion
    ? `${session.os} ${session.osVersion}`
    : session.os

  return (
    <div
      className="flex flex-col gap-2 px-4 py-3 rounded-xl transition-colors hover:brightness-105"
      style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)' }}
    >
      {/* Row 1: user + status */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
            style={{ background: 'var(--accent-dim)', color: 'var(--accent-text)' }}
            aria-hidden="true"
          >
            {session.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold truncate leading-none" style={{ color: 'var(--text-primary)' }}>
              {session.name}
            </p>
            <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {session.publicId}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <PresencePill status={session.status} estimated={session.estimated} />
          {session.sessionCountForUser > 1 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--info-dim)', color: 'var(--info)' }}>
              {session.sessionCountForUser} tabs
            </span>
          )}
        </div>
      </div>

      {/* Row 2: device + module + time */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          <DeviceIcon category={session.deviceCategory} />
          {browserFull} · {osFull}
        </span>
        {session.lastModule && (
          <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            <Layers size={11} />
            {session.lastModule}
          </span>
        )}
        <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <Clock size={11} />
          {fmtDuration(session.durationSeconds)}
        </span>
        {session.lastSeenAt && (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Last seen {formatRelativeTime(session.lastSeenAt)}
          </span>
        )}
      </div>

      {/* Row 3: IP + location */}
      {session.ip && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <Globe size={11} />
            {session.ip}
            <span className="text-[10px]">({session.ipSource})</span>
          </span>
          {session.approximateLocation && (
            <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <MapPin size={11} />
              {session.approximateLocation}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000

export function LiveUsersClient() {
  const [data, setData]         = useState<LiveUsersData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'idle'>('all')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/live-users?status=${statusFilter}&limit=200`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load live users')
      setData(json as LiveUsersData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load live users')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [statusFilter])

  useEffect(() => {
    void load()
    pollRef.current = setInterval(() => void load(true), POLL_INTERVAL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [load])

  const sessions = data?.sessions ?? []
  const summary  = data?.summary

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <SectionHeader
            title="Live User Sessions"
            subtitle={
              data
                ? `Updated ${formatRelativeTime(data.generatedAt)}`
                : 'Polling every 30 seconds'
            }
          />
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            * Active/idle status is <strong>estimated</strong> from last heartbeat.
            Browser closure or network loss may not be immediately detected.
          </p>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={refreshing || loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
          style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Active Now*"       value={summary?.activeCount   ?? '—'} icon={<Wifi size={16} />}    color="success" loading={loading} />
        <StatCard label="Idle*"             value={summary?.idleCount     ?? '—'} icon={<WifiOff size={16} />}  color="warning" loading={loading} />
        <StatCard label="Expired Sessions"  value={summary?.expiredCount  ?? '—'} icon={<Clock size={16} />}    loading={loading} />
        <StatCard label="Total Sessions"    value={summary?.totalSessions ?? '—'} icon={<Layers size={16} />}   loading={loading} />
        <StatCard label="Unique Users"      value={summary?.uniqueUsers   ?? '—'} icon={<Monitor size={16} />}  color="info" loading={loading} />
      </div>

      {/* Thresholds info */}
      {data && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2 text-[11px]"
          style={{ background: 'var(--info-dim)', border: '1px solid rgba(37,99,235,0.18)', color: 'var(--info)' }}
        >
          <Info size={13} className="shrink-0 mt-0.5" />
          <span>
            Active = heartbeat within <strong>{data.thresholds.activeMinutes}m</strong> ·
            Idle = within <strong>{data.thresholds.recentMinutes}m</strong> ·
            Sessions auto-expire after <strong>{data.thresholds.ttlHours}h</strong>
            <br />
            Configurable via <code>HEARTBEAT_ACTIVE_MINUTES</code>, <code>HEARTBEAT_RECENT_MINUTES</code>, <code>USER_SESSION_TTL_HOURS</code>
          </span>
        </div>
      )}

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'active', 'idle'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
            style={{
              background: statusFilter === f ? 'var(--accent)' : 'var(--glass-subtle-bg)',
              border: `1px solid ${statusFilter === f ? 'var(--accent)' : 'var(--border)'}`,
              color:  statusFilter === f ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Sessions list */}
      <AdminCard padding="sm">
        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner /></div>
        ) : error ? (
          <ErrorState message={error} />
        ) : sessions.length === 0 ? (
          <EmptyState message={
            statusFilter === 'all'
              ? 'No active sessions found. Sessions appear when users open any LifeFlow module.'
              : `No ${statusFilter} sessions found.`
          } />
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <SessionCard key={`${s.publicId}-${s.sessionId}`} session={s} />
            ))}
          </div>
        )}
      </AdminCard>
    </div>
  )
}
