'use client'

/**
 * SaveDraftStatus — small inline indicator shown inside forms.
 *
 * Shows:
 *  - Nothing (idle)
 *  - "Saving…"  (saving)
 *  - "Draft saved" with a green dot (saved)
 *  - "Unable to save draft" (error)
 */

import { motion, AnimatePresence } from 'framer-motion'
import { Check, AlertCircle, Loader } from 'lucide-react'
import type { SaveStatus } from '@/hooks/useDraft'

interface SaveDraftStatusProps {
  status: SaveStatus
}

export function SaveDraftStatus({ status }: SaveDraftStatusProps) {
  if (status === 'idle') return null

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={status}
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -2 }}
        transition={{ duration: 0.18 }}
        className="flex items-center gap-1 text-[11px] font-medium select-none"
        style={{
          color:
            status === 'error'
              ? 'var(--danger)'
              : status === 'saved'
              ? 'var(--success)'
              : 'var(--text-faint)',
        }}
      >
        {status === 'saving' && (
          <>
            <Loader size={10} className="animate-spin" />
            Saving…
          </>
        )}
        {status === 'saved' && (
          <>
            <Check size={10} />
            Draft saved
          </>
        )}
        {status === 'error' && (
          <>
            <AlertCircle size={10} />
            Unable to save draft
          </>
        )}
      </motion.span>
    </AnimatePresence>
  )
}
