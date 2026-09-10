'use client'

import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Modal ──────────────────────────────────────────────────────────────── */

interface ModalProps {
  isOpen:      boolean
  onClose:     () => void
  title?:      string
  children:    React.ReactNode
  size?:       'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?:  string
  dragHandle?: boolean
}

const widthMap = {
  xs: 'max-w-xs',
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size       = 'md',
  className,
  dragHandle = true,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', handleKey)
    }
  }, [isOpen, onClose])

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-5">

          {/* Backdrop */}
          <motion.div
            ref={overlayRef}
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
          />

          {/* Sheet / dialog */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              'relative w-full max-h-[90dvh] overflow-y-auto',
              'rounded-t-[28px] sm:rounded-2xl',
              widthMap[size],
              className
            )}
            style={{
              background: 'rgba(255,255,255,0.96)',
              backdropFilter: 'blur(36px) saturate(1.8)',
              WebkitBackdropFilter: 'blur(36px) saturate(1.8)',
              border: '1px solid rgba(0,0,0,0.08)',
              boxShadow: '0 16px 60px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.06)',
            }}
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0,   y: 24 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.9 }}
          >
            {/* Drag handle (mobile) */}
            {dragHandle && (
              <div className="flex justify-center pt-3 sm:hidden">
                <div className="w-9 h-1 rounded-full" style={{ background: 'rgba(0,0,0,0.12)' }} />
              </div>
            )}

            {/* Header */}
            {title && (
              <div
                className="flex items-center justify-between px-5 pt-4 sm:pt-5 pb-4"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {title}
                </h2>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-xl transition-colors focus-ring hover:bg-black/[0.05]"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Body */}
            <div className="p-5">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/* ── ConfirmDialog ──────────────────────────────────────────────────────── */

interface ConfirmDialogProps {
  isOpen:        boolean
  onClose:       () => void
  onConfirm:     () => void
  title:         string
  message:       string
  confirmLabel?: string
  danger?:       boolean
  loading?:      boolean
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  danger       = false,
  loading      = false,
}: ConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="flex flex-col gap-5">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {message}
        </p>
        <div className="flex gap-2.5 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-xl glass transition-colors hover:bg-black/[0.04]"
            style={{ color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-xl font-medium transition-colors disabled:opacity-50 text-white"
            style={{
              background: danger ? 'var(--danger)' : 'var(--accent)',
              boxShadow: danger
                ? '0 2px 8px rgba(220,38,38,0.20)'
                : '0 2px 8px rgba(37,99,235,0.20)',
            }}
          >
            {loading ? 'Loading…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
