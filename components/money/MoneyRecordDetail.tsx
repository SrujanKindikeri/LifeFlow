'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Plus, Pencil, Trash2, CheckCircle2,
  Calendar, FileText, User,
} from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassCard } from '@/components/ui/GlassCard'
import { ConfirmDialog } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { RecordPaymentModal } from './RecordPaymentModal'
import {
  formatPaiseDisplay, statusLabel, statusColor, statusBg,
  paymentDirectionText, shortDate,
} from './types'
import type { MoneyRecordData, MoneyPaymentData } from './types'
import { cn } from '@/lib/utils'

interface Props {
  record: MoneyRecordData
  onBack: () => void
  onRecordUpdated: (updated: MoneyRecordData) => void
  onRecordDeleted: (id: string) => void
}

export function MoneyRecordDetail({ record: initialRecord, onBack, onRecordUpdated, onRecordDeleted }: Props) {
  const { success, error } = useToast()
  const [record, setRecord] = useState<MoneyRecordData>(initialRecord)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [editPayment, setEditPayment] = useState<MoneyPaymentData | null>(null)
  const [deletePaymentTarget, setDeletePaymentTarget] = useState<MoneyPaymentData | null>(null)
  const [deleteRecordConfirm, setDeleteRecordConfirm] = useState(false)
  const [deletingPayment, setDeletingPayment] = useState(false)
  const [deletingRecord, setDeletingRecord] = useState(false)

  const pct = record.originalAmountMinor > 0
    ? Math.round((record.paidMinor / record.originalAmountMinor) * 100)
    : 0

  const isPaid = record.status === 'paid'

  function handlePaymentRecorded(updatedRecord: MoneyRecordData) {
    setRecord(updatedRecord)
    onRecordUpdated(updatedRecord)
  }

  function handlePaymentUpdated(updatedRecord: MoneyRecordData) {
    setRecord(updatedRecord)
    onRecordUpdated(updatedRecord)
    setEditPayment(null)
  }

  async function handleDeletePayment() {
    if (!deletePaymentTarget) return
    setDeletingPayment(true)
    try {
      const res = await fetch(
        `/api/money-records/${record._id}/payments/${deletePaymentTarget._id}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        error('Failed to delete payment')
        return
      }
      const data = await res.json()
      setRecord(data.record)
      onRecordUpdated(data.record)
      success('Payment deleted')
      setDeletePaymentTarget(null)
    } catch {
      error('Failed to delete payment')
    } finally {
      setDeletingPayment(false)
    }
  }

  async function handleDeleteRecord() {
    setDeletingRecord(true)
    try {
      const res = await fetch(`/api/money-records/${record._id}`, { method: 'DELETE' })
      if (!res.ok) {
        error('Failed to delete record')
        return
      }
      success('Record deleted')
      onRecordDeleted(record._id)
      setDeleteRecordConfirm(false)
    } catch {
      error('Failed to delete record')
    } finally {
      setDeletingRecord(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Back bar ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm hover:text-indigo-500 transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          <ArrowLeft size={15} />
          Back
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setDeleteRecordConfirm(true)}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
          style={{ color: 'var(--danger)' }}
        >
          <Trash2 size={13} />
          Delete
        </button>
      </div>

      {/* ── Hero card ── */}
      <GlassCard level="elevated" padding="md">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-lg font-bold shrink-0"
              style={{
                background: record.direction === 'given'
                  ? 'rgba(99,102,241,0.12)'
                  : 'rgba(249,115,22,0.12)',
                border: record.direction === 'given'
                  ? '1px solid rgba(99,102,241,0.25)'
                  : '1px solid rgba(249,115,22,0.25)',
                color: record.direction === 'given' ? '#6366f1' : '#f97316',
              }}
            >
              <User size={18} />
            </div>
            <div>
              <p className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {record.person.name}
              </p>
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {record.direction === 'given' ? 'owes you' : 'you owe them'}
              </p>
            </div>
          </div>

          <span
            className={cn(
              'text-[11px] font-semibold px-2.5 py-1 rounded-full border',
              statusBg(record.status),
              statusColor(record.status)
            )}
          >
            {statusLabel(record.status)}
          </span>
        </div>

        {/* Amount */}
        <div className="mb-4">
          <p className="text-[28px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {formatPaiseDisplay(record.originalAmountMinor, record.currency)}
          </p>
          <p className="text-[13px] mt-1" style={{ color: 'var(--text-muted)' }}>
            {record.direction === 'given'
              ? `You gave ${record.person.name}`
              : `You borrowed from ${record.person.name}`}
            {' · '}{shortDate(record.givenDate)}
          </p>
          {record.reason && (
            <p className="text-[13px] mt-1" style={{ color: 'var(--text-secondary)' }}>
              {record.reason}
            </p>
          )}
        </div>

        {/* Progress */}
        {!isPaid && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span style={{ color: 'var(--text-muted)' }}>
                {formatPaiseDisplay(record.paidMinor, record.currency)} paid
              </span>
              <span style={{ color: 'var(--text-muted)' }}>
                {formatPaiseDisplay(record.remainingMinor, record.currency)} remaining
              </span>
            </div>
            <div
              className="h-2.5 rounded-full overflow-hidden"
              style={{ background: 'rgba(0,0,0,0.07)' }}
            >
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
              />
            </div>
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>
              {pct}% repaid
            </p>
          </div>
        )}

        {/* Fully paid banner */}
        {isPaid && (
          <div
            className="flex items-center gap-2 px-4 py-3 rounded-xl mb-4"
            style={{
              background: 'rgba(22,163,74,0.08)',
              border: '1px solid rgba(22,163,74,0.2)',
            }}
          >
            <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
            <p className="text-sm font-semibold text-emerald-600">
              {record.direction === 'given'
                ? `${record.person.name} has fully repaid ${formatPaiseDisplay(record.originalAmountMinor, record.currency)}.`
                : `You have fully repaid ${formatPaiseDisplay(record.originalAmountMinor, record.currency)}.`}
            </p>
          </div>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <Calendar size={12} />
            {shortDate(record.givenDate)}
          </div>
          {record.dueDate && (
            <div
              className={cn(
                'flex items-center gap-1.5 text-[12px]',
                record.status === 'overdue' ? 'text-red-500' : ''
              )}
              style={record.status !== 'overdue' ? { color: 'var(--text-muted)' } : {}}
            >
              <Calendar size={12} />
              Due {shortDate(record.dueDate)}
              {record.status === 'overdue' && ' · Overdue'}
            </div>
          )}
          {record.note && (
            <div className="flex items-start gap-1.5 text-[12px] w-full" style={{ color: 'var(--text-muted)' }}>
              <FileText size={12} className="mt-0.5 shrink-0" />
              <span className="italic">&ldquo;{record.note}&rdquo;</span>
            </div>
          )}
        </div>

        {/* Record Payment CTA */}
        {!isPaid && (
          <div className="mt-5">
            <GlassButton
              variant="primary"
              onClick={() => setPaymentModalOpen(true)}
              className="w-full sm:w-auto"
            >
              <Plus size={14} />
              Record Payment
            </GlassButton>
          </div>
        )}
      </GlassCard>

      {/* ── Payment History ── */}
      <GlassCard padding="md">
        <div className="flex items-center gap-2 mb-4">
          <FileText size={14} style={{ color: 'var(--accent)' }} />
          <h3 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Payment History
          </h3>
          {record.payments.length > 0 && (
            <span
              className="text-[11px] px-2 py-0.5 rounded-full font-medium ml-auto"
              style={{
                background: 'rgba(99,102,241,0.1)',
                color: 'var(--accent)',
              }}
            >
              {record.payments.length} payment{record.payments.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {record.payments.length === 0 ? (
          <div className="py-8 text-center">
            <div
              className="w-10 h-10 rounded-2xl mx-auto mb-3 flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.05)' }}
            >
              💸
            </div>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No payments yet</p>
            {!isPaid && (
              <button
                onClick={() => setPaymentModalOpen(true)}
                className="text-xs mt-2 text-indigo-500 hover:text-indigo-600 transition-colors"
              >
                Record the first payment
              </button>
            )}
          </div>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div
              className="absolute left-4 top-2 bottom-2 w-px"
              style={{ background: 'rgba(99,102,241,0.15)' }}
            />
            <div className="space-y-3">
              {record.payments.map((payment, idx) => {
                const amountStr = formatPaiseDisplay(payment.amountMinor, record.currency)
                const dirText = paymentDirectionText(record.direction, record.person.name, amountStr)
                return (
                  <motion.div
                    key={payment._id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.06 }}
                    className="flex items-start gap-4 pl-0"
                  >
                    {/* Timeline dot */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 relative"
                      style={{
                        background: 'rgba(99,102,241,0.1)',
                        border: '2px solid rgba(99,102,241,0.25)',
                      }}
                    >
                      <span className="text-[10px] font-bold" style={{ color: 'var(--accent)' }}>
                        {idx + 1}
                      </span>
                    </div>

                    {/* Payment card */}
                    <div
                      className="flex-1 rounded-xl px-3.5 py-3"
                      style={{
                        background: 'rgba(0,0,0,0.025)',
                        border: '1px solid rgba(0,0,0,0.06)',
                      }}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div>
                          <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {amountStr}
                          </p>
                          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                            {dirText}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                            {shortDate(payment.paymentDate)}
                          </span>
                          <button
                            onClick={() => setEditPayment(payment)}
                            className="p-1 rounded-lg hover:bg-indigo-500/10 transition-colors"
                            style={{ color: 'var(--text-muted)' }}
                            aria-label="Edit payment"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            onClick={() => setDeletePaymentTarget(payment)}
                            className="p-1 rounded-lg hover:bg-red-500/10 transition-colors"
                            style={{ color: 'var(--text-muted)' }}
                            aria-label="Delete payment"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                      {payment.note && (
                        <p className="text-[11px] italic" style={{ color: 'var(--text-muted)' }}>
                          &ldquo;{payment.note}&rdquo;
                        </p>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </div>

            {/* Summary footer */}
            <div
              className="mt-4 flex items-center justify-between px-4 py-3 rounded-xl"
              style={{
                background: 'rgba(99,102,241,0.05)',
                border: '1px solid rgba(99,102,241,0.1)',
              }}
            >
              <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Original:
                </span>{' '}
                {formatPaiseDisplay(record.originalAmountMinor, record.currency)}
              </div>
              <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Paid:
                </span>{' '}
                {formatPaiseDisplay(record.paidMinor, record.currency)}
              </div>
              <div className="text-[12px]" style={{ color: isPaid ? 'var(--success-text, #16a34a)' : 'var(--text-secondary)' }}>
                <span className="font-semibold">Remaining:</span>{' '}
                {isPaid ? '₹0' : formatPaiseDisplay(record.remainingMinor, record.currency)}
              </div>
            </div>
          </div>
        )}
      </GlassCard>

      {/* ── Modals ── */}

      {/* Record new payment */}
      <RecordPaymentModal
        record={record}
        isOpen={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        onPaymentRecorded={handlePaymentRecorded}
      />

      {/* Edit existing payment */}
      <AnimatePresence>
        {editPayment && (
          <RecordPaymentModal
            key={editPayment._id}
            record={record}
            isOpen={!!editPayment}
            onClose={() => setEditPayment(null)}
            onPaymentRecorded={handlePaymentRecorded}
            editPayment={editPayment}
            onPaymentUpdated={handlePaymentUpdated}
          />
        )}
      </AnimatePresence>

      {/* Delete payment confirm */}
      <ConfirmDialog
        isOpen={!!deletePaymentTarget}
        onClose={() => setDeletePaymentTarget(null)}
        onConfirm={handleDeletePayment}
        title="Delete this payment?"
        message={
          deletePaymentTarget
            ? `${formatPaiseDisplay(deletePaymentTarget.amountMinor, record.currency)}${deletePaymentTarget.note ? ` · "${deletePaymentTarget.note}"` : ''} — This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        danger
        loading={deletingPayment}
      />

      {/* Delete record confirm */}
      <ConfirmDialog
        isOpen={deleteRecordConfirm}
        onClose={() => setDeleteRecordConfirm(false)}
        onConfirm={handleDeleteRecord}
        title="Delete this record?"
        message={`This will delete the ${record.direction === 'given' ? 'money given' : 'money borrowed'} record for ${record.person.name} and all its payment history. This cannot be undone.`}
        confirmLabel="Delete Record"
        danger
        loading={deletingRecord}
      />
    </div>
  )
}
