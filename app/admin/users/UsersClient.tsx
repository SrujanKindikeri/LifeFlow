'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Search, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import {
  AdminCard, SectionHeader, ErrorState, LoadingSpinner,
  StatusBadge, ConfirmDialog, Pagination, EmptyState,
} from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'
import type { AdminRole } from '@/models/AdminUser'

interface UserRow {
  _id: string; publicId: string; name: string; email: string;
  // lean() docs that predate the accountStatus field arrive as undefined —
  // widen the type here so TypeScript forces callers to handle that case.
  accountStatus: string | undefined; emailVerified: boolean;
  twoFactorEnabled: boolean; emailOtpEnabled: boolean;
  createdAt: string; updatedAt: string;
  deletedAt: string | null; scheduledPermanentDeletionAt: string | null;
}

interface UserDetail extends UserRow {
  currency: string; timezone: string; notificationsTested: boolean;
  upiId: string | null; emailNotifications: { enabled: boolean };
}

export function UsersClient({ adminRole }: { adminRole: AdminRole }) {
  const [users, setUsers]         = useState<UserRow[]>([])
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(1)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [q, setQ]                 = useState('')
  const [status, setStatus]       = useState('all')
  const [expanded, setExpanded]   = useState<string | null>(null)
  const [detail, setDetail]       = useState<UserDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [confirm, setConfirm]     = useState<{ userId: string; action: string; userName: string } | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const limit = 25

  const canModify = adminRole === 'super_admin' || adminRole === 'admin'

  // load always receives explicit values so it never reads stale state.
  const load = useCallback(async (opts: { page: number; q: string; status: string }) => {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({
        page:   String(opts.page),
        limit:  String(limit),
        status: opts.status,
      })
      if (opts.q.trim()) params.set('q', opts.q.trim())
      const res  = await fetch(`/api/admin/users?${params}`)
      const json = await res.json() as { users?: UserRow[]; total?: number; error?: { message?: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load users')
      // Filter out records without a stable _id (malformed docs) so the table
      // never crashes on missing keys or undefined fields.
      const safeUsers = (json.users ?? []).filter(
        (u): u is UserRow => typeof u._id === 'string' && u._id.length > 0
      )
      setUsers(safeUsers); setTotal(json.total ?? 0)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load users') }
    finally { setLoading(false) }
  }, [limit])

  // Initial load + re-fetch whenever page, q, or status changes.
  useEffect(() => {
    void load({ page, q, status })
  // load is stable (useCallback with only `limit`). All three search params
  // are listed so any change — pagination, filter, or a programmatic reset —
  // triggers a fresh fetch with the correct values.
  }, [page, q, status, load])

  // When filter changes reset to page 1. The useEffect([page, q, status]) will
  // pick up both new values in the same batch and fire one fetch.
  function handleStatusChange(newStatus: string) {
    setStatus(newStatus)
    setPage(1)
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    setPage(1)
    // If page is already 1, setPage(1) is a no-op and the effect won't fire.
    // Force a reload by calling load directly with current q.
    void load({ page: 1, q, status })
  }

  function handleRefresh() {
    void load({ page, q, status })
  }

  async function loadDetail(userId: string) {
    if (expanded === userId) { setExpanded(null); setDetail(null); return }
    setExpanded(userId); setDetailLoading(true)
    try {
      const res  = await fetch(`/api/admin/users/${userId}`)
      const json = await res.json() as { user?: UserDetail }
      setDetail(json.user ?? null)
    } catch { setDetail(null) }
    finally { setDetailLoading(false) }
  }

  async function performAction() {
    if (!confirm) return
    setActionLoading(true)
    try {
      const res  = await fetch(`/api/admin/users/${confirm.userId}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: confirm.action }),
      })
      const json = await res.json() as { error?: { message?: string } }
      if (!res.ok) throw new Error(json.error?.message ?? 'Action failed')
      setActionMsg(`${confirm.action} applied to ${confirm.userName}`)
      setConfirm(null)
      setExpanded(null); setDetail(null)
      void load({ page, q, status })
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Action failed')
      setConfirm(null)
    }
    finally { setActionLoading(false) }
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <AdminCard padding="sm">
        <form onSubmit={handleSearch} className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, email, or LF-ID…"
              aria-label="Search users"
              className="w-full pl-8 pr-3 py-2 text-[13px] rounded-xl outline-none"
              style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
          </div>
          <select
            aria-label="Filter by account status"
            value={status} onChange={(e) => handleStatusChange(e.target.value)}
            className="px-3 py-2 text-[13px] rounded-xl outline-none"
            style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="deleted">Deleted</option>
          </select>
          <button type="submit"
            className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}>
            Search
          </button>
          <button type="button" onClick={handleRefresh}
            className="p-2 rounded-xl" style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            <RefreshCw size={14} />
          </button>
        </form>
      </AdminCard>

      {/* Feedback */}
      {actionMsg && (
        <div className="rounded-xl px-4 py-3 text-[13px]"
          style={{ background: actionMsg.includes('failed') ? 'var(--danger-dim)' : 'var(--success-dim)',
            border: '1px solid rgba(0,0,0,0.08)', color: actionMsg.includes('failed') ? 'var(--danger-text)' : 'var(--success-text)' }}>
          {actionMsg}
          <button onClick={() => setActionMsg(null)} className="ml-3 font-bold">×</button>
        </div>
      )}

      {/* Table */}
      <div>
        <SectionHeader title={`Users (${total})`} />
        {loading ? (
          <div className="flex justify-center py-12"><LoadingSpinner /></div>
        ) : error ? (
          <div className="space-y-2">
            <ErrorState message={error} />
            <div className="flex justify-end">
              <button
                onClick={handleRefresh}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium transition-colors"
                style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          </div>
        )
        : users.length === 0 ? <EmptyState message="No users found." />
        : (
          <AdminCard padding="sm">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['LF-ID', 'Name', 'Email', 'Status', '2FA', 'Joined', 'Actions'].map((h) => (
                      <th key={h} className="text-left py-2 px-3 font-semibold text-[11px] uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <React.Fragment key={user._id}>
                      <tr
                        key={`${user._id}-row`}
                        className="transition-colors hover:bg-black/[0.02] cursor-pointer"
                        style={{ borderBottom: '1px solid var(--border-subtle)' }}
                        onClick={() => loadDetail(user._id)}
                      >
                        <td className="py-2.5 px-3 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{user.publicId}</td>
                        <td className="py-2.5 px-3 font-medium" style={{ color: 'var(--text-primary)' }}>{user.name}</td>
                        <td className="py-2.5 px-3" style={{ color: 'var(--text-secondary)' }}>{user.email}</td>
                        <td className="py-2.5 px-3"><StatusBadge status={user.accountStatus} /></td>
                        <td className="py-2.5 px-3">
                          {(user.twoFactorEnabled || user.emailOtpEnabled)
                            ? <span className="text-[10px] font-semibold" style={{ color: 'var(--success)' }}>ON</span>
                            : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                        </td>
                        <td className="py-2.5 px-3" style={{ color: 'var(--text-muted)' }}>{formatRelativeTime(user.createdAt)}</td>
                        <td className="py-2.5 px-3">
                          <button className="p-1 rounded transition-colors" style={{ color: 'var(--text-muted)' }}>
                            {expanded === user._id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        </td>
                      </tr>

                      {/* Expanded detail row */}
                      {expanded === user._id && (
                        <tr key={`${user._id}-detail`}>
                          <td colSpan={7} className="px-3 pb-3">
                            {detailLoading ? (
                              <div className="flex justify-center py-4"><LoadingSpinner size="sm" /></div>
                            ) : detail ? (
                              <div className="rounded-xl p-4 mt-1 space-y-3"
                                style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)' }}>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-[12px]">
                                  <div><span style={{ color: 'var(--text-muted)' }}>Currency:</span> <strong>{detail.currency}</strong></div>
                                  <div><span style={{ color: 'var(--text-muted)' }}>Timezone:</span> <strong>{detail.timezone}</strong></div>
                                  <div><span style={{ color: 'var(--text-muted)' }}>Email Verified:</span> <strong>{detail.emailVerified ? 'Yes' : 'No'}</strong></div>
                                  <div><span style={{ color: 'var(--text-muted)' }}>Notif Tested:</span> <strong>{detail.notificationsTested ? 'Yes' : 'No'}</strong></div>
                                  <div><span style={{ color: 'var(--text-muted)' }}>Email Notifs:</span> <strong>{detail.emailNotifications?.enabled ? 'On' : 'Off'}</strong></div>
                                  {detail.deletedAt && (
                                    <div><span style={{ color: 'var(--text-muted)' }}>Deleted:</span> <strong>{new Date(detail.deletedAt).toLocaleDateString()}</strong></div>
                                  )}
                                  {detail.scheduledPermanentDeletionAt && (
                                    <div><span style={{ color: 'var(--text-muted)' }}>Perm delete:</span> <strong style={{ color: 'var(--danger)' }}>{new Date(detail.scheduledPermanentDeletionAt).toLocaleDateString()}</strong></div>
                                  )}
                                </div>

                                {canModify && (
                                  <div className="flex gap-2 flex-wrap pt-1">
                                    {detail.accountStatus === 'active' && (
                                      <button
                                        onClick={() => setConfirm({ userId: detail._id, action: 'suspend', userName: detail.name })}
                                        className="px-3 py-1.5 rounded-lg text-[12px] font-medium"
                                        style={{ background: 'var(--danger-dim)', border: '1px solid rgba(220,38,38,0.18)', color: 'var(--danger-text)' }}
                                      >
                                        Suspend Account
                                      </button>
                                    )}
                                    {detail.accountStatus === 'deleted' && (
                                      <button
                                        onClick={() => setConfirm({ userId: detail._id, action: 'restore', userName: detail.name })}
                                        className="px-3 py-1.5 rounded-lg text-[12px] font-medium"
                                        style={{ background: 'var(--success-dim)', border: '1px solid rgba(22,163,74,0.18)', color: 'var(--success-text)' }}
                                      >
                                        Restore Account
                                      </button>
                                    )}
                                    {detail.accountStatus === 'active' && (
                                      <button
                                        onClick={() => setConfirm({ userId: detail._id, action: 'activate', userName: detail.name })}
                                        className="px-3 py-1.5 rounded-lg text-[12px] font-medium"
                                        style={{ background: 'var(--success-dim)', border: '1px solid rgba(22,163,74,0.18)', color: 'var(--success-text)' }}
                                      >
                                        Force Activate
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} hasMore={page * limit < total} total={total} limit={limit}
              onPrev={() => setPage((p) => p - 1)} onNext={() => setPage((p) => p + 1)} />
          </AdminCard>
        )}
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={`Confirm: ${confirm?.action}`}
        message={`Are you sure you want to ${confirm?.action} the account for "${confirm?.userName}"? This action will be recorded in the audit log.`}
        confirmLabel={confirm?.action === 'suspend' || confirm?.action === 'delete' ? 'Yes, proceed' : 'Yes, restore'}
        danger={confirm?.action === 'suspend' || confirm?.action === 'delete'}
        loading={actionLoading}
        onConfirm={performAction}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
