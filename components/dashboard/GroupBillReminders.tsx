'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, ArrowRight, Check } from 'lucide-react'
import Link from 'next/link'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/utils'
import type { GroupBillReminder } from '@/lib/dashboard'

interface Props {
  reminders: GroupBillReminder[]
}

export function GroupBillReminders({ reminders }: Props) {
  const { success, error: toastError } = useToast()
  const [local, setLocal] = useState<GroupBillReminder[]>(reminders)
  const [settling, setSettling] = useState<string | null>(null) // `${billId}:${fromPerson}:${toPerson}`

  // Track settled keys locally — must be declared BEFORE `visible` which reads from it
  const [settled] = useState(() => new Set<string>())

  // Remove bills that have no remaining reminders
  const visible = local.filter(
    (b) => b.reminders.filter((r) => !settled.has(`${b._id}:${r.fromPerson}:${r.toPerson}`)).length > 0
  )

  if (local.length === 0) return null

  async function markSettled(bill: GroupBillReminder, fromPerson: string, toPerson: string) {
    const key = `${bill._id}:${fromPerson}:${toPerson}`
    if (settling) return
    setSettling(key)
    try {
      const res = await fetch(`/api/group-bills/${bill._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'settle', fromPerson, toPerson }),
      })
      if (!res.ok) throw new Error()
      settled.add(key)
      // Remove the settled reminder from local state
      setLocal((prev) =>
        prev.map((b) => {
          if (b._id !== bill._id) return b
          const newReminders = b.reminders.filter(
            (r) => !(r.fromPerson === fromPerson && r.toPerson === toPerson)
          )
          return { ...b, reminders: newReminders }
        }).filter((b) => b.reminders.length > 0)
      )
      success('Settlement marked ✓')
    } catch {
      toastError('Failed to mark as settled. Try again.')
    } finally {
      setSettling(null)
    }
  }

  if (visible.length === 0) return null

  return (
    <GlassCard padding="md" level="regular">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-violet-500/12 border border-violet-500/20 flex items-center justify-center">
            <Users size={13} className="text-violet-500" />
          </div>
          <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Group Bill Reminders
          </h2>
        </div>
        <Link
          href="/app/expenses"
          className="flex items-center gap-1 text-[11px] hover:text-indigo-500 transition-colors"
          style={{ color: 'var(--text-faint)' }}
        >
          View all <ArrowRight size={10} />
        </Link>
      </div>

      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {local.map((bill) => {
            const activeReminders = bill.reminders.filter(
              (r) => !settled.has(`${bill._id}:${r.fromPerson}:${r.toPerson}`)
            )
            if (activeReminders.length === 0) return null

            return (
              <motion.div
                key={bill._id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22 }}
              >
                {/* Bill name */}
                <div className="flex items-center justify-between mb-1.5 px-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
                    {bill.name}
                  </p>
                  <Link
                    href="/app/expenses"
                    className="text-[10px] text-indigo-500 hover:text-indigo-600 transition-colors"
                  >
                    View Bill
                  </Link>
                </div>

                <div className="space-y-2">
                  {activeReminders.map((r) => {
                    const key = `${bill._id}:${r.fromPerson}:${r.toPerson}`
                    const isSettling = settling === key
                    const isOwedToMe = r.direction === 'owed_to_me'

                    return (
                      <motion.div
                        key={key}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center justify-between gap-3 glass-subtle rounded-xl px-4 py-3"
                      >
                        <div className="min-w-0">
                          {isOwedToMe ? (
                            <p className="text-[11px] font-semibold" style={{ color: 'var(--success)' }}>
                              {r.fromName} owes you
                            </p>
                          ) : (
                            <p className="text-[11px] font-semibold text-red-500">
                              You owe {r.toName}
                            </p>
                          )}
                          <p
                            className="text-[17px] font-bold tabular-nums mt-0.5"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {formatCurrency(r.amount, bill.currency)}
                          </p>
                        </div>

                        <GlassButton
                          variant="secondary"
                          size="xs"
                          loading={isSettling}
                          onClick={() => markSettled(bill, r.fromPerson, r.toPerson)}
                          icon={!isSettling ? <Check size={10} /> : undefined}
                        >
                          Settled
                        </GlassButton>
                      </motion.div>
                    )
                  })}
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </GlassCard>
  )
}
