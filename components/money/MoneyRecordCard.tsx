'use client'

import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import {
  formatPaiseDisplay, statusLabel, statusColor, statusBg,
  shortDate,
} from './types'
import type { MoneyRecordData } from './types'
import { cn } from '@/lib/utils'

interface Props {
  record: MoneyRecordData
  onClick: () => void
}

export function MoneyRecordCard({ record, onClick }: Props) {
  const pct = record.originalAmountMinor > 0
    ? Math.round((record.paidMinor / record.originalAmountMinor) * 100)
    : 0
  const isPaid = record.status === 'paid'

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.012, y: -1 }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className="w-full text-left rounded-2xl p-4 transition-all"
      style={{
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(0,0,0,0.07)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar */}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0"
            style={{
              background: record.direction === 'given'
                ? 'rgba(99,102,241,0.12)'
                : 'rgba(249,115,22,0.12)',
              color: record.direction === 'given' ? '#6366f1' : '#f97316',
            }}
          >
            {record.person.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p
              className="text-[14px] font-semibold truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {record.person.name}
            </p>
            <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
              {record.direction === 'given' ? 'owes you' : 'you owe'}
              {' · '}
              {shortDate(record.givenDate)}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <p className="text-[16px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {isPaid
              ? formatPaiseDisplay(record.originalAmountMinor, record.currency)
              : formatPaiseDisplay(record.remainingMinor, record.currency)}
          </p>
          <span
            className={cn(
              'text-[10px] font-semibold px-2 py-0.5 rounded-full border',
              statusBg(record.status),
              statusColor(record.status)
            )}
          >
            {statusLabel(record.status)}
          </span>
        </div>
      </div>

      {/* Reason */}
      {record.reason && (
        <p className="text-[12px] mb-3 truncate" style={{ color: 'var(--text-secondary)' }}>
          {record.reason}
        </p>
      )}

      {/* Progress bar */}
      {!isPaid && record.paidMinor > 0 && (
        <div className="mb-3">
          <div
            className="h-1.5 rounded-full overflow-hidden mb-1"
            style={{ background: 'rgba(0,0,0,0.07)' }}
          >
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
            {formatPaiseDisplay(record.paidMinor, record.currency)} paid
            {' · '}
            {formatPaiseDisplay(record.remainingMinor, record.currency)} left
          </p>
        </div>
      )}

      {/* Due date warning */}
      {record.dueDate && !isPaid && (
        <p
          className={cn(
            'text-[11px] mb-2',
            record.status === 'overdue' ? 'text-red-500' : ''
          )}
          style={record.status !== 'overdue' ? { color: 'var(--text-faint)' } : {}}
        >
          {record.status === 'overdue'
            ? `⚠ Overdue · Due ${shortDate(record.dueDate)}`
            : `Due ${shortDate(record.dueDate)}`}
        </p>
      )}

      {/* Fully paid badge */}
      {isPaid && (
        <p className="text-[11px] font-medium text-emerald-500 mb-1">
          ✓ Fully repaid
        </p>
      )}

      <div className="flex items-center justify-end" style={{ color: 'var(--text-faint)' }}>
        <ArrowRight size={13} />
      </div>
    </motion.button>
  )
}
