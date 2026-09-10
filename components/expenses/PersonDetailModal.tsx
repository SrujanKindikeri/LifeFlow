'use client'

import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { type PersonShare } from '@/lib/billCalculator'
import { formatMoney, type GroupBillData } from './types'

interface PersonDetailModalProps {
  isOpen: boolean
  onClose: () => void
  personShare: PersonShare | null
  bill: GroupBillData
}

export function PersonDetailModal({ isOpen, onClose, personShare, bill }: PersonDetailModalProps) {
  if (!personShare) return null

  const sym = bill.currency

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            className="relative w-full max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl max-h-[85vh] overflow-y-auto"
            style={{
              background: 'rgba(255,255,255,0.97)',
              backdropFilter: 'blur(36px) saturate(1.8)',
              WebkitBackdropFilter: 'blur(36px) saturate(1.8)',
              border: '1px solid rgba(0,0,0,0.08)',
              boxShadow: '0 16px 60px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.06)',
            }}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 sm:hidden">
              <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(0,0,0,0.12)' }} />
            </div>

            {/* Header */}
            <div
              className="flex items-center justify-between px-5 pt-4 sm:pt-5 pb-4"
              style={{ borderBottom: '1px solid rgba(0,0,0,0.07)' }}
            >
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-full bg-indigo-500/20 flex items-center justify-center text-sm text-indigo-600 font-bold">
                  {personShare.personName[0]?.toUpperCase()}
                </span>
                <div>
                  <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {personShare.personName}
                  </h2>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{bill.name}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-black/[0.05] transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 flex flex-col gap-4">
              {/* Item lines */}
              {personShare.items.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                    Items
                  </p>
                  <div className="flex flex-col gap-0">
                    {personShare.items.map((line, i) => (
                      <div
                        key={line.itemId}
                        className="flex items-center justify-between py-2.5 px-0"
                        style={i < personShare.items.length - 1 ? { borderBottom: '1px solid rgba(0,0,0,0.06)' } : {}}
                      >
                        <div>
                          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{line.itemName}</p>
                          {line.sharedWith > 1 && (
                            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                              Shared ÷ {line.sharedWith} · full: {formatMoney(line.itemTotal, sym)}
                            </p>
                          )}
                        </div>
                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {formatMoney(line.share, sym)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Additional charges */}
              <div className="flex flex-col gap-0">
                {personShare.discountCredit > 0 && (
                  <BreakdownLine
                    label="Discount"
                    value={`−${formatMoney(personShare.discountCredit, sym)}`}
                    valueClass="text-emerald-600"
                  />
                )}
                {personShare.taxShare > 0 && (
                  <BreakdownLine label="Tax" value={`+${formatMoney(personShare.taxShare, sym)}`} valueClass="text-amber-600" />
                )}
                {personShare.serviceChargeShare > 0 && (
                  <BreakdownLine
                    label="Service Charge"
                    value={`+${formatMoney(personShare.serviceChargeShare, sym)}`}
                    valueClass="text-blue-600"
                  />
                )}
                {personShare.tipShare > 0 && (
                  <BreakdownLine label="Tip" value={`+${formatMoney(personShare.tipShare, sym)}`} valueClass="text-pink-600" />
                )}
              </div>

              {/* Total */}
              <div
                className="pt-3 flex items-center justify-between"
                style={{ borderTop: '1px solid rgba(0,0,0,0.08)' }}
              >
                <span className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Total</span>
                <motion.span
                  key={personShare.total}
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  className="text-xl font-bold gradient-text"
                >
                  {formatMoney(personShare.total, sym)}
                </motion.span>
              </div>

              {/* % of bill */}
              {bill.total > 0 && (
                <div className="glass rounded-xl px-3 py-2 flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Share of total bill</span>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    {((personShare.total / bill.total) * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

function BreakdownLine({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div
      className="flex items-center justify-between py-2"
      style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}
    >
      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className={cn('text-sm font-medium', valueClass ?? '')}
        style={!valueClass ? { color: 'var(--text-primary)' } : {}}
      >
        {value}
      </span>
    </div>
  )
}
