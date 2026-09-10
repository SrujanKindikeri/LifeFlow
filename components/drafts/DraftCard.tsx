'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import {
  FileText, CheckSquare, Flame, Wallet, Users, Target,
  FolderOpen, CreditCard, PiggyBank, ArrowUpRight,
  ArrowDownLeft, Trash2, ArrowRight, Clock,
} from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { formatRelativeTime } from '@/lib/utils'
import { DRAFT_TYPE_META, getDraftPreview } from '@/types/drafts'
import type { Draft, DraftType } from '@/types/drafts'
import { useRouter } from 'next/navigation'

// ─── Icon map ─────────────────────────────────────────────────────────────────

const ICON_MAP: Record<DraftType, React.ReactNode> = {
  note:          <FileText     size={14} />,
  task:          <CheckSquare  size={14} />,
  habit:         <Flame        size={14} />,
  expense:       <Wallet       size={14} />,
  groupBill:     <Users        size={14} />,
  moneyGiven:    <ArrowUpRight size={14} />,
  moneyBorrowed: <ArrowDownLeft size={14} />,
  goal:          <Target       size={14} />,
  project:       <FolderOpen   size={14} />,
  subscription:  <CreditCard   size={14} />,
  savingsGoal:   <PiggyBank    size={14} />,
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface DraftCardProps {
  draft: Draft
  onDeleted: (id: string) => void
  compact?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DraftCard({ draft, onDeleted, compact = false }: DraftCardProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const meta = DRAFT_TYPE_META[draft.type]
  const preview = getDraftPreview(draft)

  // Build the "Continue" URL — navigates to the form page with the draftId attached
  function getContinueUrl() {
    const base = meta.href
    const param = meta.queryParam ?? 'new'
    return `${base}?${param}=1&draftId=${draft._id}`
  }

  function handleContinue() {
    router.push(getContinueUrl())
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/drafts/${draft._id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      success('Draft deleted')
      onDeleted(draft._id)
    } catch {
      toastError('Could not delete draft. Please try again.')
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (compact) {
    // ── Compact mode: used in dashboard "Continue Where You Left Off" ──────
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-black/[0.03] transition-colors group cursor-pointer"
        onClick={handleContinue}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
      >
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${meta.bgColor} ${meta.color}`}>
          {ICON_MAP[draft.type]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
            {draft.title}
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {meta.label} · Edited {formatRelativeTime(draft.updatedAt)}
          </p>
        </div>
        <ArrowRight
          size={13}
          className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity -translate-x-1 group-hover:translate-x-0 duration-150"
          style={{ color: 'var(--text-faint)' }}
        />
      </motion.div>
    )
  }

  // ── Full card mode: used in /app/drafts ────────────────────────────────────
  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        className="glass rounded-2xl p-4 flex flex-col gap-3 group hover:-translate-y-0.5 hover:shadow-[0_8px_32px_rgba(0,0,0,0.09)] transition-all duration-200"
      >
        {/* Header row */}
        <div className="flex items-start gap-3">
          {/* Type icon */}
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${meta.bgColor} ${meta.color}`}>
            {ICON_MAP[draft.type]}
          </div>

          {/* Title + type */}
          <div className="flex-1 min-w-0">
            <h3
              className="text-[13px] font-semibold leading-snug truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {draft.title}
            </h3>
            <span
              className="text-[11px] font-medium"
              style={{ color: 'var(--text-muted)' }}
            >
              {meta.label}
            </span>
          </div>
        </div>

        {/* Preview */}
        {preview && (
          <p
            className="text-[12px] leading-relaxed line-clamp-2"
            style={{ color: 'var(--text-muted)' }}
          >
            {preview}
          </p>
        )}

        {/* Footer row */}
        <div className="flex items-center justify-between mt-auto pt-1" style={{ borderTop: '1px solid var(--border)' }}>
          {/* Timestamps */}
          <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-faint)' }}>
            <Clock size={9} />
            <span>Edited {formatRelativeTime(draft.updatedAt)}</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-colors"
              style={{ color: 'var(--text-faint)' }}
              aria-label="Delete draft"
            >
              <Trash2 size={13} />
            </button>
            <button
              onClick={handleContinue}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium transition-colors text-white"
              style={{
                background: 'var(--accent)',
                boxShadow: '0 2px 8px rgba(37,99,235,0.18)',
              }}
            >
              Continue
              <ArrowRight size={11} />
            </button>
          </div>
        </div>
      </motion.div>

      <ConfirmDialog
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete draft?"
        message="This draft will be permanently deleted. This cannot be undone."
        confirmLabel="Delete"
        danger
        loading={deleting}
      />
    </>
  )
}
