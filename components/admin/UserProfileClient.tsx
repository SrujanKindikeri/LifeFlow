'use client'

/**
 * UserProfileClient.tsx — Detailed per-user intelligence view.
 * Shows account info, sessions, login history, module usage, reliability, timeline.
 * Administrators see activity METADATA only — never private note/task content.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Monitor, Smartphone, Tablet, Globe, CheckCircle, XCircle,
  RefreshCw, Layers, Shield,
  HelpCircle,
} from 'lucide-react'
import {
  AdminCard, SectionHeader, StatCard, ErrorState, LoadingSpinner,
  EmptyState, StatusBadge,
} from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProfileData {
  generatedAt: string
  thresholds: { activeMinutes: number; recentMinutes: number }
  account: { name: string; email: string; publicId: string; accountStatus: string; createdAt: string }
  sessions: SessionItem[]
  activeSessionCount: number
  loginHistory: LoginItem[]
  usage: {
    mostUsedModule: string | null; mostUsedModuleLabel: string | null
    moduleVisits: ModuleVisit[]; lastSeenModule: string | null
    sectionViews: SectionView[]; dailyActivity: DailyActivity[]
  }
  reliability: {
    totalFailures: number; repeatedErrors: RepeatedError[]
    lastError: { module: string; errorCategory: string; errorMessage: string; timestamp: string } | null
  }
  timeline: TimelineEvent[]
}

interface SessionItem {
  sessionId: string; status: string; estimated: boolean
  sessionStartedAt: string | null; lastSeenAt: string | null; lastModule: string | null
  browser: string; browserVersion: string; os: string; osVersion: string
  deviceCategory: string; ip: string | null; ipSource: string
  approximateLocation: string | null; revokedAt: string | null; loggedOutAt: string | null
}

interface LoginItem {
  eventType: string; outcome: string; ip: string | null; deviceCategory: string; browser: string
  metadata: Record<string, unknown>; timestamp: string
}

interface ModuleVisit {
  module: string; moduleLabel: string; totalOps: number; successes: number; failures: number; lastActivity: string
}

interface SectionView { section: string; views: number; lastView: string }

interface DailyActivity { date: string; ops: number; failures: number }

interface RepeatedError { errorCategory: string; count: number; lastOccurrence: string }

interface TimelineEvent {
  module: string; operation: string; outcome: string; httpStatus: number | null
  errorCategory: string | null; errorMessage: string | null; source: string
  durationMs: number | null; correlationId: string | null; timestamp: string
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function DeviceIcon({ cat }: { cat: string }) {
  const s = { color: 'var(--text-muted)', flexShrink: 0 } as const
  if (cat === 'mobile')  return <Smartphone size={12} style={s} />
  if (cat === 'tablet')  return <Tablet size={12} style={s} />
  if (cat === 'desktop') return <Monitor size={12} style={s} />
  return <HelpCircle size={12} style={s} />
}

function PresenceDot({ status }: { status: string }) {
  const c: Record<string, string> = { active: '#22c55e', idle: '#f59e0b', expired: '#9ca3af', revoked: '#ef4444', logged_out: '#6b7280' }
  return <span className="w-2 h-2 rounded-full inline-block" style={{ background: c[status] ?? '#9ca3af' }} />
}

const EVENT_LABELS: Record<string, string> = {
  login_success: 'Login', login_failure: 'Login Failed', logout: 'Logout',
  session_expired: 'Session Expired', session_revoked: 'Session Revoked',
  two_factor_enabled: '2FA Enabled', two_factor_disabled: '2FA Disabled',
  two_factor_challenge_failed: '2FA Failed', password_changed: 'Password Changed',
  permission_denied: 'Permission Denied',
}

// ── Main component ────────────────────────────────────────────────────────────

export function UserProfileClient({ publicId }: { publicId: string }) {
  const [data, setData]       = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab]         = useState<'usage' | 'sessions' | 'timeline' | 'security'>('usage')

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/admin/user-profile/${encodeURIComponent(publicId)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load profile')
      setData(json as ProfileData)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false); setRefreshing(false) }
  }, [publicId])

  useEffect(() => { void load() }, [load])

  if (loading) return <div className="flex justify-center py-20"><LoadingSpinner size="lg" /></div>
  if (error)   return <ErrorState message={error} />
  if (!data)   return null

  const { account, sessions, loginHistory, usage, reliability, timeline } = data

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-[14px] font-bold"
            style={{ background: 'var(--accent-dim)', color: 'var(--accent-text)' }}>
            {account.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-[17px] font-bold" style={{ color: 'var(--text-primary)' }}>{account.name}</h2>
            <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {account.email} · {account.publicId}
            </p>
          </div>
          <StatusBadge status={account.accountStatus} />
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Joined {formatRelativeTime(account.createdAt)}
          </span>
          <button onClick={() => void load(true)} disabled={refreshing}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[12px] font-medium"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />Refresh
          </button>
        </div>
      </div>

      {/* Note: activity metadata only */}
      <div className="flex items-start gap-2 text-[11px] px-1" style={{ color: 'var(--text-muted)' }}>
        <Shield size={12} className="shrink-0 mt-0.5" />
        Administrators see activity metadata only. Private note, task, and expense content is never included.
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Active Sessions" value={data.activeSessionCount} icon={<Monitor size={16} />} color="success" />
        <StatCard label="Total Failures" value={reliability.totalFailures} icon={<XCircle size={16} />} color={reliability.totalFailures > 0 ? 'danger' : 'default'} />
        <StatCard label="Top Module" value={usage.mostUsedModuleLabel ?? '—'} icon={<Layers size={16} />} color="info" />
        <StatCard label="Login Events (30d)" value={loginHistory.length} icon={<Shield size={16} />} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap">
        {(['usage', 'sessions', 'security', 'timeline'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium capitalize transition-colors"
            style={{
              background: tab === t ? 'var(--accent)' : 'var(--glass-subtle-bg)',
              border: `1px solid ${tab === t ? 'var(--accent)' : 'var(--border)'}`,
              color: tab === t ? '#fff' : 'var(--text-secondary)',
            }}>{t}</button>
        ))}
      </div>

      {/* Tab: Usage */}
      {tab === 'usage' && (
        <div className="space-y-4">
          <AdminCard>
            <SectionHeader title="Module Usage (last 30 days)" subtitle="Operations recorded by server-side instrumentation" />
            {usage.moduleVisits.length === 0
              ? <EmptyState message="No module operations recorded yet." />
              : (
                <div className="space-y-2">
                  {usage.moduleVisits.map(m => (
                    <div key={m.module} className="flex items-center justify-between gap-3 py-2 border-b"
                      style={{ borderColor: 'var(--border)' }}>
                      <div>
                        <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{m.moduleLabel}</span>
                        <span className="text-[11px] ml-2" style={{ color: 'var(--text-muted)' }}>
                          Last: {formatRelativeTime(m.lastActivity)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px]">
                        <span style={{ color: 'var(--text-secondary)' }}>{m.totalOps} ops</span>
                        <span style={{ color: 'var(--success-text)' }}>✓ {m.successes}</span>
                        {m.failures > 0 && <span style={{ color: 'var(--danger-text)' }}>✗ {m.failures}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </AdminCard>

          {reliability.totalFailures > 0 && (
            <AdminCard>
              <SectionHeader title="Reliability Issues" subtitle="Repeated errors in the last 30 days" />
              {reliability.repeatedErrors.length === 0
                ? <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>No repeated error patterns.</p>
                : (
                  <div className="space-y-2">
                    {reliability.repeatedErrors.map(e => (
                      <div key={e.errorCategory} className="flex items-center justify-between text-[12px] py-1.5 border-b"
                        style={{ borderColor: 'var(--border)' }}>
                        <span className="capitalize font-medium" style={{ color: 'var(--text-primary)' }}>
                          {e.errorCategory.replace(/_/g, ' ')}
                        </span>
                        <span className="flex items-center gap-2">
                          <span style={{ color: 'var(--danger-text)' }}>{e.count}×</span>
                          <span style={{ color: 'var(--text-muted)' }}>last {formatRelativeTime(e.lastOccurrence)}</span>
                        </span>
                      </div>
                    ))}
                    {reliability.lastError && (
                      <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                        Last error: [{reliability.lastError.module}] {reliability.lastError.errorMessage}
                      </p>
                    )}
                  </div>
                )
              }
            </AdminCard>
          )}
        </div>
      )}

      {/* Tab: Sessions */}
      {tab === 'sessions' && (
        <AdminCard padding="sm">
          <SectionHeader title="Recent Sessions (24h)" subtitle="One row per browser tab. * = estimated status" />
          {sessions.length === 0
            ? <EmptyState message="No active sessions in the last 24 hours." />
            : (
              <div className="space-y-2">
                {sessions.map((s, i) => (
                  <div key={i} className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl"
                    style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                        <PresenceDot status={s.status} />
                        {s.status}{s.estimated ? '*' : ''}
                      </span>
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {s.lastSeenAt ? formatRelativeTime(s.lastSeenAt) : '—'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      <span className="flex items-center gap-1"><DeviceIcon cat={s.deviceCategory} /> {s.browser} · {s.os}</span>
                      {s.ip && <span className="flex items-center gap-1"><Globe size={11} />{s.ip}</span>}
                      {s.lastModule && <span className="flex items-center gap-1"><Layers size={11} />{s.lastModule}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </AdminCard>
      )}

      {/* Tab: Security */}
      {tab === 'security' && (
        <AdminCard padding="sm">
          <SectionHeader title="Login & Security History (30d)" subtitle="From SecurityEvent records. No passwords or tokens included." />
          {loginHistory.length === 0
            ? <EmptyState message="No security events recorded in the last 30 days." />
            : (
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {loginHistory.map((e, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-2.5 flex-wrap">
                    <div className="flex items-center gap-2">
                      {e.outcome === 'success'
                        ? <CheckCircle size={13} style={{ color: 'var(--success)' }} />
                        : <XCircle size={13} style={{ color: 'var(--danger)' }} />
                      }
                      <span className="text-[12px] font-medium" style={{ color: 'var(--text-primary)' }}>
                        {EVENT_LABELS[e.eventType] ?? e.eventType.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {e.ip && <span className="flex items-center gap-1"><Globe size={11} />{e.ip}</span>}
                      <span>{e.browser} · {e.deviceCategory}</span>
                      <span>{formatRelativeTime(e.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </AdminCard>
      )}

      {/* Tab: Timeline */}
      {tab === 'timeline' && (
        <AdminCard padding="sm">
          <SectionHeader title="Activity Timeline (last 100 events)" subtitle="Module operations. Content never included." />
          {timeline.length === 0
            ? <EmptyState message="No module operations recorded." />
            : (
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {timeline.map((e, i) => (
                  <div key={i} className="py-2 flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        {e.outcome === 'success'
                          ? <CheckCircle size={11} style={{ color: 'var(--success)' }} />
                          : <XCircle size={11} style={{ color: 'var(--danger)' }} />
                        }
                        <span className="text-[12px] font-medium capitalize" style={{ color: 'var(--text-primary)' }}>
                          {e.module} / {e.operation.replace(/_/g, ' ')}
                        </span>
                        {e.httpStatus && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--glass-subtle-bg)', color: 'var(--text-muted)' }}>
                            {e.httpStatus}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{formatRelativeTime(e.timestamp)}</span>
                    </div>
                    {e.errorMessage && (
                      <p className="text-[11px] ml-5" style={{ color: 'var(--danger-text)' }}>{e.errorMessage}</p>
                    )}
                    {e.durationMs != null && (
                      <p className="text-[10px] ml-5" style={{ color: 'var(--text-muted)' }}>{e.durationMs}ms</p>
                    )}
                  </div>
                ))}
              </div>
            )
          }
        </AdminCard>
      )}
    </div>
  )
}
