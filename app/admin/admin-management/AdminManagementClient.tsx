'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, UserX } from 'lucide-react'
import { AdminCard, SectionHeader, ErrorState, LoadingSpinner, StatusBadge, EmptyState, ConfirmDialog } from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'
import type { AdminRole } from '@/models/AdminUser'

interface AdminRow {
  _id: string; name: string; email: string; role: AdminRole;
  isActive: boolean; lastLoginAt: string | null; createdAt: string
}

const ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: 'Super Admin', admin: 'Admin', support: 'Support', auditor: 'Auditor'
}

export function AdminManagementClient({ currentAdminId, adminRole }: { currentAdminId: string; adminRole: AdminRole }) {
  const [admins, setAdmins]   = useState<AdminRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState<string | null>(null)
  const [deactivateId, setDeactivateId] = useState<string | null>(null)
  const [deactivating, setDeactivating] = useState(false)
  const isSuperAdmin = adminRole === 'super_admin'

  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'admin' as AdminRole })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/admin/admins')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setAdmins(json.admins)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setMsg(null)
    try {
      const res  = await fetch('/api/admin/admins', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setMsg('Administrator created successfully.'); setShowForm(false)
      setForm({ name: '', email: '', password: '', role: 'admin' })
      void load()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  async function handleDeactivate() {
    if (!deactivateId) return
    setDeactivating(true)
    try {
      const res  = await fetch(`/api/admin/admins/${deactivateId}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setMsg('Administrator deactivated.'); void load()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Failed') }
    finally { setDeactivating(false); setDeactivateId(null) }
  }

  if (!isSuperAdmin) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: 'var(--danger-dim)', color: 'var(--danger-text)' }}>
        Only Super Admins can access administrator management.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {msg && (
        <div className="rounded-xl px-4 py-2.5 text-[12px]"
          style={{ background: msg.includes('success') || msg.includes('deactivated') ? 'var(--success-dim)' : 'var(--danger-dim)',
            color: msg.includes('success') || msg.includes('deactivated') ? 'var(--success-text)' : 'var(--danger-text)',
            border: '1px solid rgba(0,0,0,0.06)' }}>
          {msg} <button onClick={() => setMsg(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <SectionHeader title="Administrators" subtitle="Manage admin accounts — super_admin only" />
        <button onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[13px] font-semibold text-white"
          style={{ background: 'var(--accent)' }}>
          <Plus size={14} /> Add Admin
        </button>
      </div>

      {showForm && (
        <AdminCard>
          <form onSubmit={handleCreate} className="space-y-3">
            <p className="text-[13px] font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>New Administrator</p>
            <div className="grid grid-cols-2 gap-3">
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Full name" required maxLength={100}
                className="px-3 py-2 text-[13px] rounded-xl outline-none"
                style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                type="email" placeholder="Email address" required maxLength={255}
                className="px-3 py-2 text-[13px] rounded-xl outline-none"
                style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                type="password" placeholder="Password (min 12 chars)" required minLength={12} maxLength={128}
                autoComplete="new-password"
                className="px-3 py-2 text-[13px] rounded-xl outline-none"
                style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as AdminRole }))}
                className="px-3 py-2 text-[13px] rounded-xl outline-none"
                style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                <option value="admin">Admin</option>
                <option value="support">Support</option>
                <option value="auditor">Auditor</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}>
                {saving ? 'Creating…' : 'Create Administrator'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-xl text-[13px] font-medium"
                style={{ color: 'var(--text-muted)' }}>Cancel</button>
            </div>
          </form>
        </AdminCard>
      )}

      {loading ? <div className="flex justify-center py-12"><LoadingSpinner /></div>
      : error ? <ErrorState message={error} />
      : !admins.length ? <EmptyState message="No administrators found." />
      : (
        <AdminCard padding="sm">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Name', 'Email', 'Role', 'Status', 'Last Login', 'Actions'].map((h) => (
                    <th key={h} className="text-left py-2 px-3 text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {admins.map((adm) => (
                  <tr key={adm._id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td className="py-2.5 px-3 font-medium" style={{ color: 'var(--text-primary)' }}>
                      {adm.name} {adm._id === currentAdminId && <span style={{ color: 'var(--accent)', fontSize: 10 }}>(you)</span>}
                    </td>
                    <td className="py-2.5 px-3" style={{ color: 'var(--text-secondary)' }}>{adm.email}</td>
                    <td className="py-2.5 px-3"><StatusBadge status={adm.role} /></td>
                    <td className="py-2.5 px-3">
                      <span className="text-[11px] font-semibold" style={{ color: adm.isActive ? 'var(--success)' : 'var(--danger)' }}>
                        {adm.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3" style={{ color: 'var(--text-muted)' }}>
                      {adm.lastLoginAt ? formatRelativeTime(adm.lastLoginAt) : '—'}
                    </td>
                    <td className="py-2.5 px-3">
                      {adm.isActive && adm._id !== currentAdminId && (
                        <button onClick={() => setDeactivateId(adm._id)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium"
                          style={{ background: 'var(--danger-dim)', color: 'var(--danger-text)', border: '1px solid rgba(220,38,38,0.18)' }}>
                          <UserX size={11} /> Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}

      <ConfirmDialog open={!!deactivateId} title="Deactivate Administrator"
        message="This will prevent this administrator from logging in. The final active super_admin cannot be deactivated."
        confirmLabel="Deactivate" danger loading={deactivating}
        onConfirm={handleDeactivate} onCancel={() => setDeactivateId(null)} />
    </div>
  )
}
