'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, RotateCcw } from 'lucide-react'
import {
  AdminCard, SectionHeader, ErrorState, LoadingSpinner,
  StatusBadge, Pagination, EmptyState,
} from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'
import type { AdminRole } from '@/models/AdminUser'

interface NotifLog {
  _id: string; type: string; forDate: string; status: string;
  contentPreview: string; emailSubject: string | null;
  errorMessage: string | null; skipReason: string | null;
  scheduledAt: string; sentAt: string | null;
  createdAt: string; userId: string;
}

interface NotifData {
  logs: NotifLog[]; total: number; page: number; limit: number;
  hasMore: boolean; summary: Record<string, number>;
}

export function NotificationsClient({ adminRole }: { adminRole: AdminRole }) {
  const [data, setData]         = useState<NotifData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [page, setPage]         = useState(1)
  const [status, setStatus]     = useState('all')
  const [type, setType]         = useState('')
  const [retrying, setRetrying] = useState<string | null>(null)
  const [retryMsg, setRetryMsg] = useState<string | null>(null)
  const canRetry = adminRole === 'super_admin' || adminRole === 'admin'
  const limit = 25

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit), status })
      if (type) params.set('type', type)
      const res  = await fetch(`/api/admin/notifications?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setData(json)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [page, status, type, limit])

  useEffect(() => { void load(page) }, [page]) // eslint-disable-line

  async function retryJob(logId: string) {
    setRetrying(logId); setRetryMsg(null)
    try {
      const res  = await fetch('/api/admin/notifications', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'retry', logId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Retry failed')
      setRetryMsg('Job reset to pending. Worker will process on next cycle.')
      void load(page)
    } catch (e) { setRetryMsg(e instanceof Error ? e.message : 'Retry failed') }
    finally { setRetrying(null) }
  }

  const summary = data?.summary ?? {}

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {['sent_to_smtp', 'pending', 'failed', 'processing', 'skipped'].map((s) => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); void load(1) }}
            className="rounded-xl p-3 text-center transition-all"
            style={{ background: status === s ? 'var(--accent-dim)' : 'var(--glass-subtle-bg)',
              border: `1px solid ${status === s ? 'var(--accent)' : 'var(--border)'}` }}>
            <p className="text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>{summary[s] ?? 0}</p>
            <p className="text-[10px] uppercase tracking-wide mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {s.replace(/_/g, ' ')}
            </p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <AdminCard padding="sm">
        <div className="flex gap-2 flex-wrap">
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}
            className="px-3 py-2 text-[13px] rounded-xl outline-none"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="sent_to_smtp">Sent</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </select>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1) }}
            className="px-3 py-2 text-[13px] rounded-xl outline-none"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            <option value="">All Types</option>
            {['MORNING_BRIEF','TASK_TOMORROW','TASK_INCOMPLETE_TODAY','TASK_DUE_SOON',
              'HABIT_TOMORROW','HABIT_REMINDER','SPENDING_ALERT','DAILY_SUMMARY',
              'WEEKLY_SUMMARY','NOTE_REMINDER','PROJECT_DEADLINE','SUBSCRIPTION_RENEWAL',
              'GROUP_BILL_REMINDER'].map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <button onClick={() => { setStatus('all'); setType(''); setPage(1); void load(1) }}
            className="px-3 py-2 rounded-xl text-[12px] font-medium"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            Clear
          </button>
          <button onClick={() => load(page)} className="p-2 rounded-xl"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </AdminCard>

      {retryMsg && (
        <div className="rounded-xl px-4 py-2.5 text-[12px]"
          style={{ background: retryMsg.includes('failed') ? 'var(--danger-dim)' : 'var(--success-dim)',
            color: retryMsg.includes('failed') ? 'var(--danger-text)' : 'var(--success-text)',
            border: '1px solid rgba(0,0,0,0.06)' }}>
          {retryMsg} <button onClick={() => setRetryMsg(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      {/* Log table */}
      <div>
        <SectionHeader title={`Notification Log${data ? ` (${data.total})` : ''}`} />
        {loading ? <div className="flex justify-center py-12"><LoadingSpinner /></div>
        : error ? <ErrorState message={error} />
        : !data?.logs.length ? <EmptyState message="No notifications match the current filter." />
        : (
          <AdminCard padding="sm">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Type', 'Date', 'Status', 'Preview', 'Sent At', canRetry ? 'Action' : ''].filter(Boolean).map((h) => (
                      <th key={h} className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.logs.map((log) => (
                    <tr key={log._id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="py-2 px-3 font-mono text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                        {log.type.replace(/_/g, ' ')}
                      </td>
                      <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>{log.forDate}</td>
                      <td className="py-2 px-3"><StatusBadge status={log.status} /></td>
                      <td className="py-2 px-3 max-w-[200px] truncate" style={{ color: 'var(--text-secondary)' }}
                        title={log.errorMessage ?? log.contentPreview}>
                        {log.status === 'failed' && log.errorMessage
                          ? <span style={{ color: 'var(--danger-text)' }}>{log.errorMessage.slice(0, 80)}</span>
                          : log.contentPreview}
                      </td>
                      <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>
                        {log.sentAt ? formatRelativeTime(log.sentAt) : '—'}
                      </td>
                      {canRetry && (
                        <td className="py-2 px-3">
                          {(log.status === 'failed' || log.status === 'skipped') && (
                            <button
                              onClick={() => retryJob(log._id)}
                              disabled={retrying === log._id}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors"
                              style={{ background: 'var(--accent-dim)', color: 'var(--accent-text)', border: '1px solid var(--accent-dim)' }}
                            >
                              <RotateCcw size={10} className={retrying === log._id ? 'animate-spin' : ''} />
                              {retrying === log._id ? '…' : 'Retry'}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} hasMore={data.hasMore} total={data.total} limit={limit}
              onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
          </AdminCard>
        )}
      </div>
    </div>
  )
}
