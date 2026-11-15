'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Users, Bell, Activity, Database, RefreshCw, AlertCircle,
  UserCheck, UserX, TrendingUp,
} from 'lucide-react'
import {
  StatCard, AdminCard, SectionHeader, ErrorState,
  LoadingSpinner, StatusBadge,
} from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'

interface OverviewData {
  generatedAt: string
  database:    { status: string; name: string }
  users: {
    total: number; active: number; deleted: number;
    emailVerified: number; notificationsTested: number;
    newLast24h: number; newLast30d: number
  }
  notifications: {
    last7Days: { pending: number; processing: number; sent: number; failed: number; skipped: number }
    workerStatus: string
    lastWorkerActivityAt: string | null
  }
  recentAdminActions: Array<{
    actorName: string; actorRole: string; action: string;
    result: string; target: unknown; at: string
  }>
}

export function AdminOverviewClient() {
  const [data, setData]       = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/admin/overview')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load overview')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (error) return <ErrorState message={error} />

  const d = data!
  const notif = d.notifications.last7Days
  const workerOk = d.notifications.workerStatus.startsWith('RUNNING')

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Last updated {formatRelativeTime(d.generatedAt)}
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors"
          style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* DB / system status */}
      <AdminCard>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database size={14} style={{ color: d.database.status === 'connected' ? 'var(--success)' : 'var(--danger)' }} />
            <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
              Database: {d.database.name}
            </span>
          </div>
          <StatusBadge status={d.database.status === 'connected' ? 'success' : 'failure'} />
        </div>
      </AdminCard>

      {/* User stats */}
      <div>
        <SectionHeader title="Users" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Total Users"    value={d.users.total}       icon={<Users size={16} />}     color="default" />
          <StatCard label="Active"         value={d.users.active}      icon={<UserCheck size={16} />} color="success" />
          <StatCard label="Deleted"        value={d.users.deleted}     icon={<UserX size={16} />}     color="danger" />
          <StatCard label="New (30 days)"  value={d.users.newLast30d}  icon={<TrendingUp size={16} />} color="info"
            sub={`${d.users.newLast24h} today`} />
        </div>
      </div>

      {/* Notification stats */}
      <div>
        <SectionHeader
          title="Notifications (last 7 days)"
          subtitle={`Worker: ${d.notifications.workerStatus}`}
        />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard label="Sent"       value={notif.sent}       color="success" icon={<Bell size={16} />} />
          <StatCard label="Pending"    value={notif.pending}    color="warning" icon={<Bell size={16} />} />
          <StatCard label="Failed"     value={notif.failed}     color="danger"  icon={<AlertCircle size={16} />} />
          <StatCard label="Processing" value={notif.processing} color="info"    icon={<Activity size={16} />} />
          <StatCard label="Skipped"    value={notif.skipped}    color="default" icon={<Bell size={16} />} />
        </div>
        {!workerOk && (
          <div
            className="mt-3 rounded-xl px-4 py-3 text-[12px]"
            style={{ background: 'var(--warning-dim)', border: '1px solid rgba(217,119,6,0.20)', color: 'var(--warning-text)' }}
          >
            ⚠ Worker status: {d.notifications.workerStatus}
          </div>
        )}
      </div>

      {/* Recent admin actions */}
      <div>
        <SectionHeader title="Recent Admin Actions" />
        <AdminCard padding="sm">
          {d.recentAdminActions.length === 0 ? (
            <p className="text-[13px] text-center py-4" style={{ color: 'var(--text-muted)' }}>
              No admin actions recorded yet.
            </p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {d.recentAdminActions.map((action, i) => (
                <div key={i} className="flex items-center justify-between py-2.5 gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {action.actorName}
                      <span className="font-normal ml-1" style={{ color: 'var(--text-muted)' }}>
                        · {action.action.replace(/_/g, ' ')}
                      </span>
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      {formatRelativeTime(action.at)}
                    </p>
                  </div>
                  <StatusBadge status={action.result} />
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      </div>
    </div>
  )
}
