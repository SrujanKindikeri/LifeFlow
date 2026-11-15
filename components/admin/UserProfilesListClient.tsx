'use client'

/**
 * UserProfilesListClient.tsx — Searchable user list that links to per-user intelligence pages.
 * Fetches from the existing /api/admin/users endpoint (SAFE_PROJECTION — no secrets).
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, RefreshCw, User, ChevronRight, Activity } from 'lucide-react'
import {
  AdminCard, SectionHeader, ErrorState, LoadingSpinner,
  EmptyState, Pagination, StatusBadge,
} from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'

interface UserRow {
  _id: string; publicId: string; name: string; email: string
  accountStatus: string; emailVerified: boolean; createdAt: string
}

interface UsersData { users: UserRow[]; total: number; page: number; limit: number; hasMore: boolean }

export function UserProfilesListClient() {
  const router = useRouter()
  const [data, setData]         = useState<UsersData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [page, setPage]         = useState(1)
  const [search, setSearch]     = useState('')

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({ page: String(page), limit: '25' })
      if (search) p.set('q', search)
      const res  = await fetch(`/api/admin/users?${p}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setData(json as UsersData)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false); setRefreshing(false) }
  }, [page, search])

  useEffect(() => { void load() }, [load])

  const users = data?.users ?? []

  return (
    <div className="space-y-5">
      <SectionHeader title="User Profiles" subtitle="Select a user to view their detailed intelligence profile" />

      {/* Search + refresh */}
      <AdminCard padding="sm">
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[220px]"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 10px' }}>
            <Search size={13} style={{ color: 'var(--text-muted)' }} />
            <input
              placeholder="Search by name, email, or publicId…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              className="flex-1 bg-transparent text-[12px] outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
          <button
            onClick={() => void load(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />Refresh
          </button>
        </div>
      </AdminCard>

      {/* User list */}
      <AdminCard padding="sm">
        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner /></div>
        ) : error ? (
          <ErrorState message={error} />
        ) : users.length === 0 ? (
          <EmptyState message="No users found." />
        ) : (
          <>
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {users.map(u => (
                <button
                  key={u._id}
                  onClick={() => router.push(`/admin/user-profiles/${encodeURIComponent(u.publicId)}`)}
                  className="w-full flex items-center justify-between gap-3 py-3 px-2 rounded-xl transition-colors text-left hover:brightness-105"
                  style={{ background: 'transparent' }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                      style={{ background: 'var(--accent-dim)', color: 'var(--accent-text)' }}
                      aria-hidden="true"
                    >
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{u.name}</p>
                      <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{u.email} · {u.publicId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <StatusBadge status={u.accountStatus} />
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {formatRelativeTime(u.createdAt)}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] font-medium"
                      style={{ color: 'var(--accent)' }}>
                      <Activity size={11} />View
                    </span>
                    <ChevronRight size={13} style={{ color: 'var(--text-muted)' }} />
                  </div>
                </button>
              ))}
            </div>
            {data && (
              <Pagination
                page={data.page} hasMore={data.hasMore} total={data.total} limit={data.limit}
                onPrev={() => setPage(p => p - 1)} onNext={() => setPage(p => p + 1)}
              />
            )}
          </>
        )}
      </AdminCard>
    </div>
  )
}
