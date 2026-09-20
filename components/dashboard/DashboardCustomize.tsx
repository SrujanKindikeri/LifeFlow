'use client'

import { useCallback, useState } from 'react'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import { Settings2, X, GripVertical, Eye, EyeOff, RotateCcw } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import { DEFAULT_SECTIONS, type DashboardSectionId } from '@/lib/dashboardSections'
import type { DashboardSectionPref } from '@/lib/dashboard'

// ─── Human-readable labels ────────────────────────────────────────────────────
const SECTION_LABELS: Record<DashboardSectionId, { label: string; emoji: string }> = {
  focus:            { label: 'Focus for Today',       emoji: '🎯' },
  timeline:         { label: 'Today Timeline',         emoji: '🕐' },
  tasks:            { label: "Today's Tasks",          emoji: '✅' },
  habits:           { label: "Today's Habits",         emoji: '🔥' },
  streakProtection: { label: 'Streak Protection',      emoji: '⚡' },
  spending:         { label: 'Personal Spending',      emoji: '💰' },
  spendingWarning:  { label: 'Spending Warning',       emoji: '⚠️' },
  groupBills:       { label: 'Group Bill Reminders',   emoji: '👥' },
  notes:            { label: 'Recent Notes',           emoji: '📝' },
  continue:         { label: 'Continue',               emoji: '↩️' },
  weeklyReview:     { label: 'Weekly Review',          emoji: '📊' },
}

interface Props {
  isOpen: boolean
  onClose: () => void
  initialSections: DashboardSectionPref[]
  onSaved: (sections: DashboardSectionPref[]) => void
}

export function DashboardCustomize({ isOpen, onClose, initialSections, onSaved }: Props) {
  const { success, error: toastError } = useToast()
  const [sections, setSections] = useState<DashboardSectionPref[]>(() =>
    [...initialSections].sort((a, b) => a.order - b.order)
  )
  const [saving, setSaving] = useState(false)

  // Re-sync when opened (in case parent data changed)

  function toggle(id: string) {
    setSections((prev) =>
      prev.map((s) => s.id === id ? { ...s, visible: !s.visible } : s)
    )
  }

  function reset() {
    setSections(
      [...DEFAULT_SECTIONS]
        .sort((a, b) => a.order - b.order)
        .map((s) => ({ id: s.id, visible: s.visible, order: s.order }))
    )
  }

  // When reorder finishes, reassign order indices
  function handleReorder(newOrder: DashboardSectionPref[]) {
    setSections(newOrder.map((s, idx) => ({ ...s, order: idx })))
  }

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const payload = sections.map((s, idx) => ({ id: s.id as DashboardSectionId, visible: s.visible, order: idx }))
      const res = await fetch('/api/dashboard/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections: payload }),
      })
      if (!res.ok) throw new Error()
      onSaved(payload)
      success('Dashboard layout saved')
      onClose()
    } catch {
      toastError('Failed to save layout. Try again.')
    } finally {
      setSaving(false)
    }
  }, [sections, onSaved, onClose, success, toastError])

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-5">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Customize Dashboard"
            className="glass-floating relative w-full max-w-sm max-h-[88dvh] flex flex-col rounded-t-[28px] sm:rounded-2xl overflow-hidden"
            style={{ boxShadow: 'var(--glass-shadow-xl)' }}
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.9 }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 sm:hidden">
              <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border-strong)' }} />
            </div>

            {/* Header */}
            <div
              className="flex items-center justify-between px-5 pt-4 sm:pt-5 pb-4 shrink-0"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <Settings2 size={15} style={{ color: 'var(--text-muted)' }} />
                <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Customize Dashboard
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={reset}
                  className="nav-hover p-1.5 rounded-xl text-[11px] flex items-center gap-1 transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label="Reset to defaults"
                  title="Reset to defaults"
                >
                  <RotateCcw size={12} />
                </button>
                <button
                  onClick={onClose}
                  className="nav-hover p-1.5 rounded-xl transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label="Close"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Instructions */}
            <p className="text-[11px] px-5 pt-3 pb-1" style={{ color: 'var(--text-faint)' }}>
              Drag to reorder · tap eye to show/hide
            </p>

            {/* Reorderable list */}
            <div className="flex-1 overflow-y-auto px-3 py-2">
              <Reorder.Group
                axis="y"
                values={sections}
                onReorder={handleReorder}
                className="space-y-1"
                as="ul"
              >
                {sections.map((section) => {
                  const meta = SECTION_LABELS[section.id as DashboardSectionId]
                  return (
                    <Reorder.Item
                      key={section.id}
                      value={section}
                      as="li"
                      className="list-none"
                      whileDrag={{ scale: 1.02, boxShadow: '0 8px 24px rgba(0,0,0,0.10)', zIndex: 10 }}
                    >
                      <div
                        className={cn(
                          'flex items-center gap-3 px-3 py-3 rounded-xl transition-colors',
                          section.visible ? 'bg-white/[0.0]' : 'opacity-45',
                          'hover:bg-black/[0.03]'
                        )}
                      >
                        {/* Drag handle */}
                        <div
                          className="cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
                          style={{ color: 'var(--text-faint)' }}
                          aria-hidden="true"
                        >
                          <GripVertical size={14} />
                        </div>

                        {/* Emoji */}
                        <span className="text-base w-6 text-center shrink-0">{meta?.emoji ?? '📌'}</span>

                        {/* Label */}
                        <span className="flex-1 text-[13px]" style={{ color: 'var(--text-primary)' }}>
                          {meta?.label ?? section.id}
                        </span>

                        {/* Toggle visibility */}
                        <button
                          onClick={() => toggle(section.id)}
                          className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors"
                          style={{ color: section.visible ? 'var(--accent)' : 'var(--text-faint)' }}
                          aria-label={section.visible ? 'Hide section' : 'Show section'}
                          aria-pressed={section.visible}
                        >
                          {section.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                      </div>
                    </Reorder.Item>
                  )
                })}
              </Reorder.Group>
            </div>

            {/* Footer */}
            <div
              className="px-5 py-4 flex gap-2.5 shrink-0"
              style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}
            >
              <GlassButton variant="secondary" size="md" onClick={onClose} className="flex-1">
                Cancel
              </GlassButton>
              <GlassButton variant="primary" size="md" loading={saving} onClick={save} className="flex-1">
                Save Layout
              </GlassButton>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
