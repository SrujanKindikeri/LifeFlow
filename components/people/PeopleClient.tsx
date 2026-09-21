'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, Plus, Pencil, Trash2, Search, Phone, Mail,
  ChevronDown, ChevronUp, Copy, Check, UserSearch, UserPlus,
  ArrowLeft, Fingerprint,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea } from '@/components/ui/GlassInput'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatPaise } from '@/lib/moneyCalculator'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Person {
  _id: string
  name: string
  phone?: string
  email?: string
  /** The contact's LifeFlow ID — maps to `linkedLifeFlowId` on the server. */
  linkedLifeFlowId?: string
  source?: 'manual' | 'lifeflow'
  notes?: string
  moneyGivenMinor: number
  moneyGivenRemainingMinor: number
  moneyBorrowedMinor: number
  moneyBorrowedRemainingMinor: number
  groupBillShareMinor: number
  moneyRecordCount: number
  groupBillCount: number
}

interface LookupResult {
  name: string
  lifeFlowId: string
  maskedEmail: string
  alreadyAdded: boolean
}

// ─── Add-mode selector ────────────────────────────────────────────────────────

type AddMode = 'choose' | 'manual' | 'lifeflow'

// ─── Manual entry form ────────────────────────────────────────────────────────

interface ManualFormProps {
  onSave: (d: { name: string; phone: string; email: string; notes: string }) => void
  onBack: () => void
  onClose: () => void
  loading: boolean
}

function ManualForm({ onSave, onBack, onClose, loading }: ManualFormProps) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' })
  const [nameError, setNameError] = useState('')

  const set = (k: keyof typeof form, v: string) => {
    setForm((p) => ({ ...p, [k]: v }))
    if (k === 'name' && v.trim()) setNameError('')
  }

  function handleSave() {
    if (!form.name.trim()) { setNameError('Name is required'); return }
    onSave(form)
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs self-start -mt-1 mb-0.5 rounded-lg px-1 py-0.5 hover:bg-black/[0.04] transition-colors"
        style={{ color: 'var(--text-muted)' }}
      >
        <ArrowLeft size={12} /> Back
      </button>

      <GlassInput
        label="Name"
        value={form.name}
        onChange={(e) => set('name', e.target.value)}
        placeholder="Full name"
        error={nameError}
        autoFocus
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <GlassInput
          label="Phone"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          placeholder="+91 …"
        />
        <GlassInput
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          placeholder="…@example.com"
        />
      </div>
      <GlassTextarea
        label="Notes"
        value={form.notes}
        onChange={(e) => set('notes', e.target.value)}
        rows={2}
        placeholder="Optional notes…"
      />
      <div className="flex gap-2.5 justify-end">
        <GlassButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlassButton>
        <GlassButton variant="primary" size="sm" loading={loading} onClick={handleSave}>
          Save Person
        </GlassButton>
      </div>
    </div>
  )
}

// ─── LifeFlow ID lookup form ──────────────────────────────────────────────────

interface LifeFlowFormProps {
  onAdd: (lifeFlowId: string) => void
  onBack: () => void
  onClose: () => void
  saving: boolean
}

