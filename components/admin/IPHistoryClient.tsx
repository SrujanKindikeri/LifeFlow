'use client'

/**
 * IPHistoryClient.tsx — IP address history with session and security event counts.
 * Privacy note: IP addresses are never proof of identity. Clearly stated in UI.
 */

import { useCallback, useEffect, useState } from 'react'
import { Globe, RefreshCw, Search, AlertTriangle, Shield } from 'lucide-react'
import {
  AdminCard, SectionHeader, ErrorState, LoadingSpinner, EmptyState, Pagination,
} from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'

interface IpEntry {
  ip: string | null; firstSeen: string | null; lastSeen: string | null
  sessionCount: number; uniqueUsers: number
  deviceCategories: string[]; browsers: string[]
  securityEvents: number; securityFailures: number; lastSecurityEvent: string | null
}

interface IpHistoryData { entries: IpEntry[]; total: number; page: number; limit: number; hasMore: boolean; note: string }

export function IPHistoryClient() {
  const [data, setData]       = useState<IpHistoryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [page, setPage]       = useState(1)
  const [days, setDays]       = useState(30)
  const [ipFilter, setIpFilter] = useState('')

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({ page: String(page), limit: '25', days: String(days) })
      if (ipFilter) p.set('ip', ipFilter)
      const res  = await fetch(`/api/admin/ip-history?${p}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setData(json as IpHistoryData)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false); setRefreshing(false) }
  }, [page, days, ipFilter])

  useEffect(() => { void load() }, [load])

  const entries = data?.entries ?? []

  return (
    <div className="space-y-5">
      <SectionHeader title="IP Address History" subtitle="IP addresses observed by the server — restricted to admins" />

      {/* Privacy notice */}
      <div className="rounded-xl px-4 py-3 flex items-start gap-2 text-[12px]"
        style={{ background: 'var(--warning-dim)', border: '1px solid rgba(245,158,11,0.2)', color: 'var(--warning-text)' }}>
        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
        <span>
          IP addresses are <strong>never proof of identity</strong>. Multiple users can share an IP (NAT, VPN, corporate network).
          Mobile IPs change frequently. IP or device changes do NOT indicate malicious activity.
        </span>
      </div>

      {/* Filters */}
      <AdminCard padding="sm">
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[180px]"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 10px' }}>
            <Globe size={13} style={{ color: 'var(--text-muted)' }} />
            <input placeholder="Filter by IP…" value={ipFilter}
              onChange={e => { setIpFilter(e.target.value); setPage(1) }}
              className="flex-1 bg-transparent text-[12px] outline-none" style={{ color: 'var(--text-primary)' }} />
          </div>
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

      {/* Table */}
      <AdminCard padding="sm">
        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner /></div>
        ) : error ? (
          <ErrorState message={error} />
        ) : entries.length === 0 ? (
          <EmptyState message="No IP records found. Sessions appear once users open a module page." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                    {['IP Address', 'Sessions', 'Unique Users', 'Devices / Browsers', 'Security Events', 'First / Last Seen'].map(h => (
                      <th key={h} className="py-2 px-3 text-[10px] font-bold uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={i} className="border-b" style={{ borderColor: 'var(--border)' }}>
                      <td className="py-2 px-3">
                        <span className="flex items-center gap-1.5 text-[12px] font-mono font-medium"
                          style={{ color: 'var(--text-primary)' }}>
                          <Globe size={12} style={{ color: 'var(--text-muted)' }} />
                          {e.ip ?? '—'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{e.sessionCount}</td>
                      <td className="py-2 px-3 text-[12px]" style={{ color: 'var(--text-secondary)' }}>{e.uniqueUsers}</td>
                      <td className="py-2 px-3">
                        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          <div>{e.deviceCategories.filter(Boolean).join(', ') || '—'}</div>
                          <div>{e.browsers.filter(b => b && b !== 'Unknown').slice(0, 3).join(', ') || '—'}</div>
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        {e.securityEvents > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <Shield size={11} style={{ color: e.securityFailures > 0 ? 'var(--danger)' : 'var(--text-muted)' }} />
                            <span className="text-[11px]" style={{ color: e.securityFailures > 0 ? 'var(--danger-text)' : 'var(--text-secondary)' }}>
                              {e.securityEvents} ({e.securityFailures} failures)
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        <div>{e.firstSeen ? formatRelativeTime(e.firstSeen) : '—'}</div>
                        <div>{e.lastSeen ? formatRelativeTime(e.lastSeen) : '—'}</div>
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
