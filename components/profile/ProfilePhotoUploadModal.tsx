'use client'

/**
 * ProfilePhotoUploadModal
 *
 * A glass-styled modal for uploading, previewing, and removing a profile photo.
 *
 * Flow:
 *   1. Opens with the current avatar (photo or initials fallback).
 *   2. "Choose photo" / "Change photo" triggers a hidden file input.
 *   3. Selected image is validated client-side and shown as a live preview.
 *   4. "Save Photo" POSTs to /api/auth/avatar and calls onSave(newDataUrl).
 *   5. "Remove photo" (shown when a photo exists) DELETEs /api/auth/avatar
 *      and calls onSave(null).
 *   6. Cancel / Escape dismisses without changes.
 *
 * Security: server validates magic bytes + MIME + size. Client-side checks
 * provide immediate UX feedback only — they do not replace server validation.
 */

import { useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, Trash2, Upload, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { GlassButton } from '@/components/ui/GlassButton'
import { cn } from '@/lib/utils'

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_BYTES   = 5 * 1024 * 1024 // 5 MB — must match server
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ALLOWED_EXTS  = ['.jpg', '.jpeg', '.png', '.webp']

// ── Props ──────────────────────────────────────────────────────────────────────

interface ProfilePhotoUploadModalProps {
  isOpen:    boolean
  onClose:   () => void
  /** Current avatar data URL, or undefined/null if no photo. */
  avatar?:   string | null
  /** User's display initials (e.g. "KS") — shown when no photo. */
  initials:  string
  /**
   * Called after a successful upload or removal.
   * Receives the new data URL string, or null when photo was removed.
   */
  onSave:    (newAvatar: string | null) => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ProfilePhotoUploadModal({
  isOpen,
  onClose,
  avatar,
  initials,
  onSave,
}: ProfilePhotoUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  // null  = no preview selected (show current avatar)
  // string = data URL of the locally-selected file (not yet saved)
  const [preview,  setPreview]  = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [saving,   setSaving]   = useState(false)
  const [removing, setRemoving] = useState(false)
  const [success,  setSuccess]  = useState(false)

  // The image that is actually displayed in the circle preview
  const displaySrc = preview ?? avatar ?? null

  // ── Reset internal state when modal opens/closes ───────────────────────────

  function handleClose() {
    if (saving || removing) return
    setPreview(null)
    setError(null)
    setSuccess(false)
    onClose()
  }

  // ── File picker trigger ────────────────────────────────────────────────────

  function openPicker() {
    setError(null)
    fileInputRef.current?.click()
  }

  // ── File selection handler ─────────────────────────────────────────────────

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      // Reset input so the same file can be re-selected after an error
      e.target.value = ''

      if (!file) return

      // Client-side size check
      if (file.size > MAX_BYTES) {
        setError('Profile photo must be 5 MB or smaller.')
        setPreview(null)
        return
      }

      // Client-side MIME check
      if (!ALLOWED_TYPES.includes(file.type)) {
        setError('Only JPEG, PNG, and WebP images are supported.')
        setPreview(null)
        return
      }

      setError(null)

      // Generate an instant preview via FileReader
      const reader = new FileReader()
      reader.onload = (ev) => {
        const result = ev.target?.result
        if (typeof result === 'string') setPreview(result)
      }
      reader.onerror = () => setError('Could not read the selected file.')
      reader.readAsDataURL(file)
    },
    [],
  )

  // ── Save (upload) ──────────────────────────────────────────────────────────

  async function handleSave() {
    if (!preview || saving) return

    // Re-fetch the file from the preview data URL and POST as multipart.
    // We convert the data URL back to a Blob so we can use FormData.
    setSaving(true)
    setError(null)

    try {
      const blob  = dataUrlToBlob(preview)
      const form  = new FormData()
      form.append('avatar', blob, `avatar.${mimeToExt(blob.type)}`)

      const res = await fetch('/api/auth/avatar', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error ?? 'Upload failed. Please try again.')
        return
      }

      setSuccess(true)
      onSave(data.avatar as string)

      // Brief success flash then close
      setTimeout(() => {
        setPreview(null)
        setSuccess(false)
        onClose()
      }, 900)
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Remove photo ───────────────────────────────────────────────────────────

  async function handleRemove() {
    if (removing) return
    setRemoving(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/avatar', { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Could not remove photo. Please try again.')
        return
      }

      setPreview(null)
      setSuccess(true)
      onSave(null)

      setTimeout(() => {
        setSuccess(false)
        onClose()
      }, 900)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setRemoving(false)
    }
  }

  // ── Whether a save-able preview is staged ─────────────────────────────────
  const hasPreview = Boolean(preview)
  const hasExisting = Boolean(avatar && !preview)
  const isBusy = saving || removing

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Profile Photo" size="sm">
      <div className="flex flex-col items-center gap-5">

        {/* ── Avatar preview circle ─────────────────────────────────────────── */}
        <div className="relative group">
          <div
            className={cn(
              'w-28 h-28 rounded-full overflow-hidden flex items-center justify-center',
              'ring-2 ring-offset-2',
              'transition-all duration-200',
              displaySrc
                ? 'ring-indigo-500/30 ring-offset-transparent'
                : 'ring-indigo-500/20 ring-offset-transparent',
            )}
            style={{
              background: displaySrc
                ? 'transparent'
                : 'linear-gradient(135deg, rgba(99,102,241,0.15) 0%, rgba(139,92,246,0.12) 100%)',
              border: displaySrc ? undefined : '2px solid rgba(99,102,241,0.25)',
            }}
          >
            {displaySrc ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={displaySrc}
                alt="Profile photo preview"
                className="w-full h-full object-cover"
                draggable={false}
              />
            ) : (
              <span
                className="text-3xl font-bold select-none"
                style={{ color: 'var(--accent)' }}
              >
                {initials}
              </span>
            )}
          </div>

          {/* Camera overlay — always visible when not busy */}
          {!isBusy && !success && (
            <button
              onClick={openPicker}
              aria-label="Choose photo"
              className={cn(
                'absolute -bottom-1 -right-1',
                'w-9 h-9 rounded-full flex items-center justify-center',
                'transition-all duration-200 focus-ring',
                'shadow-lg',
              )}
              style={{
                background: 'var(--accent)',
                color: '#fff',
                border: '2px solid var(--glass-panel-bg)',
              }}
            >
              <Camera size={15} />
            </button>
          )}

          {/* Upload/loading spinner overlay */}
          {isBusy && (
            <div
              className="absolute inset-0 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.45)' }}
            >
              <Loader2 size={28} className="animate-spin text-white" />
            </div>
          )}

          {/* Success checkmark overlay */}
          <AnimatePresence>
            {success && (
              <motion.div
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                className="absolute inset-0 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(16,185,129,0.85)' }}
              >
                <CheckCircle2 size={36} className="text-white" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Preview state label ───────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {hasPreview && !success && (
            <motion.p
              key="preview-label"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="text-[12px] font-medium"
              style={{ color: 'var(--text-muted)' }}
            >
              Preview — save to apply
            </motion.p>
          )}
          {success && (
            <motion.p
              key="success-label"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-[13px] font-semibold text-emerald-600"
            >
              {avatar && !preview ? 'Photo removed.' : 'Profile photo updated.'}
            </motion.p>
          )}
        </AnimatePresence>

        {/* ── Error message ─────────────────────────────────────────────────── */}
        <AnimatePresence>
          {error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="w-full flex items-start gap-2 px-3 py-2.5 rounded-xl"
              style={{
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.18)',
              }}
            >
              <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
              <p className="text-[12px] text-red-600 leading-snug">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Action buttons ────────────────────────────────────────────────── */}
        <div className="w-full flex flex-col gap-2">

          {/* Choose / change photo */}
          {!success && (
            <button
              onClick={openPicker}
              disabled={isBusy}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl',
                'text-[13px] font-medium transition-all duration-200',
                'glass-subtle focus-ring',
                isBusy && 'opacity-50 pointer-events-none',
              )}
              style={{
                border: '1px solid var(--border-strong)',
                color: 'var(--text-secondary)',
              }}
            >
              <Upload size={14} />
              {hasPreview ? 'Choose another photo' : hasExisting ? 'Change photo' : 'Choose photo'}
            </button>
          )}

          {/* Remove photo — only when a saved photo exists and no new preview staged */}
          {hasExisting && !success && (
            <button
              onClick={handleRemove}
              disabled={isBusy}
              className={cn(
                'w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl',
                'text-[13px] font-medium transition-all duration-200',
                'focus-ring',
                isBusy && 'opacity-50 pointer-events-none',
              )}
              style={{
                background: 'rgba(239,68,68,0.06)',
                border: '1px solid rgba(239,68,68,0.18)',
                color: removing ? '#dc2626' : '#ef4444',
              }}
            >
              {removing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              Remove photo
            </button>
          )}
        </div>

        {/* ── Save / Cancel row ─────────────────────────────────────────────── */}
        {!success && (
          <div
            className="w-full flex items-center justify-between gap-3 pt-2"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <button
              onClick={handleClose}
              disabled={isBusy}
              className={cn(
                'flex-1 py-2.5 rounded-xl text-[13px] font-medium transition-all',
                'glass-subtle focus-ring',
                isBusy && 'opacity-50 pointer-events-none',
              )}
              style={{
                border: '1px solid var(--border-strong)',
                color: 'var(--text-muted)',
              }}
            >
              Cancel
            </button>

            <GlassButton
              variant="primary"
              onClick={handleSave}
              loading={saving}
              disabled={!hasPreview || isBusy}
              className="flex-1"
            >
              {saving ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <CheckCircle2 size={13} /> Save Photo
                </>
              )}
            </GlassButton>
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_EXTS.join(',')}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFileChange}
      />
    </Modal>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a base64 data URL to a Blob for FormData upload. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** Map MIME type to file extension. */
function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/png':  return 'png'
    case 'image/webp': return 'webp'
    default:           return 'jpg'
  }
}
