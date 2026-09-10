'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Search, Pin, Archive, Trash2, Edit3, X, Tag, Clock,
  ArchiveRestore, PinOff, ArrowLeft, Check, FileText,
} from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea } from '@/components/ui/GlassInput'
import { Modal, ConfirmDialog } from '@/components/ui/Modal'
import { EmptyState, SkeletonCard } from '@/components/ui/Loading'
import { useToast } from '@/components/ui/Toast'
import { cn, formatRelativeTime } from '@/lib/utils'
import { useDraft } from '@/hooks/useDraft'
import { SaveDraftStatus } from '@/components/drafts/SaveDraftStatus'
import { UnsavedChangesDialog } from '@/components/drafts/UnsavedChangesDialog'
import type { Note } from '@/types'

type Filter = 'all' | 'pinned' | 'archived'
type Sort   = 'newest' | 'oldest' | 'updated'
type View   = 'list' | 'editor'

interface NoteFormData {
  title:   string
  content: string
  tags:    string
  pinned:  boolean
}
const defaultForm: NoteFormData = { title: '', content: '', tags: '', pinned: false }

export function NotesClient() {
  const searchParams = useSearchParams()
  const draftIdParam = searchParams.get('draftId') ?? undefined
  const openNew      = searchParams.get('new') === '1'
  const [notes,       setNotes]       = useState<Note[]>([])
  const [loading,     setLoading]     = useState(true)
  const [view,        setView]        = useState<View>('list')
  const [editingNote, setEditingNote] = useState<Note | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [deleteTarget,setDeleteTarget]= useState<Note | null>(null)
  const [deleting,    setDeleting]    = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filter,      setFilter]      = useState<Filter>('all')
  const [sort,        setSort]        = useState<Sort>('newest')
  const [form,        setForm]        = useState<NoteFormData>(defaultForm)
  const [showUnsaved, setShowUnsaved] = useState(false)
  const formRef = useRef<NoteFormData>(form)
  useEffect(() => { formRef.current = form }, [form])
  const titleRef = useRef<HTMLInputElement>(null)
  const { success, error: toastError } = useToast()

  // ── Draft integration ──────────────────────────────────────────────────────
  const draft = useDraft({
    type: 'note',
    initialDraftId: draftIdParam,
    getTitle:  () => formRef.current.title || 'Note Draft',
    getData:   () => ({ ...formRef.current }),
    hasMeaningfulData: () => Boolean(formRef.current.title.trim() || formRef.current.content.trim()),
  })

  // Open modal from URL params
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    if (!openNew) return
    if (draftIdParam) {
      fetch(`/api/drafts/${draftIdParam}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (d?.draft?.data) {
            const data = d.draft.data as Partial<NoteFormData>
            setForm({ title: data.title ?? '', content: data.content ?? '', tags: data.tags ?? '', pinned: data.pinned ?? false })
          }
          setEditingNote(null); setIsModalOpen(true)
        })
        .catch(() => { setEditingNote(null); setForm(defaultForm); setIsModalOpen(true) })
    } else {
      setEditingNote(null); setForm(defaultForm); setIsModalOpen(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNew])

  const fetchNotes = useCallback(async () => {
    try {
      const res  = await fetch('/api/notes?all=true')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setNotes(data.notes ?? [])
    } catch { toastError('Failed to load notes') }
    finally  { setLoading(false) }
  }, [toastError])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchNotes() }, [fetchNotes])
  useEffect(() => { if (isModalOpen) setTimeout(() => titleRef.current?.focus(), 80) }, [isModalOpen])

  /* ── Filter / sort ── */
  const filteredNotes = notes
    .filter((n) => {
      if (filter === 'pinned')   return n.pinned && !n.archived
      if (filter === 'archived') return n.archived
      return !n.archived
    })
    .filter((n) => {
      if (!searchQuery) return true
      const q = searchQuery.toLowerCase()
      return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q))
    })
    .sort((a, b) => {
      if (sort === 'newest')  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      if (sort === 'oldest')  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })

  /* ── Actions ── */
  function openCreate() { setEditingNote(null); setForm(defaultForm); setIsModalOpen(true) }
  function openEdit(note: Note) {
    setEditingNote(note)
    setForm({ title: note.title, content: note.content, tags: note.tags.join(', '), pinned: note.pinned })
    setIsModalOpen(true)
  }
  function openEditorView(note: Note) {
    setEditingNote(note)
    setForm({ title: note.title, content: note.content, tags: note.tags.join(', '), pinned: note.pinned })
    setView('editor')
  }

  function handleModalClose() {
    if (!editingNote && draft.hasMeaningfulData()) {
      setShowUnsaved(true)
    } else {
      setIsModalOpen(false)
    }
  }

  async function handleSave() {
    if (!form.title.trim()) { toastError('Title is required'); return }
    setSaving(true)
    try {
      const payload = { title: form.title.trim(), content: form.content.trim(), tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean), pinned: form.pinned }
      if (editingNote) {
        const res = await fetch(`/api/notes/${editingNote._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (!res.ok) throw new Error()
        const data = await res.json()
        setNotes((p) => p.map((n) => n._id === editingNote._id ? data.note : n))
        if (view === 'editor') setEditingNote(data.note)
        success('Note updated')
      } else {
        const res = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (!res.ok) throw new Error()
        const data = await res.json()
        setNotes((p) => [data.note, ...p])
        await draft.deleteDraft()
        success('Note created')
      }
      setIsModalOpen(false)
    } catch { toastError('Failed to save note') }
    finally   { setSaving(false) }
  }

  async function handleSaveEditor() {
    if (!editingNote || !form.title.trim()) return
    setSaving(true)
    try {
      const payload = { title: form.title.trim(), content: form.content.trim(), tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean), pinned: form.pinned }
      const res = await fetch(`/api/notes/${editingNote._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setNotes((p) => p.map((n) => n._id === editingNote._id ? data.note : n))
      setEditingNote(data.note)
      success('Saved')
    } catch { toastError('Failed to save') }
    finally   { setSaving(false) }
  }

  async function handleTogglePin(note: Note) {
    try {
      const res = await fetch(`/api/notes/${note._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: !note.pinned }) })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setNotes((p) => p.map((n) => n._id === note._id ? data.note : n))
      success(note.pinned ? 'Unpinned' : 'Pinned')
    } catch { toastError('Failed to update note') }
  }

  async function handleToggleArchive(note: Note) {
    try {
      const res = await fetch(`/api/notes/${note._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: !note.archived }) })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setNotes((p) => p.map((n) => n._id === note._id ? data.note : n))
      success(note.archived ? 'Unarchived' : 'Archived')
    } catch { toastError('Failed to update note') }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/notes/${deleteTarget._id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setNotes((p) => p.filter((n) => n._id !== deleteTarget._id))
      success('Note deleted')
      setDeleteTarget(null)
      if (view === 'editor') setView('list')
    } catch { toastError('Failed to delete note') }
    finally   { setDeleting(false) }
  }

  /* ── Editor view ── */
  if (view === 'editor' && editingNote) {
    return (
      <motion.div
        key="editor"
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -24 }}
        className="flex flex-col gap-5 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6"
      >
        {/* Editor toolbar */}
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => setView('list')}
            className="flex items-center gap-2 text-[13px] transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <ArrowLeft size={15} />
            All Notes
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleTogglePin(editingNote)}
              className={cn(
                'p-2 rounded-xl transition-colors',
                editingNote.pinned
                  ? 'text-amber-500 bg-amber-500/10 border border-amber-500/20'
                  : 'hover:bg-black/[0.05]'
              )}
              style={!editingNote.pinned ? { color: 'var(--text-muted)' } : {}}
            >
              {editingNote.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
            <button
              onClick={() => setDeleteTarget(editingNote)}
              className="p-2 rounded-xl hover:bg-red-500/10 hover:text-red-500 transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              <Trash2 size={14} />
            </button>
            <GlassButton variant="primary" size="sm" onClick={handleSaveEditor} loading={saving}>
              <Check size={13} /> Save
            </GlassButton>
          </div>
        </div>

        {/* Title */}
        <input
          className="bg-transparent text-[26px] sm:text-[30px] font-bold outline-none w-full leading-tight"
          style={{ color: 'var(--text-primary)' }}
          placeholder="Note title…"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />

        {/* Tags */}
        <div className="flex items-center gap-2">
          <Tag size={12} className="flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
          <input
            className="bg-transparent text-sm outline-none flex-1"
            style={{ color: 'var(--text-secondary)' }}
            placeholder="Add tags (comma separated)…"
            value={form.tags}
            onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
          />
        </div>

        <div style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }} />

        {/* Content */}
        <textarea
          className="bg-transparent text-[14px] outline-none resize-none flex-1 min-h-[60vh] leading-[1.75]"
          style={{ color: 'var(--text-primary)' }}
          placeholder="Start writing…"
          value={form.content}
          onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
        />

        <ConfirmDialog
          isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete}
          title="Delete Note" message={`"${deleteTarget?.title}" will be permanently deleted.`}
          confirmLabel="Delete" danger loading={deleting}
        />
      </motion.div>
    )
  }

  /* ── List view ── */
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Notes</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {notes.filter((n) => !n.archived).length} notes · Capture your thoughts
          </p>
        </div>
        <GlassButton variant="primary" onClick={openCreate}>
          <Plus size={14} />
          <span className="hidden sm:inline">New Note</span>
          <span className="sm:hidden">New</span>
        </GlassButton>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input
            className="glass-input w-full rounded-xl pl-8.5 pr-9 py-2.5 text-sm"
            placeholder="Search notes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 hover:opacity-80 transition-opacity"
              style={{ color: 'var(--text-faint)' }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="flex gap-1.5 p-1 glass rounded-xl w-fit">
          {(['all', 'pinned', 'archived'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-[12px] font-medium capitalize transition-all',
                filter === f ? 'glass-segment-active text-white' : 'hover:bg-black/[0.04]'
              )}
              style={filter === f ? {} : { color: 'var(--text-muted)' }}
            >
              {f}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="glass-input rounded-xl px-3.5 py-2 text-xs appearance-none"
          style={{ color: 'var(--text-secondary)' }}
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="updated">Recently Updated</option>
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : filteredNotes.length === 0 ? (
        <EmptyState
          icon="📝"
          title={searchQuery ? 'No notes match your search' : filter === 'pinned' ? 'No pinned notes' : filter === 'archived' ? 'No archived notes' : 'No notes yet'}
          description={!searchQuery && filter === 'all' ? 'Capture your first idea, thought, or reminder.' : undefined}
          action={
            !searchQuery && filter === 'all' ? (
              <GlassButton variant="primary" size="sm" onClick={openCreate}>
                <Plus size={13} /> New Note
              </GlassButton>
            ) : undefined
          }
        />
      ) : (
        <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence mode="popLayout">
            {filteredNotes.map((note) => (
              <NoteCard key={note._id} note={note} onOpen={openEditorView} onEdit={openEdit} onPin={handleTogglePin} onArchive={handleToggleArchive} onDelete={(n) => setDeleteTarget(n)} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Create / Edit Modal */}
      <Modal isOpen={isModalOpen} onClose={handleModalClose} title={editingNote ? 'Edit Note' : 'New Note'} size="lg">
        <div className="flex flex-col gap-4">
          <GlassInput ref={titleRef} label="Title" placeholder="Note title…" value={form.title} onChange={(e) => { setForm((f) => ({ ...f, title: e.target.value })); if (!editingNote) draft.triggerAutosave() }} />
          <GlassTextarea label="Content" placeholder="Write your note…" rows={8} value={form.content} onChange={(e) => { setForm((f) => ({ ...f, content: e.target.value })); if (!editingNote) draft.triggerAutosave() }} />
          <GlassInput label="Tags" placeholder="ideas, work, personal…" value={form.tags} onChange={(e) => { setForm((f) => ({ ...f, tags: e.target.value })); if (!editingNote) draft.triggerAutosave() }} leftIcon={<Tag size={13} />} hint="Comma-separated tags" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setForm((f) => ({ ...f, pinned: !f.pinned })); if (!editingNote) draft.triggerAutosave() }}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors',
                form.pinned
                  ? 'bg-amber-500/12 text-amber-600 border border-amber-500/20'
                  : 'glass hover:bg-black/[0.04]'
              )}
              style={!form.pinned ? { color: 'var(--text-muted)' } : {}}
            >
              <Pin size={12} />
              {form.pinned ? 'Pinned' : 'Pin note'}
            </button>
          </div>
          <div className="flex items-center justify-between pt-1">
            {!editingNote && <SaveDraftStatus status={draft.saveStatus} />}
            <div className="flex gap-2 ml-auto">
              {!editingNote && (
                <GlassButton variant="secondary" size="sm" onClick={() => draft.saveDraft()}>Save Draft</GlassButton>
              )}
              <GlassButton variant="secondary" onClick={handleModalClose}>Cancel</GlassButton>
              <GlassButton variant="primary" onClick={handleSave} loading={saving}>{editingNote ? 'Save Changes' : 'Create Note'}</GlassButton>
            </div>
          </div>
        </div>
      </Modal>

      <UnsavedChangesDialog
        isOpen={showUnsaved}
        onContinueEditing={() => setShowUnsaved(false)}
        onSaveAsDraft={async () => { await draft.saveDraft(); setShowUnsaved(false); setIsModalOpen(false) }}
        onDiscard={() => { draft.deleteDraft(); setShowUnsaved(false); setIsModalOpen(false) }}
      />

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete Note" message={`"${deleteTarget?.title}" will be permanently deleted.`} confirmLabel="Delete" danger loading={deleting} />
    </div>
  )
}

/* ── Note Card ─────────────────────────────────────────────────────────────── */
interface NoteCardProps {
  note:      Note
  onOpen:    (n: Note) => void
  onEdit:    (n: Note) => void
  onPin:     (n: Note) => void
  onArchive: (n: Note) => void
  onDelete:  (n: Note) => void
}

function NoteCard({ note, onOpen, onEdit, onPin, onArchive, onDelete }: NoteCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        'group glass rounded-2xl p-4 flex flex-col gap-3 cursor-pointer relative',
        'hover:bg-white/[0.08] hover:-translate-y-0.5',
        'transition-all duration-200',
        note.pinned && 'border-amber-500/20 bg-amber-500/[0.025]'
      )}
      style={{ borderColor: note.pinned ? undefined : undefined }}
      onClick={() => onOpen(note)}
    >
      {note.pinned && <Pin size={11} className="absolute top-3.5 right-3.5 text-amber-500/70" />}

      {/* Icon + title */}
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: 'rgba(0,0,0,0.05)' }}>
          <FileText size={12} style={{ color: 'var(--text-faint)' }} />
        </div>
        <h3 className="text-[13px] font-semibold leading-snug line-clamp-2 pr-4 flex-1" style={{ color: 'var(--text-primary)' }}>
          {note.title}
        </h3>
      </div>

      {note.content && (
        <p className="text-[12px] leading-relaxed line-clamp-3" style={{ color: 'var(--text-muted)' }}>
          {note.content}
        </p>
      )}

      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {note.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 border border-indigo-500/15">
              #{tag}
            </span>
          ))}
          {note.tags.length > 3 && (
            <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>+{note.tags.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mt-auto">
        <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-faint)' }}>
          <Clock size={9} />{formatRelativeTime(note.updatedAt)}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          {[
            { icon: Edit3,                                      action: () => onEdit(note),    className: '' },
            { icon: note.pinned ? PinOff : Pin,                 action: () => onPin(note),     className: note.pinned ? 'text-amber-500' : '' },
            { icon: note.archived ? ArchiveRestore : Archive,   action: () => onArchive(note), className: '' },
            { icon: Trash2,                                     action: () => onDelete(note),  className: 'hover:text-red-500' },
          ].map(({ icon: Icon, action, className }, idx) => (
            <button
              key={idx}
              onClick={action}
              className={cn('p-1.5 rounded-lg hover:bg-black/[0.06] transition-colors', className)}
              style={{ color: 'var(--text-faint)' }}
            >
              <Icon size={11} />
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  )
}
