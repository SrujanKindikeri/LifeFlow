'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Shield, Key, Users, AlertTriangle } from 'lucide-react'
import { AdminCard, SectionHeader, ErrorState, LoadingSpinner, StatCard, StatusBadge } from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'

interface SecurityData {
  checkedAt: string
  users: { total: number; emailVerified: number; totpEnabled: number; emailOtpEnabled: number;
           eitherTwoFaEnabled: number; deletedAccounts: number; pendingPasswordReset: number }
  adminActivity: { loginFailuresLast24h: number; loginSuccessesLast24h: number }
  recentActivity: Array<{ actorName: string; actorRole: string; action: string; result: string; target: unknown; at: string }>
}

export function SecurityClient() {
  const [data, setData]         = useState<SecurityData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    try {
      const res  = await fetch('/api/admin/security')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setData(json)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) return <div className="flex justify-center py-12"><LoadingSpinner /></div>
  if (error)   return <ErrorState message={error} />
  const d = data!
  const twoFaPct = d.users.total > 0 ? Math.round((d.users.eitherTwoFaEnabled / d.users.total) * 100) : 0

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button onClick={() => load(true)} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
          style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="2FA Adoption"        value={`${twoFaPct}%`} sub={`${d.users.eitherTwoFaEnabled} of ${d.users.total}`}
          color={twoFaPct > 50 ? 'success' : 'warning'} icon={<Shield size={16} />} />
        <StatCard label="TOTP Enabled"         value={d.users.totpEnabled}  icon={<Key size={16} />}     color="info" />
        <StatCard label="Email OTP Enabled"    value={d.users.emailOtpEnabled} icon={<Key size={16} />}  color="info" />
        <StatCard label="Pending Pwd Reset"    value={d.users.pendingPasswordReset} icon={<AlertTriangle size={16} />}
          color={d.users.pendingPasswordReset > 0 ? 'warning' : 'default'} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <AdminCard>
          <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Admin Logins (24h)</p>
          <p className="text-[28px] font-bold" style={{ color: 'var(--success)' }}>{d.adminActivity.loginSuccessesLast24h}</p>
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>successful</p>
        </AdminCard>
        <AdminCard>
          <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Admin Login Failures (24h)</p>
          <p className="text-[28px] font-bold" style={{ color: d.adminActivity.loginFailuresLast24h > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
            {d.adminActivity.loginFailuresLast24h}
          </p>
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>failed attempts</p>
        </AdminCard>
      </div>

      <div>
        <SectionHeader title="Recent Admin Activity (7 days)" />
        <AdminCard padding="sm">
          {d.recentActivity.length === 0
            ? <p className="text-[13px] text-center py-4" style={{ color: 'var(--text-muted)' }}>No activity recorded.</p>
            : <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {d.recentActivity.map((act, i) => (
                  <div key={i} className="flex items-center justify-between py-2.5 gap-3 text-[12px]">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{act.actorName}</span>
                      <span className="ml-1" style={{ color: 'var(--text-muted)' }}>· {act.action.replace(/_/g, ' ')}</span>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>{formatRelativeTime(act.at)}</p>
                    </div>
                    <StatusBadge status={act.result} />
                  </div>
                ))}
              </div>}
        </AdminCard>
      </div>
    </div>
  )
}
