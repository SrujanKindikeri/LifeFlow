'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { AdminCard, SectionHeader, ErrorState, LoadingSpinner, StatusBadge, Pagination, EmptyState } from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'

interface AuditEntry {
  _id: string; actorName: string; actorRole: string; action: string;
  result: string; target: { type: string; id: string } | null;
  metadata: Record<string, unknown>; createdAt: string
}

export function AuditLogsClient() {
  const [logs, setLogs]       = useState<AuditEntry[]>([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [action, setAction]   = useState('')
  const [result, setResult]   = useState('')
  const limit = 25

  const load = useCallback(async (p = page) => {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(limit) })
      if (action) params.set('action', action)
      if (result) params.set('result', result)
      const res  = await fetch(`/api/admin/audit-logs?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setLogs(json.logs); setTotal(json.total)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [page, action, result, limit])

  useEffect(() => { void load(page) }, [page]) // eslint-disable-line

  return (
    <div className="space-y-4">
      {/* Filters */}
      <AdminCard padding="sm">
        <div className="flex gap-2 flex-wrap">
          <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }}
            className="px-3 py-2 text-[13px] rounded-xl outline-none"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            <option value="">All Actions</option>
            {['admin_login','admin_logout','admin_login_failed','user_viewed','user_suspended',
              'user_activated','user_deleted','user_restored','admin_created','admin_deactivated',
              'admin_activated','admin_role_changed','notification_retry','announcement_created',
              'announcement_updated','announcement_deleted','setting_updated'].map((a) => (
              <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <select value={result} onChange={(e) => { setResult(e.target.value); setPage(1) }}
            className="px-3 py-2 text-[13px] rounded-xl outline-none"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
            <option value="">All Results</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="denied">Denied</option>
          </select>
          <button onClick={() => { setAction(''); setResult(''); setPage(1) }}
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

      <SectionHeader title={`Audit Log (${total} entries)`} subtitle="Immutable — records cannot be edited or deleted" />

      {loading ? <div className="flex justify-center py-12"><LoadingSpinner /></div>
      : error   ? <ErrorState message={error} />
      : !logs.length ? <EmptyState message="No audit log entries match the current filter." />
      : (
        <AdminCard padding="sm">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Actor', 'Role', 'Action', 'Target', 'Result', 'Time'].map((h) => (
                    <th key={h} className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log._id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td className="py-2 px-3 font-medium" style={{ color: 'var(--text-primary)' }}>{log.actorName}</td>
                    <td className="py-2 px-3"><StatusBadge status={log.actorRole} /></td>
                    <td className="py-2 px-3" style={{ color: 'var(--text-secondary)' }}>{log.action.replace(/_/g, ' ')}</td>
                    <td className="py-2 px-3 text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                      {log.target ? `${log.target.type}: ${log.target.id}` : '—'}
                    </td>
                    <td className="py-2 px-3"><StatusBadge status={log.result} /></td>
                    <td className="py-2 px-3" style={{ color: 'var(--text-muted)' }}>{formatRelativeTime(log.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} hasMore={page * limit < total} total={total} limit={limit}
            onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
        </AdminCard>
      )}
    </div>
  )
}
