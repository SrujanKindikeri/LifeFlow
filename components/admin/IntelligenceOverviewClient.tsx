'use client'

/**
 * IntelligenceOverviewClient.tsx — User Intelligence global dashboard.
 * All metrics from real DB aggregations. Definitions and time windows labeled.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Users, Monitor, Activity, TrendingUp, RefreshCw,
  Info, AlertTriangle,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts'
import {
  AdminCard, SectionHeader, StatCard, ErrorState, LoadingSpinner, EmptyState,
} from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OverviewData {
  generatedAt: string; days: number
  thresholds: { activeMinutes: number; recentMinutes: number }
  users: { total: number; active: number; deleted: number; emailVerified: number; newToday: number; newInWindow: number }
  sessions: { activeNow: number; recentlyActive: number; totalInWindow: number; uniqueUsersNow: number }
  engagement: {
    dau: number; wau: number; mau: number
    dailyTrend: { date: string; views: number; uniqueUsers: number }[]
    topSections: { section: string; views: number; uniqueUsers: number }[]
    moduleRanking: { module: string; totalOps: number; uniqueUsers: number; failures: number; errorRate: number }[]
  }
  reliability: {
    usersWithRepeatedErrors: { publicId: string; failureCount: number; modules: string[] }[]
    totalFailures: number
  }
  security: {
    loginFailures: { outcome: string; count: number; uniqueIps: number; lastOccurrence: string | null }[]
    recentEvents: { eventType: string; outcome: string; publicId: string | null; ip: string | null; deviceCategory: string; browser: string; timestamp: string }[]
    note: string
  }
  devices: {
    browserDistribution: { name: string; count: number }[]
    osDistribution: { name: string; count: number }[]
    deviceCategoryDistribution: { name: string; count: number }[]
  }
  review: {
    usersWithMultipleIps: { publicId: string; ipCount: number; ipList: string[] }[]
    note: string
  }
}

function fmtDate(d: string): string {
  try { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  catch { return d }
}

const DAYS_OPTIONS = [7, 14, 30, 90]

export function IntelligenceOverviewClient() {
  const [data, setData]         = useState<OverviewData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [days, setDays]         = useState(30)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/admin/intelligence/overview?days=${days}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setData(json as OverviewData)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false); setRefreshing(false) }
  }, [days])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SectionHeader title="User Intelligence Overview" subtitle={data ? `Updated ${formatRelativeTime(data.generatedAt)}` : 'Loading…'} />
        <div className="flex items-center gap-2">
          <select value={days} onChange={e => setDays(Number(e.target.value))}
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
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
      ) : error ? (
        <ErrorState message={error} />
      ) : !data ? null : (
        <>
          {/* User stats */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Users</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatCard label="Total Users"      value={data.users.total}          icon={<Users size={16} />}    color="default" />
              <StatCard label="Active Accounts"  value={data.users.active}         icon={<Users size={16} />}    color="success" />
              <StatCard label="New Today"        value={data.users.newToday}       icon={<TrendingUp size={16} />} color="info" />
              <StatCard label={`New (${days}d)`} value={data.users.newInWindow}    icon={<TrendingUp size={16} />} />
              <StatCard label="Deleted"          value={data.users.deleted}        icon={<Users size={16} />}    color={data.users.deleted > 0 ? 'warning' : 'default'} />
            </div>
          </div>

          {/* Session stats */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
              Sessions · Active = within {data.thresholds.activeMinutes}m · Idle = within {data.thresholds.recentMinutes}m
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Active Now*"      value={data.sessions.activeNow}      icon={<Monitor size={16} />}  color="success" />
              <StatCard label="Recently Active*" value={data.sessions.recentlyActive} icon={<Monitor size={16} />}  color="warning" />
              <StatCard label="Unique Users Online*" value={data.sessions.uniqueUsersNow} icon={<Users size={16} />}  color="info" />
              <StatCard label={`Sessions (${days}d)`} value={data.sessions.totalInWindow} icon={<Activity size={16} />} />
            </div>
            <p className="text-[10px] mt-1.5 ml-1" style={{ color: 'var(--text-muted)' }}>* Estimated from last heartbeat. Browser closure may not be immediately detected.</p>
          </div>

          {/* Engagement DAU/WAU/MAU */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
              Engagement · Section views (AnalyticsEvent, deduped per user/section/hour)
            </p>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="DAU (today)"   value={data.engagement.dau} icon={<Activity size={16} />} color="success" />
              <StatCard label="WAU (7d)"      value={data.engagement.wau} icon={<Activity size={16} />} color="info" />
              <StatCard label={`MAU (${days}d)`} value={data.engagement.mau} icon={<Activity size={16} />} />
            </div>
            {data.engagement.dau === 0 && data.engagement.wau === 0 && (
              <div className="flex items-start gap-2 mt-2 text-[11px] px-1" style={{ color: 'var(--info)' }}>
                <Info size={12} className="shrink-0 mt-0.5" />
                Section-view tracking (useSectionView hook) was not wired before this release.
                DAU/WAU/MAU will accumulate from now onwards.
              </div>
            )}
          </div>

          {/* Daily trend chart */}
          {data.engagement.dailyTrend.length > 0 && (
            <AdminCard>
              <SectionHeader title={`Daily Section Views (${days}d)`} subtitle="Each point = one deduped (user, section, hour) event" />
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={data.engagement.dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} width={28} />
              <Tooltip labelFormatter={(d: unknown) => fmtDate(String(d ?? ''))} formatter={(v: unknown) => [String(v ?? '')]} />
                  <Line type="monotone" dataKey="views" stroke="var(--accent)" dot={false} strokeWidth={2} name="Views" />
                  <Line type="monotone" dataKey="uniqueUsers" stroke="#10b981" dot={false} strokeWidth={1.5} strokeDasharray="4 2" name="Unique Users" />
                </LineChart>
              </ResponsiveContainer>
            </AdminCard>
          )}

          {/* Module ranking */}
          {data.engagement.moduleRanking.length > 0 && (
            <AdminCard>
              <SectionHeader title="Module Ranking" subtitle="By total operations (ModuleEvent, server-side instrumentation)" />
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.engagement.moduleRanking} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                  <YAxis dataKey="module" type="category" width={80} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <Tooltip formatter={(v: unknown) => [String(v ?? '')]} />
                  <Bar dataKey="totalOps" fill="var(--accent)" name="Total Ops" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="uniqueUsers" fill="#10b981" name="Unique Users" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </AdminCard>
          )}

          {/* Device distribution */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { title: 'Browser Distribution', data: data.devices.browserDistribution },
              { title: 'OS Distribution',      data: data.devices.osDistribution },
              { title: 'Device Categories',    data: data.devices.deviceCategoryDistribution },
            ].map(({ title, data: distData }) => (
              <AdminCard key={title} padding="sm">
                <SectionHeader title={title} />
                {distData.length === 0
                  ? <EmptyState message="No session data yet." />
                  : (
                    <div className="space-y-1.5">
                      {distData.slice(0, 6).map(({ name, count }) => (
                        <div key={name} className="flex items-center justify-between text-[12px]">
                          <span className="flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                            {name || 'Unknown'}
                          </span>
                          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{count}</span>
                        </div>
                      ))}
                    </div>
                  )
                }
              </AdminCard>
            ))}
          </div>

          {/* Reliability */}
          {data.reliability.usersWithRepeatedErrors.length > 0 && (
            <AdminCard>
              <SectionHeader title="Users with Repeated Errors (≥3 failures)"
                subtitle={`Total failures in window: ${data.reliability.totalFailures}`} />
              <div className="space-y-1.5">
                {data.reliability.usersWithRepeatedErrors.slice(0, 10).map(u => (
                  <div key={u.publicId} className="flex items-center justify-between text-[12px] py-1 border-b"
                    style={{ borderColor: 'var(--border)' }}>
                    <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{u.publicId}</span>
                    <span className="flex items-center gap-3">
                      <span style={{ color: 'var(--danger-text)' }}>{u.failureCount} failures</span>
                      <span style={{ color: 'var(--text-muted)' }}>{u.modules.join(', ')}</span>
                    </span>
                  </div>
                ))}
              </div>
            </AdminCard>
          )}

          {/* Security summary */}
          <AdminCard>
            <SectionHeader title="Security Summary" subtitle={data.security.note} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  Login Failures
                </p>
                {data.security.loginFailures.length === 0
                  ? <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>None recorded.</p>
                  : data.security.loginFailures.map(l => (
                    <div key={l.outcome} className="flex items-center justify-between text-[12px] py-1">
                      <span style={{ color: 'var(--text-secondary)' }}>Outcome: {l.outcome}</span>
                      <span className="flex items-center gap-2">
                        <span style={{ color: 'var(--danger-text)' }}>{l.count}×</span>
                        <span style={{ color: 'var(--text-muted)' }}>{l.uniqueIps} IPs</span>
                      </span>
                    </div>
                  ))
                }
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  Recent Security Events
                </p>
                {data.security.recentEvents.length === 0
                  ? <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>None.</p>
                  : (
                    <div className="space-y-1">
                      {data.security.recentEvents.slice(0, 5).map((e, i) => (
                        <div key={i} className="flex items-center justify-between text-[11px]">
                          <span className="capitalize" style={{ color: 'var(--text-secondary)' }}>
                            {e.eventType.replace(/_/g, ' ')} · {e.outcome}
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>{formatRelativeTime(e.timestamp)}</span>
                        </div>
                      ))}
                    </div>
                  )
                }
              </div>
            </div>
          </AdminCard>

          {/* Multi-IP review */}
          {data.review.usersWithMultipleIps.length > 0 && (
            <AdminCard>
              <SectionHeader title="Users with Multiple IPs (for review)" subtitle={data.review.note} />
              <div className="flex items-start gap-2 mb-3 text-[11px]" style={{ color: 'var(--warning-text)' }}>
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                This is normal for mobile users and VPN users. Not an indicator of compromise.
              </div>
              <div className="space-y-1">
                {data.review.usersWithMultipleIps.slice(0, 10).map(u => (
                  <div key={u.publicId} className="flex items-center justify-between text-[12px] py-1 border-b"
                    style={{ borderColor: 'var(--border)' }}>
                    <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{u.publicId}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{u.ipCount} distinct IPs</span>
                  </div>
                ))}
              </div>
            </AdminCard>
          )}
        </>
      )}
    </div>
  )
}
