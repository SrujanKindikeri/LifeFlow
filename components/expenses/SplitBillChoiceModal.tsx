'use client'

/**
 * SplitBillChoiceModal
 *
 * Shown when the user clicks "+ Split a Bill".
 * Presents two first-class choices:
 *   📷 Scan a Bill   — opens the receipt scanner flow
 *   ✎  Enter Manually — opens the existing manual GroupBillSplitter
 *
 * Design goals:
 *  - Both options visually equal — neither is subordinate
 *  - Large touch targets on mobile (min 80px tall cards)
 *  - Keyboard accessible (Enter / Space on cards)
 *  - Never auto-opens the camera — user must explicitly choose
 */

import { motion } from 'framer-motion'
import { Camera, PenLine } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'

interface SplitBillChoiceModalProps {
  isOpen:        boolean
  onClose:       () => void
  onScanBill:    () => void
  onManualEntry: () => void
}

export function SplitBillChoiceModal({
  isOpen,
  onClose,
  onScanBill,
  onManualEntry,
}: SplitBillChoiceModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Split a Bill"
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Choose how you want to add the bill.
        </p>

        {/* Choice cards — stacked on mobile, side-by-side on sm+ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ChoiceCard
            icon={<Camera size={28} className="text-indigo-500" />}
            iconBg="bg-indigo-500/10"
            title="Scan a Bill"
            description="Take a photo or upload your receipt"
            onClick={() => { onClose(); onScanBill() }}
            accentColor="indigo"
          />
          <ChoiceCard
            icon={<PenLine size={28} className="text-emerald-600" />}
            iconBg="bg-emerald-500/10"
            title="Enter Manually"
            description="Enter items and prices yourself"
            onClick={() => { onClose(); onManualEntry() }}
            accentColor="emerald"
          />
        </div>

        {/* Cancel */}
        <button
          onClick={onClose}
          className="w-full py-2 text-sm rounded-xl transition-colors hover:bg-black/[0.05] focus-ring"
          style={{ color: 'var(--text-muted)' }}
        >
          Cancel
        </button>
      </div>
    </Modal>
  )
}

// ─── ChoiceCard ───────────────────────────────────────────────────────────────

type AccentColor = 'indigo' | 'emerald'

const accentStyles: Record<AccentColor, { border: string; hover: string; ring: string }> = {
  indigo: {
    border: 'border-indigo-200/60',
    hover:  'hover:border-indigo-400/70 hover:bg-indigo-50/60',
    ring:   'focus-visible:ring-indigo-400',
  },
  emerald: {
    border: 'border-emerald-200/60',
    hover:  'hover:border-emerald-400/70 hover:bg-emerald-50/60',
    ring:   'focus-visible:ring-emerald-400',
  },
}

function ChoiceCard({
  icon,
  iconBg,
  title,
  description,
  onClick,
  accentColor,
}: {
  icon:        React.ReactNode
  iconBg:      string
  title:       string
  description: string
  onClick:     () => void
  accentColor: AccentColor
}) {
  const styles = accentStyles[accentColor]

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      whileHover={{ scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-3 p-5 rounded-2xl border-2 text-center',
        'cursor-pointer select-none transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        'min-h-[120px] sm:min-h-[140px]',
        styles.border,
        styles.hover,
        styles.ring,
        'glass'
      )}
    >
      {/* Icon bubble */}
      <div className={cn('w-14 h-14 rounded-2xl flex items-center justify-center shrink-0', iconBg)}>
        {icon}
      </div>

      {/* Text */}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </span>
        <span className="text-xs leading-snug" style={{ color: 'var(--text-muted)' }}>
          {description}
        </span>
      </div>
    </motion.button>
  )
}
