'use client'

/**
 * SecurityAuditClient.tsx — Login & security event log.
 * Shows login successes/failures, logouts, session revocations, 2FA changes.
 */

import { useCallback, useEffect, useState } from 'react'
import { Shield, RefreshCw, Search, Info, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import {
  AdminCard, SectionHeader, ErrorState, LoadingSpinner, EmptyState, Pagination, StatCard,
} from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'

interface SecurityEventRow {
  id: string; eventType: string; outcome: string; publicId: string | null
  ip: string | null; deviceCategory: string; browser: string
  metadata: Record<string, unknown>; createdAt: string
}

interface SecurityData {
  items: SecurityEventRow[]; total: number; page: number; limit: number; hasMore: boolean
  summary: Record<string, number>
  eventTypes: string[]
}

const EVENT_LABELS: Record<string, string> = {
  login_success: 'Login Success', login_failure: 'Login Failure',
  logout: 'Logout', session_expired: 'Session Expired', session_revoked: 'Session Revoked',
  two_factor_enabled: '2FA Enabled', two_factor_disabled: '2FA Disabled',
  two_factor_challenge_failed: '2FA Challenge Failed',
  password_changed: 'Password Changed', password_reset_requested: 'Password Reset Requested',
  password_reset_completed: 'Password Reset Completed',
  account_deleted: 'Account Deleted', account_restored: 'Account Restored',
  permission_denied: 'Permission Denied',
}

function OutcomeIcon({ outcome }: { outcome: string }) {
  if (outcome === 'success') return <CheckCircle size={13} style={{ color: 'var(--success)' }} />
  if (outcome === 'failure') return <XCircle size={13} style={{ color: 'var(--danger)' }} />
  return <AlertTriangle size={13} style={{ color: 'var(--warning)' }} />
}

export function SecurityAuditClient() {
  const [data, setData]       = useState<SecurityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [page, setPage]       = useState(1)
  const [days, setDays]       = useState(30)
  const [typeFilter, setTypeFilter] = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState('')
  const [userSearch, setUserSearch] = useState('')

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({ page: String(page), limit: '25', days: String(days) })
      if (typeFilter) p.set('type', typeFilter)
      if (outcomeFilter) p.set('outcome', outcomeFilter)
      if (userSearch) p.set('user', userSearch)
      const res  = await fetch(`/api/admin/security-events?${p}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setData(json as SecurityData)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false); setRefreshing(false) }
  }, [page, days, typeFilter, outcomeFilter, userSearch])

  useEffect(() => { void load() }, [load])

  const items = data?.items ?? []
  const summary = data?.summary ?? {}

  return (
    <div className="space-y-5">
      <SectionHeader title="Login & Security Audit" subtitle="Security events from real database records. No events are fabricated." />

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Login Successes" value={summary['login_success'] ?? 0} icon={<CheckCircle size={16} />} color="success" loading={loading} />
        <StatCard label="Login Failures"  value={summary['login_failure'] ?? 0} icon={<XCircle size={16} />} color="danger" loading={loading} />
        <StatCard label="Logouts"         value={summary['logout'] ?? 0} icon={<Shield size={16} />} loading={loading} />
        <StatCard label="Sessions Revoked" value={summary['session_revoked'] ?? 0} icon={<AlertTriangle size={16} />} color="warning" loading={loading} />
      </div>

      {/* Retention notice */}
      <div className="flex items-start gap-2 text-[11px] px-1" style={{ color: 'var(--text-muted)' }}>
        <Info size={12} className="shrink-0 mt-0.5" />
        Security events are retained for {parseInt(process.env.NEXT_PUBLIC_SECURITY_EVENT_RETENTION_DAYS ?? '90')} days (configurable via <code>SECURITY_EVENT_RETENTION_DAYS</code>).
        Passwords, tokens, and session cookies are never stored.
      </div>

      {/* Filters */}
      <AdminCard padding="sm">
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[150px]"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 10px' }}>
            <Search size={13} style={{ color: 'var(--text-muted)' }} />
            <input placeholder="Filter by publicId…" value={userSearch}
              onChange={e => { setUserSearch(e.target.value); setPage(1) }}
              className="flex-1 bg-transparent text-[12px] outline-none" style={{ color: 'var(--text-primary)' }} />
          </div>
          <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 rounded-xl text-[12px] outline-none"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <option value="">All event types</option>
            {(data?.eventTypes ?? Object.keys(EVENT_LABELS)).map(t => (
              <option key={t} value={t}>{EVENT_LABELS[t] ?? t}</option>
            ))}
          </select>
          <select value={outcomeFilter} onChange={e => { setOutcomeFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 rounded-xl text-[12px] outline-none"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <option value="">All outcomes</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="denied">Denied</option>
          </select>
          <select value={days} onChange={e => { setDays(Number(e.target.value)); setPage(1) }}
            className="px-3 py-2 rounded-xl text-[12px] outline-none"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            {[7, 14, 30, 90].map(d => <option key={d} value={d}>Last {d}d</option>)}
          </select>
          <button onClick={() => void load(true)} disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />Refresh
          </button>
        </div>
      </AdminCard>

      {/* Events table */}
      <AdminCard padding="sm">
        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner /></div>
        ) : error ? (
          <ErrorState message={error} />
        ) : items.length === 0 ? (
          <EmptyState message="No security events found. Events are recorded on login, logout, and session changes." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                    {['Event', 'Outcome', 'User', 'IP', 'Device', 'Time'].map(h => (
                      <th key={h} className="py-2 px-3 text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map(e => (
                    <tr key={e.id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                      <td className="py-2 px-3">
                        <span className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                          {EVENT_LABELS[e.eventType] ?? e.eventType.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className="flex items-center gap-1.5">
                          <OutcomeIcon outcome={e.outcome} />
                          <span className="text-[11px] capitalize" style={{ color: 'var(--text-secondary)' }}>{e.outcome}</span>
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                          {e.publicId ?? 'unknown'}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                          {e.ip ?? '—'}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className="text-[11px] capitalize" style={{ color: 'var(--text-muted)' }}>
                          {e.browser} · {e.deviceCategory}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {formatRelativeTime(e.createdAt)}
                        </span>
                      </td>
                    </tr>
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
    </div>
  )
}
