/**
 * Shared client component for feature monitoring pages
 * (Notes, Tasks, Habits, Projects, Expenses, Subscriptions).
 */
'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { AdminCard, SectionHeader, ErrorState, LoadingSpinner } from './AdminCard'
import { formatRelativeTime } from '@/lib/utils'

interface FeaturePageProps {
  module: string
  title:  string
  stats:  Array<{ key: string; label: string; color?: string }>
  notes?: string[]
}

export function FeaturePage({ module, title, stats, notes }: FeaturePageProps) {
  const [data, setData]       = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/admin/features?module=${module}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setData(json[module] as Record<string, unknown>)
      setGeneratedAt(json.generatedAt as string)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false); setRefreshing(false) }
  }, [module])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        {generatedAt && (
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Updated {formatRelativeTime(generatedAt)}
          </p>
        )}
        <button onClick={() => load(true)} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium ml-auto"
          style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <SectionHeader title={title} subtitle="Aggregate counts — no user content accessed" />

      {loading ? <div className="flex justify-center py-12"><LoadingSpinner /></div>
      : error ? <ErrorState message={error} />
      : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {stats.map((s) => {
            const val = data?.[s.key]
            return (
              <AdminCard key={s.key}>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-1"
                  style={{ color: 'var(--text-muted)' }}>{s.label}</p>
                <p className="text-[26px] font-bold leading-none"
                  style={{ color: s.color ?? 'var(--text-primary)' }}>
                  {val !== undefined ? String(val) : '—'}
                </p>
              </AdminCard>
            )
          })}
        </div>
      )}

      {notes && notes.length > 0 && (
        <AdminCard>
          <ul className="space-y-1">
            {notes.map((note, i) => (
              <li key={i} className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                • {note}
              </li>
            ))}
          </ul>
        </AdminCard>
      )}
    </div>
  )
}
