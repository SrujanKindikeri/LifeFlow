'use client'

/**
 * ErrorMonitoringClient.tsx — Error monitoring view.
 * Reuses /api/admin/module-activity with outcome=failure filter.
 * Shows error categories, operation breakdown, and users with repeated failures.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, XCircle, Search } from 'lucide-react'
import {
  AdminCard, SectionHeader, StatCard, ErrorState, LoadingSpinner,
  EmptyState, Pagination,
} from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'

interface ErrorData {
  total: number; failures: number; errorRate: number; unknowns: number
  errorBreakdown: { _id: string; count: number; uniqueUsers: number; lastOccurrence: string }[]
  operationBreakdown: { _id: string; count: number; successes: number; failures: number }[]
  activityEvents: ActivityEvent[]
  activityTotal: number
  page: number; limit: number
}

interface ActivityEvent {
  publicId: string; module: string; operation: string; outcome: string
  httpStatus: number | null; errorCategory: string | null; errorMessage: string | null
  source: string; durationMs: number | null; createdAt: string; correlationId: string | null
}

const MODULE_NAMES = ['notes', 'tasks', 'habits', 'projects', 'expenses', 'subscriptions']

export function ErrorMonitoringClient() {
  const [data, setData]         = useState<ErrorData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [days, setDays]         = useState(30)
  const [page, setPage]         = useState(1)
  const [moduleFilter, setModuleFilter] = useState('all')
  const [userSearch, setUserSearch] = useState('')

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({
        module: moduleFilter, days: String(days), page: String(page),
        limit: '25', outcome: 'failure',
      })
      if (userSearch) p.set('user', userSearch)
      const res  = await fetch(`/api/admin/module-activity?${p}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setData({
        total:              json.totalOps ?? 0,
        failures:           json.failures ?? 0,
        errorRate:          json.errorRate ?? 0,
        unknowns:           json.unknowns ?? 0,
        errorBreakdown:     json.errorBreakdown ?? [],
        operationBreakdown: json.operationBreakdown ?? [],
        activityEvents:     json.activityEvents ?? [],
        activityTotal:      json.activityTotal ?? 0,
        page:               json.page ?? page,
        limit:              json.limit ?? 25,
      })
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false); setRefreshing(false) }
  }, [days, page, moduleFilter, userSearch])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-5">
      <SectionHeader title="Error Monitoring" subtitle="Failed operations from real ModuleEvent records. Server-side instrumentation." />

      {/* Stats */}
      {data && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Failures" value={data.failures} icon={<XCircle size={16} />} color="danger" />
          <StatCard label="Error Rate"     value={`${data.errorRate}%`} icon={<AlertTriangle size={16} />} color={data.errorRate > 10 ? 'danger' : 'warning'} />
          <StatCard label="Total Ops"      value={data.total} icon={<AlertTriangle size={16} />} />
          <StatCard label="Unknown Outcome" value={data.unknowns} />
        </div>
      )}

      {/* Filters */}
      <AdminCard padding="sm">
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[160px]"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 10px' }}>
            <Search size={13} style={{ color: 'var(--text-muted)' }} />
            <input placeholder="Filter by publicId…" value={userSearch}
              onChange={e => { setUserSearch(e.target.value); setPage(1) }}
              className="flex-1 bg-transparent text-[12px] outline-none" style={{ color: 'var(--text-primary)' }} />
          </div>
          <select value={moduleFilter} onChange={e => { setModuleFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 rounded-xl text-[12px] outline-none"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <option value="all">All modules</option>
            {MODULE_NAMES.map(m => <option key={m} value={m}>{m}</option>)}
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

      {loading ? (
        <div className="flex justify-center py-12"><LoadingSpinner /></div>
      ) : error ? (
        <ErrorState message={error} />
      ) : !data ? null : (
        <div className="space-y-4">
          {/* Error category breakdown */}
          {data.errorBreakdown.length > 0 && (
            <AdminCard>
              <SectionHeader title="Error Categories" subtitle="Grouped by error category across all failures" />
              <div className="space-y-2">
                {data.errorBreakdown.map(e => (
                  <div key={e._id} className="flex items-center justify-between text-[12px] py-1.5 border-b"
                    style={{ borderColor: 'var(--border)' }}>
                    <div>
                      <span className="font-semibold capitalize" style={{ color: 'var(--text-primary)' }}>
                        {(e._id ?? 'unknown').replace(/_/g, ' ')}
                      </span>
                      <span className="ml-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {e.uniqueUsers} user{e.uniqueUsers !== 1 ? 's' : ''} · last {formatRelativeTime(e.lastOccurrence)}
                      </span>
                    </div>
                    <span className="font-bold" style={{ color: 'var(--danger-text)' }}>{e.count}</span>
                  </div>
                ))}
              </div>
            </AdminCard>
          )}

          {/* Failed events table */}
          <AdminCard padding="sm">
            <SectionHeader title="Failed Operations" subtitle="Paginated event log. No user content included." />
            {data.activityEvents.length === 0 ? (
              <EmptyState message="No failed operations match the current filters." />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                        {['User', 'Module', 'Operation', 'Error', 'Duration', 'When'].map(h => (
                          <th key={h} className="py-2 px-3 text-[10px] font-bold uppercase tracking-wider"
                            style={{ color: 'var(--text-muted)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.activityEvents.map((e, i) => (
                        <tr key={i} className="border-b" style={{ borderColor: 'var(--border)' }}>
                          <td className="py-2 px-3 text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{e.publicId}</td>
                          <td className="py-2 px-3 text-[11px] capitalize" style={{ color: 'var(--text-secondary)' }}>{e.module}</td>
                          <td className="py-2 px-3 text-[11px] capitalize" style={{ color: 'var(--text-secondary)' }}>{e.operation.replace(/_/g, ' ')}</td>
                          <td className="py-2 px-3">
                            <div className="text-[11px]" style={{ color: 'var(--danger-text)' }}>
                              {e.errorCategory?.replace(/_/g, ' ') ?? '—'}
                            </div>
                            {e.errorMessage && (
                              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{e.errorMessage.slice(0, 60)}</div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {e.durationMs != null ? `${e.durationMs}ms` : '—'}
                          </td>
                          <td className="py-2 px-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {formatRelativeTime(e.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.activityTotal > data.limit && (
                  <Pagination page={data.page} hasMore={data.page * data.limit < data.activityTotal}
                    total={data.activityTotal} limit={data.limit}
                    onPrev={() => setPage(p => Math.max(1, p - 1))}
                    onNext={() => setPage(p => p + 1)} />
                )}
              </>
            )}
          </AdminCard>
        </div>
      )}
    </div>
  )
}