function LifeFlowForm({ onAdd, onBack, onClose, saving }: LifeFlowFormProps) {
  const [inputId, setInputId] = useState('')
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null)
  const [looking, setLooking] = useState(false)
  const [lookupError, setLookupError] = useState('')

  function handleInput(v: string) {
    // Auto-uppercase, auto-insert dash after "LF" prefix if user types without it
    const cleaned = v.toUpperCase().replace(/[^A-Z0-9-]/g, '')
    setInputId(cleaned)
    setLookupResult(null)
    setLookupError('')
  }

  async function handleLookup() {
    const id = inputId.trim()
    if (!id) { setLookupError('Please enter a LifeFlow ID.'); return }
    if (!/^LF-[A-Z2-9]{8}$/.test(id)) {
      setLookupError('Please enter a valid LifeFlow ID (e.g. LF-AB3CD4EF).')
      return
    }
    setLooking(true)
    setLookupError('')
    setLookupResult(null)
    try {
      const res = await fetch(`/api/people/lookup?lifeflowId=${encodeURIComponent(id)}`)
      const data = await res.json()
      if (!res.ok) { setLookupError(data.error ?? 'Lookup failed.'); return }
      setLookupResult(data.person as LookupResult)
    } catch {
      setLookupError('Lookup failed. Please try again.')
    } finally {
      setLooking(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs self-start -mt-1 mb-0.5 rounded-lg px-1 py-0.5 hover:bg-black/[0.04] transition-colors"
        style={{ color: 'var(--text-muted)' }}
      >
        <ArrowLeft size={12} /> Back
      </button>

      <div className="flex flex-col gap-2">
        <GlassInput
          label="LifeFlow ID"
          value={inputId}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="LF-XXXXXXXX"
          error={lookupError}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') void handleLookup() }}
          leftIcon={<Fingerprint size={14} />}
        />
        <GlassButton
          variant="secondary"
          size="sm"
          loading={looking}
          onClick={() => void handleLookup()}
          fullWidth
        >
          {looking ? 'Finding person…' : 'Find Person'}
        </GlassButton>
      </div>

      <AnimatePresence>
        {lookupResult && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="rounded-2xl p-4 flex flex-col gap-3"
              style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.15)' }}
            >
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent-text)' }}>
                Person Found
              </p>
              <div className="flex flex-col gap-1.5">
                <Row label="Name" value={lookupResult.name} />
                <Row label="LifeFlow ID" value={lookupResult.lifeFlowId} mono />
                <Row label="Email" value={lookupResult.maskedEmail} />
              </div>

              {lookupResult.alreadyAdded ? (
                <p
                  className="text-xs rounded-xl px-3 py-2 text-center font-medium"
                  style={{ background: 'rgba(234,179,8,0.1)', color: 'rgb(161,119,0)' }}
                >
                  This person is already in your People.
                </p>
              ) : (
                <GlassButton
                  variant="primary"
                  size="sm"
                  fullWidth
                  loading={saving}
                  onClick={() => onAdd(lookupResult.lifeFlowId)}
                  icon={<UserPlus size={13} />}
                >
                  Add to People
                </GlassButton>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!lookupResult && (
        <div className="flex gap-2.5 justify-end">
          <GlassButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlassButton>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span
        className={`text-xs font-medium text-right truncate ${mono ? 'font-mono' : ''}`}
        style={{ color: 'var(--text-primary)' }}
      >
        {value}
      </span>
    </div>
  )
}

// ─── Add-mode chooser ─────────────────────────────────────────────────────────

function AddModeChooser({ onChoose, onClose }: { onChoose: (m: AddMode) => void; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Choose how to add a person:</p>
      <button
        onClick={() => onChoose('manual')}
        className="flex items-center gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-black/[0.04]"
        style={{ border: '1px solid var(--border)' }}
      >
        <span
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(59,130,246,0.1)' }}
        >
          <UserPlus size={18} style={{ color: 'var(--accent)' }} />
        </span>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Manual Entry</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Enter name, phone, email, and notes manually
          </p>
        </div>
      </button>

      <button
        onClick={() => onChoose('lifeflow')}
        className="flex items-center gap-3 rounded-2xl p-4 text-left transition-colors hover:bg-black/[0.04]"
        style={{ border: '1px solid var(--border)' }}
      >
        <span
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(99,102,241,0.1)' }}
        >
          <UserSearch size={18} style={{ color: 'rgb(99,102,241)' }} />
        </span>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>LifeFlow ID</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Add someone who has a LifeFlow account
          </p>
        </div>
      </button>

      <div className="flex justify-end pt-1">
        <GlassButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlassButton>
      </div>
    </div>
  )
}

// ─── Edit form (unchanged structure — manual fields only) ─────────────────────

interface EditFormProps {
  initial: Person
  onSave: (d: Partial<Person>) => void
  onClose: () => void
  loading: boolean
}

function EditForm({ initial, onSave, onClose, loading }: EditFormProps) {
  const [form, setForm] = useState({
    name:  initial.name,
    phone: initial.phone ?? '',
    email: initial.email ?? '',
    notes: initial.notes ?? '',
  })
  const [nameError, setNameError] = useState('')
  const set = (k: keyof typeof form, v: string) => {
    setForm((p) => ({ ...p, [k]: v }))
    if (k === 'name' && v.trim()) setNameError('')
  }

  function handleSave() {
    if (!form.name.trim()) { setNameError('Name is required'); return }
    onSave(form)
  }

  const isLifeFlow = initial.source === 'lifeflow'

  return (
    <div className="flex flex-col gap-4">
      {isLifeFlow && (
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs"
          style={{ background: 'rgba(99,102,241,0.07)', color: 'rgb(79,80,200)' }}
        >
          <Fingerprint size={12} />
          LifeFlow contact — some fields are set automatically.
        </div>
      )}
      <GlassInput
        label="Name"
        value={form.name}
        onChange={(e) => set('name', e.target.value)}
        placeholder="Full name"
        error={nameError}
        disabled={isLifeFlow}
      />
      {!isLifeFlow && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <GlassInput label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 …" />
            <GlassInput label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="…@example.com" />
          </div>
          <GlassTextarea label="Notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
        </>
      )}
      <div className="flex gap-2.5 justify-end">
        <GlassButton variant="ghost" size="sm" onClick={onClose}>Cancel</GlassButton>
        <GlassButton variant="primary" size="sm" loading={loading} onClick={handleSave}>
          Save
        </GlassButton>
      </div>
    </div>
  )
}

// ─── "Your LifeFlow ID" copy banner ──────────────────────────────────────────

function MyLifeFlowIdBanner() {
  const [myId, setMyId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => { if (d.user?.publicId) setMyId(d.user.publicId as string) })
      .catch(() => {/* silently ignore — banner is non-critical */})
  }, [])

  async function copy() {
    if (!myId) return
    try {
      await navigator.clipboard.writeText(myId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard not available — do nothing */
    }
  }

  if (!myId) return null

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
      style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.14)' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Fingerprint size={14} style={{ color: 'rgb(99,102,241)', flexShrink: 0 }} />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'rgb(99,102,241)' }}>
            Your LifeFlow ID
          </p>
          <p className="text-sm font-mono font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{myId}</p>
        </div>
      </div>
      <button
        onClick={() => void copy()}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl transition-colors hover:bg-black/[0.06] flex-shrink-0"
        style={{ color: copied ? 'var(--success-text)' : 'var(--text-muted)' }}
        aria-label="Copy your LifeFlow ID"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PeopleClient() {
  const { success, error: showError } = useToast()
  const [people, setPeople]       = useState<Person[]>([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [search, setSearch]       = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [addMode, setAddMode]     = useState<AddMode>('choose')
  const [editing, setEditing]     = useState<Person | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Person | null>(null)
  const [expandedId, setExpandedId]     = useState<string | null>(null)

  // ── Data loading ────────────────────────────────────────────────────────────
  const load = useCallback(async (q?: string) => {
    setLoading(true)
    try {
      const url = q ? `/api/people?q=${encodeURIComponent(q)}` : '/api/people'
      const res = await fetch(url)
      const data = await res.json() as { people?: Person[] }
      setPeople(data.people ?? [])
    } catch {
      showError('Failed to load people')
    } finally {
      setLoading(false)
    }
  }, [showError])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const t = setTimeout(() => void load(search || undefined), 300)
    return () => clearTimeout(t)
  }, [search, load])

  // ── Modal helpers ───────────────────────────────────────────────────────────
  function openAdd() {
    setEditing(null)
    setAddMode('choose')
    setModalOpen(true)
  }

  function openEdit(p: Person) {
    setEditing(p)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditing(null)
    setAddMode('choose')
  }

  // ── Save: manual ────────────────────────────────────────────────────────────
  async function saveManual(form: { name: string; phone: string; email: string; notes: string }) {
    setSaving(true)
    try {
      const res = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'manual', ...form }),
      })
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error) }
      success('Person added')
      closeModal()
      void load(search || undefined)
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to add person')
    } finally {
      setSaving(false)
    }
  }

  // ── Save: LifeFlow ID ───────────────────────────────────────────────────────
  async function saveLifeFlow(lifeFlowId: string) {
    setSaving(true)
    try {
      const res = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'lifeflow', linkedLifeFlowId: lifeFlowId }),
      })
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error) }
      success('Person added')
      closeModal()
      void load(search || undefined)
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to add person')
    } finally {
      setSaving(false)
    }
  }

  // ── Save: edit ──────────────────────────────────────────────────────────────
  async function saveEdit(form: Partial<Person>) {
    if (!editing) return
    setSaving(true)
    try {
      const res = await fetch(`/api/people/${editing._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error) }
      success('Updated')
      closeModal()
      void load(search || undefined)
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function del() {
    if (!deleteTarget) return
    try {
      await fetch(`/api/people/${deleteTarget._id}`, { method: 'DELETE' })
      success('Deleted')
      setDeleteTarget(null)
      void load(search || undefined)
    } catch {
      showError('Failed to delete')
    }
  }

  function initials(name: string) {
    return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  }

  // ── Modal title ─────────────────────────────────────────────────────────────
  const modalTitle = editing
    ? 'Edit Person'
    : addMode === 'manual'
      ? 'Manual Entry'
      : addMode === 'lifeflow'
        ? 'Add by LifeFlow ID'
        : 'Add Person'

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>People</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Your financial contacts directory</p>
        </div>
        <GlassButton variant="primary" icon={<Plus size={15} />} onClick={openAdd}>
          Add Person
        </GlassButton>
      </div>

      {/* Your LifeFlow ID banner */}
      <MyLifeFlowIdBanner />

      {/* Search */}
      <GlassInput
        placeholder="Search people…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        leftIcon={<Search size={14} />}
      />

      {/* List */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass rounded-2xl h-20 animate-pulse" style={{ background: 'rgba(0,0,0,0.04)' }} />
          ))}
        </div>
      ) : people.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 py-16 text-center">
          <Users size={40} style={{ color: 'var(--text-faint)' }} />
          <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
            {search ? 'No people found' : 'No people yet'}
          </p>
          {!search && (
            <GlassButton variant="primary" size="sm" icon={<Plus size={13} />} onClick={openAdd}>
              Add Person
            </GlassButton>
          )}
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence>
            {people.map((p) => {
              const expanded     = expandedId === p._id
              const hasFinancials = p.moneyRecordCount > 0 || p.groupBillCount > 0
              const isLifeFlow   = p.source === 'lifeflow'

              return (
                <motion.div
                  key={p._id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <GlassCard padding="md">
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold text-white"
                        style={{ background: isLifeFlow ? 'rgb(99,102,241)' : 'var(--accent)' }}
                      >
                        {initials(p.name)}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{p.name}</p>
                          {isLifeFlow && (
                            <span
                              className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full leading-none"
                              style={{ background: 'rgba(99,102,241,0.12)', color: 'rgb(79,80,200)' }}
                            >
                              LifeFlow
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                          {p.phone && (
                            <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
                              <Phone size={10} />{p.phone}
                            </span>
                          )}
                          {p.email && (
                            <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
                              <Mail size={10} />{p.email}
                            </span>
                          )}
                          {/* Fixed: was reading p.lifeFlowId (undefined) — now reads the correct field */}
                          {p.linkedLifeFlowId && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-full font-mono"
                              style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--accent-text)' }}
                            >
                              {p.linkedLifeFlowId}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-0.5">
                        {hasFinancials && (
                          <button
                            onClick={() => setExpandedId(expanded ? null : p._id)}
                            className="p-1.5 rounded-lg hover:bg-black/[0.05]"
                            style={{ color: 'var(--text-muted)' }}
                            aria-label={expanded ? 'Collapse' : 'Expand financials'}
                          >
                            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(p)}
                          className="p-1.5 rounded-lg hover:bg-black/[0.05]"
                          style={{ color: 'var(--text-muted)' }}
                          aria-label="Edit"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(p)}
                          className="p-1.5 rounded-lg hover:bg-red-50"
                          style={{ color: 'var(--danger)' }}
                          aria-label="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Financial expansion */}
                    <AnimatePresence>
                      {expanded && hasFinancials && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div
                            className="pt-3 mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3"
                            style={{ borderTop: '1px solid var(--border)' }}
                          >
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

      {/* Add / Edit modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={modalTitle}
        size="md"
      >
        {editing ? (
          <EditForm
            initial={editing}
            onSave={saveEdit}
            onClose={closeModal}
            loading={saving}
          />
        ) : addMode === 'choose' ? (
          <AddModeChooser onChoose={setAddMode} onClose={closeModal} />
        ) : addMode === 'manual' ? (
          <ManualForm
            onSave={saveManual}
            onBack={() => setAddMode('choose')}
            onClose={closeModal}
            loading={saving}
          />
        ) : (
          <LifeFlowForm
            onAdd={saveLifeFlow}
            onBack={() => setAddMode('choose')}
            onClose={closeModal}
            saving={saving}
          />
        )}
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void del()}
        title="Remove Person"
        message={`Remove "${deleteTarget?.name}" from your directory?`}
        confirmLabel="Remove"
        danger
      />
    </div>
  )
}
