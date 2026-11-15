'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Check } from 'lucide-react'
import { AdminCard, SectionHeader, ErrorState, LoadingSpinner, StatusBadge, EmptyState, ConfirmDialog } from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'
import type { AdminRole } from '@/models/AdminUser'

interface Announcement {
  _id: string; title: string; body: string; type: string; status: string;
  scheduledAt: string | null; expiresAt: string | null; createdByName: string; createdAt: string
}

export function AnnouncementsClient({ adminRole }: { adminRole: AdminRole }) {
  const [items, setItems]     = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const canEdit = adminRole === 'super_admin' || adminRole === 'admin'

  const [form, setForm] = useState({ title: '', body: '', type: 'info', status: 'draft', expiresAt: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch('/api/admin/announcements')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setItems(json.announcements)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setSaveMsg(null)
    try {
      const res  = await fetch('/api/admin/announcements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, expiresAt: form.expiresAt || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed')
      setSaveMsg('Announcement created.'); setShowForm(false)
      setForm({ title: '', body: '', type: 'info', status: 'draft', expiresAt: '' })
      void load()
    } catch (e) { setSaveMsg(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  async function publishItem(id: string) {
    await fetch(`/api/admin/announcements/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'published' }),
    })
    void load()
  }

  async function deleteItem() {
    if (!delConfirm) return
    setDeleting(true)
    await fetch(`/api/admin/announcements/${delConfirm}`, { method: 'DELETE' })
    setDelConfirm(null); setDeleting(false); void load()
  }

  return (
    <div className="space-y-4">
      {saveMsg && (
        <div className="rounded-xl px-4 py-2.5 text-[12px]"
          style={{ background: saveMsg.includes('failed') || saveMsg.includes('Failed') ? 'var(--danger-dim)' : 'var(--success-dim)',
            color: saveMsg.includes('failed') || saveMsg.includes('Failed') ? 'var(--danger-text)' : 'var(--success-text)',
            border: '1px solid rgba(0,0,0,0.06)' }}>
          {saveMsg} <button onClick={() => setSaveMsg(null)} className="ml-2 font-bold">×</button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <SectionHeader title="Announcements" />
        {canEdit && (
          <button onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[13px] font-semibold text-white"
            style={{ background: 'var(--accent)' }}>
            <Plus size={14} /> New
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <AdminCard>
          <form onSubmit={handleCreate} className="space-y-3">
            <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Title" required maxLength={200}
              className="w-full px-3 py-2 text-[13px] rounded-xl outline-none"
              style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            <textarea value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder="Message body" required maxLength={2000} rows={3}
              className="w-full px-3 py-2 text-[13px] rounded-xl outline-none resize-none"
              style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            <div className="flex gap-2 flex-wrap">
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className="px-3 py-2 text-[13px] rounded-xl outline-none"
                style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="success">Success</option>
                <option value="maintenance">Maintenance</option>
              </select>
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="px-3 py-2 text-[13px] rounded-xl outline-none"
                style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                <option value="draft">Draft</option>
                <option value="published">Publish immediately</option>
              </select>
              <input type="datetime-local" value={form.expiresAt}
                onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                placeholder="Expires at (optional)"
                className="px-3 py-2 text-[13px] rounded-xl outline-none"
                style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving}
                className="px-4 py-2 rounded-xl text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}>
                {saving ? 'Saving…' : 'Create Announcement'}
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
      : !items.length ? <EmptyState message="No announcements yet." />
      : (
        <AdminCard padding="sm">
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {items.map((item) => (
              <div key={item._id} className="py-3 px-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={item.status} />
                      <StatusBadge status={item.type} />
                    </div>
                    <p className="font-semibold text-[13px]" style={{ color: 'var(--text-primary)' }}>{item.title}</p>
                    <p className="text-[12px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{item.body}</p>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>
                      by {item.createdByName} · {formatRelativeTime(item.createdAt)}
                      {item.expiresAt && ` · expires ${new Date(item.expiresAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 shrink-0">
                      {item.status === 'draft' && (
                        <button onClick={() => publishItem(item._id)}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: 'var(--success)', background: 'var(--success-dim)' }}
                          title="Publish">
                          <Check size={13} />
                        </button>
                      )}
                      <button onClick={() => setDelConfirm(item._id)}
                        className="p-1.5 rounded-lg transition-colors"
                        style={{ color: 'var(--danger-text)', background: 'var(--danger-dim)' }}
                        title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      <ConfirmDialog open={!!delConfirm} title="Delete Announcement"
        message="Are you sure you want to permanently delete this announcement?"
        confirmLabel="Delete" danger loading={deleting}
        onConfirm={deleteItem} onCancel={() => setDelConfirm(null)} />
    </div>
  )
}
