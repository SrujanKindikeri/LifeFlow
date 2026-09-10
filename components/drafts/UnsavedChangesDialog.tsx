'use client'

/**
 * UnsavedChangesDialog
 *
 * Shown when the user tries to close a form that has unsaved data.
 * Options:
 *  - Continue Editing (dismiss)
 *  - Save as Draft
 *  - Discard
 */

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { GlassButton } from '@/components/ui/GlassButton'
import { BookOpen, Trash2, X } from 'lucide-react'

interface UnsavedChangesDialogProps {
  isOpen: boolean
  onContinueEditing: () => void
  onSaveAsDraft: () => Promise<void>
  onDiscard: () => void
}

export function UnsavedChangesDialog({
  isOpen,
  onContinueEditing,
  onSaveAsDraft,
  onDiscard,
}: UnsavedChangesDialogProps) {
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await onSaveAsDraft()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onContinueEditing}
      title="Save your changes?"
      size="sm"
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          You have unfinished information in this form. What would you like to do?
        </p>

        <div className="flex flex-col gap-2">
          <GlassButton
            variant="primary"
            fullWidth
            onClick={handleSave}
            loading={saving}
            icon={<BookOpen size={14} />}
          >
            Save as Draft
          </GlassButton>

          <GlassButton
            variant="secondary"
            fullWidth
            onClick={onContinueEditing}
            icon={<X size={14} />}
          >
            Continue Editing
          </GlassButton>

          <GlassButton
            variant="danger"
            fullWidth
            onClick={onDiscard}
            icon={<Trash2 size={14} />}
          >
            Discard
          </GlassButton>
        </div>
      </div>
    </Modal>
  )
}
