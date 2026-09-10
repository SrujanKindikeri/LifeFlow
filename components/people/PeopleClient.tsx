'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, Plus, Pencil, Trash2, Search, Phone, Mail, ChevronDown, ChevronUp } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea } from '@/components/ui/GlassInput'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatPaise } from '@/lib/moneyCalculator'

interface Person {
  _id: string; name: string; phone?: string; email?: string; lifeFlowId?: string; notes?: string
  moneyGivenMinor: number; moneyGivenRemainingMinor: number
  moneyBorrowedMinor: number; moneyBorrowedRemainingMinor: number
  groupBillShareMinor: number; moneyRecordCount: number; groupBillCount: number
}

function PersonForm({ initial, onSave, onClose, loading }: {
  initial?: Partial<Person>; onSave:(d:Partial<Person>)=>void; onClose:()=>void; loading:boolean
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '', phone: initial?.phone ?? '',
    email: initial?.email ?? '', lifeFlowId: initial?.lifeFlowId ?? '', notes: initial?.notes ?? '',
  })
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }))
  return (
    <div className="flex flex-col gap-4">
      <GlassInput label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" required />
      <div className="grid grid-cols-2 gap-3">
        <GlassInput label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 …" />
        <GlassInput label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="…@example.com" />
      </div>
      <GlassInput label="LifeFlow ID (optional)" value={form.lifeFlowId} onChange={(e) => set('lifeFlowId', e.target.value)} placeholder="LF-XXXXXXXX" />
      <GlassTextarea label="Notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
      <div className="flex gap-2.5 justify-end">
        <GlassButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlassButton>
        <GlassButton variant="primary" size="sm" loading={loading} onClick={() => onSave(form)}>
          {initial?._id ? 'Save' : 'Add Person'}
        </GlassButton>
      </div>
    </div>
  )
}

export function PeopleClient() {
  const { success, error: showError } = useToast()
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Person | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Person | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async (q?: string) => {
    setLoading(true)
    try {
      const url = q ? `/api/people?q=${encodeURIComponent(q)}` : '/api/people'
      const res = await fetch(url)
      const data = await res.json()
      setPeople(data.people ?? [])
    } catch { showError('Failed to load') }
    finally { setLoading(false) }
  }, [showError])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const t = setTimeout(() => load(search || undefined), 300)
    return () => clearTimeout(t)
  }, [search, load])

  async function save(form: Partial<Person>) {
    if (!form.name?.trim()) { showError('Name required'); return }
    setSaving(true)
    try {
      const url = editing ? `/api/people/${editing._id}` : '/api/people'
      const res = await fetch(url, { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      success(editing ? 'Updated' : 'Person added')
      setModalOpen(false); setEditing(null); load(search || undefined)
    } catch (e) { showError(e instanceof Error ? e.message : 'Failed') }
    finally { setSaving(false) }
  }

  async function del() {
    if (!deleteTarget) return
    await fetch(`/api/people/${deleteTarget._id}`, { method: 'DELETE' })
    success('Deleted'); setDeleteTarget(null); load(search || undefined)
  }

  function initials(name: string) {
    return name.split(' ').slice(0,2).map((w)=>w[0]).join('').toUpperCase()
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>People</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Your financial contacts directory</p>
        </div>
        <GlassButton variant="primary" icon={<Plus size={15} />} onClick={() => { setEditing(null); setModalOpen(true) }}>Add Person</GlassButton>
      </div>

      <GlassInput placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} leftIcon={<Search size={14} />} />

      {loading ? (
        <div className="flex flex-col gap-3">{[1,2,3].map((i)=><div key={i} className="glass rounded-2xl h-20 animate-pulse" style={{background:'rgba(0,0,0,0.04)'}}/>)}</div>
      ) : people.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 py-16 text-center">
          <Users size={40} style={{ color: 'var(--text-faint)' }} />
          <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{search ? 'No people found' : 'No people yet'}</p>
          {!search && <GlassButton variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => { setEditing(null); setModalOpen(true) }}>Add Person</GlassButton>}
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence>
            {people.map((p) => {
              const expanded = expandedId === p._id
              const hasFinancials = p.moneyRecordCount > 0 || p.groupBillCount > 0
              return (
                <motion.div key={p._id} layout initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}>
                  <GlassCard padding="md">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold text-white" style={{ background: 'var(--accent)' }}>
                        {initials(p.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                        <div className="flex gap-3 mt-0.5">
                          {p.phone && <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-faint)' }}><Phone size={10}/>{p.phone}</span>}
                          {p.email && <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-faint)' }}><Mail size={10}/>{p.email}</span>}
                          {p.lifeFlowId && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--accent-text)' }}>{p.lifeFlowId}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        {hasFinancials && (
                          <button onClick={() => setExpandedId(expanded ? null : p._id)} className="p-1.5 rounded-lg hover:bg-black/[0.05]" style={{ color: 'var(--text-muted)' }}>
                            {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                          </button>
                        )}
                        <button onClick={() => { setEditing(p); setModalOpen(true) }} className="p-1.5 rounded-lg hover:bg-black/[0.05]" style={{ color: 'var(--text-muted)' }}><Pencil size={12}/></button>
                        <button onClick={() => setDeleteTarget(p)} className="p-1.5 rounded-lg hover:bg-red-50" style={{ color: 'var(--danger)' }}><Trash2 size={12}/></button>
                      </div>
                    </div>

                    <AnimatePresence>
                      {expanded && hasFinancials && (
                        <motion.div initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }} exit={{ height:0, opacity:0 }} transition={{ duration:0.2 }} className="overflow-hidden">
                          <div className="pt-3 mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3" style={{ borderTop: '1px solid var(--border)' }}>
                            {p.moneyGivenMinor > 0 && (
                              <div className="rounded-xl p-2.5" style={{ background: 'rgba(22,163,74,0.08)' }}>
                                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--success-text)' }}>They owe you</p>
                                <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{formatPaise(p.moneyGivenRemainingMinor)}</p>
                                <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>of {formatPaise(p.moneyGivenMinor)}</p>
                              </div>
                            )}
                            {p.moneyBorrowedMinor > 0 && (
                              <div className="rounded-xl p-2.5" style={{ background: 'rgba(220,38,38,0.08)' }}>
                                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--danger-text)' }}>You owe them</p>
                                <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{formatPaise(p.moneyBorrowedRemainingMinor)}</p>
                                <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>of {formatPaise(p.moneyBorrowedMinor)}</p>
                              </div>
                            )}
                            {p.groupBillShareMinor > 0 && (
                              <div className="rounded-xl p-2.5" style={{ background: 'rgba(59,130,246,0.08)' }}>
                                <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--accent-text)' }}>Group Bill Share</p>
                                <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{formatPaise(p.groupBillShareMinor)}</p>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </GlassCard>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); setEditing(null) }} title={editing ? 'Edit Person' : 'Add Person'} size="md">
        <PersonForm initial={editing ?? undefined} onSave={save} onClose={() => { setModalOpen(false); setEditing(null) }} loading={saving} />
      </Modal>
      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={del} title="Remove Person" message={`Remove "${deleteTarget?.name}" from your directory?`} confirmLabel="Remove" danger />
    </div>
  )
}

