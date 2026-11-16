'use client'

/**
 * SessionsClient.tsx — Searchable, filterable session table with device intelligence.
 * Fetches from GET /api/admin/sessions with full pagination and filter support.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Monitor, Smartphone, Tablet, HelpCircle, Search, RefreshCw,
  Globe, ShieldOff, Layers, AlertTriangle,
} from 'lucide-react'
import {
  AdminCard, SectionHeader, ErrorState, LoadingSpinner,
  EmptyState, Pagination,
} from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Session {
  sessionId: string; publicId: string; name: string; email: string
  accountStatus: string; status: string; estimated: boolean
  sessionStartedAt: string | null; lastSeenAt: string | null; lastModule: string | null
  browser: string; browserVersion: string; os: string; osVersion: string
  deviceCategory: string; ip: string | null; ipSource: string
  approximateLocation: string | null
  revokedAt: string | null; revokedBy: string | null; revokeReason: string | null
  loggedOutAt: string | null
}

interface SessionsData { items: Session[]; total: number; page: number; limit: number; hasMore: boolean }

// ── Helpers ───────────────────────────────────────────────────────────────────

function DeviceIcon({ cat }: { cat: string }) {
  const s = { color: 'var(--text-muted)', flexShrink: 0 } as const
  if (cat === 'mobile')  return <Smartphone size={12} style={s} />
  if (cat === 'tablet')  return <Tablet size={12} style={s} />
  if (cat === 'desktop') return <Monitor size={12} style={s} />
  return <HelpCircle size={12} style={s} />
}

function PresenceDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: '#22c55e', idle: '#f59e0b', expired: '#9ca3af',
    revoked: '#ef4444', logged_out: '#6b7280',
  }
  const label = status.replace('_', ' ')
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-medium capitalize"
      style={{ color: 'var(--text-secondary)' }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: colors[status] ?? '#9ca3af' }} />
      {label}{status !== 'revoked' && status !== 'logged_out' && <span style={{ color: 'var(--text-muted)' }}>*</span>}
    </span>
  )
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  const secs = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)
  if (secs < 0) return '—'
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  return `${(secs / 3600).toFixed(1)}h`
}

// ── Row ───────────────────────────────────────────────────────────────────────

function SessionRow({ session, onRevoke }: { session: Session; onRevoke: (s: Session) => void }) {
  const canRevoke = session.status !== 'revoked' && session.status !== 'logged_out'
  return (
    <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
      <td className="py-2 px-3">
        <div>
          <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>{session.name}</p>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{session.publicId}</p>
        </div>
      </td>
      <td className="py-2 px-3">
        <PresenceDot status={session.status} />
      </td>
      <td className="py-2 px-3">
        <div className="flex items-center gap-1">
          <DeviceIcon cat={session.deviceCategory} />
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {session.browser} · {session.os}
          </span>
        </div>
      </td>
      <td className="py-2 px-3">
        {session.ip
          ? <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <Globe size={11} />{session.ip}
            </span>
          : <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</span>
        }
      </td>
      <td className="py-2 px-3">
        {session.lastModule
          ? <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              <Layers size={11} />{session.lastModule}
            </span>
          : <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</span>
        }
      </td>
      <td className="py-2 px-3">
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          <div>{fmtDuration(session.sessionStartedAt, session.lastSeenAt)}</div>
          <div>{session.lastSeenAt ? formatRelativeTime(session.lastSeenAt) : '—'}</div>
        </div>
      </td>
      <td className="py-2 px-3">
        {canRevoke && (
          <button
            onClick={() => onRevoke(session)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors hover:brightness-110"
            style={{ background: 'var(--danger-dim)', color: 'var(--danger-text)', border: '1px solid rgba(220,38,38,0.2)' }}
          >
            <ShieldOff size={11} />Revoke
          </button>
        )}
        {session.status === 'revoked' && (
          <span className="text-[11px]" style={{ color: 'var(--danger-text)' }}>
            Revoked {session.revokedAt ? formatRelativeTime(session.revokedAt) : ''}
          </span>
        )}
      </td>
    </tr>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

const DEVICE_CATEGORIES = ['', 'desktop', 'mobile', 'tablet', 'unknown']
const STATUSES = ['', 'active', 'idle', 'expired', 'revoked', 'logged_out']
const DAYS_OPTIONS = [7, 14, 30, 90]

export function SessionsClient() {
  const [data, setData]         = useState<SessionsData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [page, setPage]         = useState(1)
  const [days, setDays]         = useState(30)
  const [userSearch, setUserSearch] = useState('')
  const [ipSearch, setIpSearch]   = useState('')
  const [deviceFilter, setDeviceFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<Session | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [revokeReason, setRevokeReason] = useState('')

  const buildUrl = useCallback(() => {
    const p = new URLSearchParams()
    p.set('page', String(page)); p.set('limit', '25'); p.set('days', String(days))
    if (userSearch) p.set('user', userSearch)
    if (ipSearch)   p.set('ip', ipSearch)
    if (deviceFilter) p.set('device', deviceFilter)
    if (statusFilter) p.set('status', statusFilter)
    return `/api/admin/sessions?${p.toString()}`
  }, [page, days, userSearch, ipSearch, deviceFilter, statusFilter])

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const res = await fetch(buildUrl())
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setData(json as SessionsData)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false); setRefreshing(false) }
  }, [buildUrl])

  useEffect(() => { void load() }, [load])

  const handleSearchChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value)
    setPage(1)
  }

  const handleRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    try {
      const res = await fetch('/api/admin/sessions/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicId: revokeTarget.publicId, sessionId: revokeTarget.sessionId, reason: revokeReason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Revocation failed')
      setRevokeTarget(null)
      setRevokeReason('')
      void load(true)
    } catch (e) { setError(e instanceof Error ? e.message : 'Revocation failed') }
    finally { setRevoking(false) }
  }

  const items = data?.items ?? []

  return (
    <div className="space-y-5">
      <SectionHeader title="Sessions & Devices" subtitle="All recorded user sessions with device intelligence" />

      {/* Filters */}
      <AdminCard padding="sm">
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[180px]"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 10px' }}>
            <Search size={13} style={{ color: 'var(--text-muted)' }} />
            <input placeholder="Search user…" value={userSearch} onChange={handleSearchChange(setUserSearch)}
              className="flex-1 bg-transparent text-[12px] outline-none" style={{ color: 'var(--text-primary)' }} />
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-[140px]"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 10px' }}>
            <Globe size={13} style={{ color: 'var(--text-muted)' }} />
            <input placeholder="Filter IP…" value={ipSearch} onChange={handleSearchChange(setIpSearch)}
              className="flex-1 bg-transparent text-[12px] outline-none" style={{ color: 'var(--text-primary)' }} />
          </div>
          <select value={deviceFilter} onChange={e => { setDeviceFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 rounded-xl text-[12px] outline-none"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            {DEVICE_CATEGORIES.map(d => <option key={d} value={d}>{d || 'All devices'}</option>)}
          </select>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 rounded-xl text-[12px] outline-none"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            {STATUSES.map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
          <select value={days} onChange={e => { setDays(Number(e.target.value)); setPage(1) }}
            className="px-3 py-2 rounded-xl text-[12px] outline-none"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            {DAYS_OPTIONS.map(d => <option key={d} value={d}>Last {d}d</option>)}
          </select>
          <button onClick={() => void load(true)} disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />Refresh
          </button>
        </div>
      </AdminCard>

      {/* Disclaimer */}
      <div className="flex items-start gap-2 text-[11px] px-1" style={{ color: 'var(--text-muted)' }}>
        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
        * Active/idle status estimated from heartbeat. IP addresses are never proof of identity.
      </div>

      {/* Table */}
      <AdminCard padding="sm">
        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner /></div>
        ) : error ? (
          <ErrorState message={error} />
        ) : items.length === 0 ? (
          <EmptyState message="No sessions match the current filters." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                    {['User', 'Status', 'Device', 'IP', 'Last Module', 'Duration / Seen', 'Action'].map(h => (
                      <th key={h} className="py-2 px-3 text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map(s => (
                    <SessionRow key={`${s.publicId}-${s.sessionId}`} session={s} onRevoke={setRevokeTarget} />
                  ))}
                </tbody>
              </table>
            </div>
            {data && (
              <Pagination page={data.page} hasMore={data.hasMore} total={data.total} limit={data.limit}
                onPrev={() => setPage(p => p - 1)} onNext={() => setPage(p => p + 1)} />
            )}
          </>
        )}
      </AdminCard>

      {/* Revoke confirm dialog */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => { setRevokeTarget(null); setRevokeReason('') }} />
          <div className="relative glass-floating rounded-2xl p-6 w-full max-w-sm space-y-4"
            style={{ boxShadow: 'var(--glass-shadow-lg)' }}>
            <h3 className="text-[16px] font-bold" style={{ color: 'var(--text-primary)' }}>
              Revoke Session
            </h3>
            <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
              Revoke session for <strong>{revokeTarget.name}</strong>?
              The session will stop heartbeating and expire naturally.
            </p>
            <div>
              <label className="text-[11px] font-medium mb-1 block" style={{ color: 'var(--text-muted)' }}>
                Reason (optional)
              </label>
              <input
                value={revokeReason}
                onChange={e => setRevokeReason(e.target.value)}
                maxLength={500}
                placeholder="e.g. Suspicious activity review"
                className="w-full px-3 py-2 rounded-xl text-[13px] outline-none"
                style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setRevokeTarget(null); setRevokeReason('') }} disabled={revoking}
                className="px-4 py-2 rounded-xl text-[13px] font-medium" style={{ color: 'var(--text-muted)' }}>
                Cancel
              </button>
              <button onClick={() => void handleRevoke()} disabled={revoking}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--danger)' }}>
                {revoking ? 'Revoking…' : 'Revoke Session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
