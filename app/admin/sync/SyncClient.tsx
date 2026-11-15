'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Database, Server, AlertCircle, CheckCircle } from 'lucide-react'
import { AdminCard, SectionHeader, ErrorState, LoadingSpinner, StatCard } from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'

// Worker status is now a strict typed literal from the API.
// We keep `string` as a fallback union type so stale/cached responses from
// older server versions degrade gracefully rather than crashing.
type WorkerStatus = 'RUNNING' | 'POSSIBLY_STOPPED' | 'NO_ACTIVITY_YET'

interface SyncData {
  checkedAt: string
  database: { status: string; ping: boolean }
  syncEndpoints: { pushSync: { available: boolean }; pullSync: { available: boolean }; note: string }
  backgroundWorker: {
    // Accept WorkerStatus | string so old free-form payloads don't break typing.
    status: WorkerStatus | string
    lastActivityAt: string | null
    stuckJobs: number; pendingJobs: number; failedLast24h: number; hint: string
  }
  users: { activeAccounts: number }
}

/**
 * Normalise a raw worker status value into one of the known typed literals.
 * Guards against undefined/null/empty that arrive when the API fails or
 * returns a partial payload.  The old sync API returned free-form strings
 * like "POSSIBLY_STOPPED (42m ago)" — this function handles that too.
 *
 * Returns 'NO_ACTIVITY_YET' for any unrecognised value so the UI always
 * shows a meaningful state and never falsely indicates the worker is running.
 */
function normaliseWorkerStatus(raw: unknown): WorkerStatus {
  if (typeof raw !== 'string' || raw.trim() === '') return 'NO_ACTIVITY_YET'
  const upper = raw.trim().toUpperCase()
  if (upper === 'RUNNING' || upper.startsWith('RUNNING'))                   return 'RUNNING'
  if (upper === 'POSSIBLY_STOPPED' || upper.startsWith('POSSIBLY_STOPPED')) return 'POSSIBLY_STOPPED'
  return 'NO_ACTIVITY_YET'
}

export function SyncClient() {
  const [data, setData]       = useState<SyncData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/admin/sync')
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
  // Guard: backgroundWorker may be absent in a partial/error API response.
  // normaliseWorkerStatus accepts unknown and never throws.
  const worker = d.backgroundWorker ?? {}
  const workerStatus = normaliseWorkerStatus(worker.status)
  const workerOk = workerStatus === 'RUNNING'

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {/* Guard malformed checkedAt timestamp */}
          Last checked {d.checkedAt && !isNaN(new Date(d.checkedAt).getTime())
            ? formatRelativeTime(d.checkedAt)
            : '—'}
        </p>
        <button onClick={() => load(true)} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium"
          style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Database"    value={d.database?.ping ? 'Connected' : 'Error'}
          color={d.database?.ping ? 'success' : 'danger'} icon={<Database size={16} />} />
        <StatCard label="Push Sync"   value={d.syncEndpoints?.pushSync?.available ? 'Available' : 'Unavailable'}
          color={d.syncEndpoints?.pushSync?.available ? 'success' : 'danger'} icon={<Server size={16} />} />
        <StatCard label="Pull Sync"   value={d.syncEndpoints?.pullSync?.available ? 'Available' : 'Unavailable'}
          color={d.syncEndpoints?.pullSync?.available ? 'success' : 'danger'} icon={<Server size={16} />} />
        <StatCard label="Active Users" value={d.users?.activeAccounts ?? '—'} icon={<CheckCircle size={16} />} />
      </div>

      {/* Worker */}
      <div>
        <SectionHeader title="Background Worker" />
        <AdminCard>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {workerOk
                ? <CheckCircle size={16} style={{ color: 'var(--success)' }} />
                : <AlertCircle size={16} style={{ color: 'var(--warning)' }} />}
              <span className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
                {workerStatus}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Pending Jobs</p>
                <p className="text-[20px] font-bold" style={{ color: 'var(--text-primary)' }}>{worker.pendingJobs ?? '—'}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Stuck Jobs</p>
                <p className="text-[20px] font-bold" style={{ color: (worker.stuckJobs ?? 0) > 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                  {typeof worker.stuckJobs === 'number' ? worker.stuckJobs : '—'}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Failed (24h)</p>
                <p className="text-[20px] font-bold" style={{ color: (worker.failedLast24h ?? 0) > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
                  {typeof worker.failedLast24h === 'number' ? worker.failedLast24h : '—'}
                </p>
              </div>
            </div>
            {/* Only render relative time when the timestamp is a valid ISO string */}
            {worker.lastActivityAt && !isNaN(new Date(worker.lastActivityAt).getTime()) && (
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                Last activity: {formatRelativeTime(worker.lastActivityAt)}
              </p>
            )}
            {!worker.lastActivityAt && (
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                No worker activity recorded yet.
              </p>
            )}
            {worker.hint && (
              <div className="rounded-lg px-3 py-2 text-[12px]"
                style={{ background: (worker.stuckJobs ?? 0) > 0 ? 'var(--warning-dim)' : 'var(--success-dim)',
                  color: (worker.stuckJobs ?? 0) > 0 ? 'var(--warning-text)' : 'var(--success-text)',
                  border: '1px solid rgba(0,0,0,0.06)' }}>
                {worker.hint}
              </div>
            )}
          </div>
        </AdminCard>
      </div>

      {d.syncEndpoints?.note && (
        <AdminCard>
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Note:</strong> {d.syncEndpoints.note}
          </p>
        </AdminCard>
      )}
    </div>
  )
}
