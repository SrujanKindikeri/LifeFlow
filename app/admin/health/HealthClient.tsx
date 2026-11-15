'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Database, Server, Cpu, HardDrive, Clock, CheckCircle, XCircle } from 'lucide-react'
import { AdminCard, SectionHeader, ErrorState, LoadingSpinner, StatCard, StatusBadge } from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'

interface HealthData {
  checkedAt: string; overall: string
  database: { status: string; ping: boolean; latencyMs: number; name: string }
  application: { version: string; nodeEnv: string; appUrl: string; nodeVersion: string }
  process: { uptimeSeconds: number; memoryRssKb: number; memoryHeapUsedKb: number; memoryHeapTotalKb: number }
  worker: { status: string; lastActivityAt: string | null; stuckJobs: number; pendingJobs: number; failedLast24h: number }
  users: { total: number; active: number }
  configuration: Record<string, unknown>
}

function fmt(bytes: number) { return `${(bytes / 1024).toFixed(1)} MB` }
function fmtUptime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return `${h}h ${m}m`
}

export function HealthClient() {
  const [data, setData]         = useState<HealthData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/admin/system-health')
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

  const cfg = d.configuration as Record<string, unknown>

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          {d.overall === 'ok'
            ? <CheckCircle size={16} style={{ color: 'var(--success)' }} />
            : <XCircle    size={16} style={{ color: 'var(--warning)' }} />}
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Overall: {d.overall.toUpperCase()}
          </span>
        </div>
        <button onClick={() => load(true)} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
          style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Database"    value={d.database.ping ? 'OK' : 'Error'} color={d.database.ping ? 'success' : 'danger'}
          sub={`${d.database.latencyMs}ms`} icon={<Database size={16} />} />
        <StatCard label="Process Uptime" value={fmtUptime(d.process.uptimeSeconds)} icon={<Clock size={16} />} />
        <StatCard label="RSS Memory" value={fmt(d.process.memoryRssKb)} icon={<Cpu size={16} />} />
        <StatCard label="Heap Used"  value={fmt(d.process.memoryHeapUsedKb)}
          sub={`of ${fmt(d.process.memoryHeapTotalKb)}`} icon={<HardDrive size={16} />} />
      </div>

      {/* Application info */}
      <div>
        <SectionHeader title="Application" />
        <AdminCard>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[13px]">
            <div><p style={{ color: 'var(--text-muted)' }}>Version</p><p className="font-semibold mt-0.5">{d.application.version}</p></div>
            <div><p style={{ color: 'var(--text-muted)' }}>Environment</p><p className="font-semibold mt-0.5">{d.application.nodeEnv}</p></div>
            <div><p style={{ color: 'var(--text-muted)' }}>Node.js</p><p className="font-semibold mt-0.5">{d.application.nodeVersion}</p></div>
            <div><p style={{ color: 'var(--text-muted)' }}>App URL</p><p className="font-semibold mt-0.5 truncate">{d.application.appUrl}</p></div>
          </div>
        </AdminCard>
      </div>

      {/* Worker */}
      <div>
        <SectionHeader title="Notification Worker" />
        <AdminCard>
          <div className="flex items-center gap-2 mb-3">
            <StatusBadge status={d.worker.status.startsWith('RUNNING') ? 'success' : 'warning'} />
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{d.worker.status}</span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-[13px]">
            <div><p style={{ color: 'var(--text-muted)' }}>Pending</p><p className="font-bold text-[18px]">{d.worker.pendingJobs}</p></div>
            <div><p style={{ color: 'var(--text-muted)' }}>Stuck</p>
              <p className="font-bold text-[18px]" style={{ color: d.worker.stuckJobs > 0 ? 'var(--danger)' : 'inherit' }}>{d.worker.stuckJobs}</p></div>
            <div><p style={{ color: 'var(--text-muted)' }}>Failed (24h)</p>
              <p className="font-bold text-[18px]" style={{ color: d.worker.failedLast24h > 0 ? 'var(--warning)' : 'inherit' }}>{d.worker.failedLast24h}</p></div>
          </div>
          {d.worker.lastActivityAt && (
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>Last activity: {formatRelativeTime(d.worker.lastActivityAt)}</p>
          )}
        </AdminCard>
      </div>

      {/* Configuration flags */}
      <div>
        <SectionHeader title="Configuration" subtitle="Boolean flags only — no secret values shown" />
        <AdminCard padding="sm">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(cfg).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ background: 'var(--glass-subtle-bg)' }}>
                <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                  {key.replace(/_/g, ' ')}
                </span>
                <span className="text-[11px] font-semibold" style={{
                  color: val === true ? 'var(--success)' : val === false ? 'var(--danger)' : 'var(--text-muted)'
                }}>
                  {typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val)}
                </span>
              </div>
            ))}
          </div>
        </AdminCard>
      </div>
    </div>
  )
}
