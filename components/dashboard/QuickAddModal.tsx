'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Check } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea, GlassSelect } from '@/components/ui/GlassInput'
import { SmartAmountInput } from '@/components/ui/SmartAmountInput'
import { parseAmountExpression } from '@/lib/amountParser'
import { useToast } from '@/components/ui/Toast'
import { cn, EXPENSE_CATEGORIES, HABIT_ICONS } from '@/lib/utils'
import type { DashboardTask } from '@/lib/dashboard'
import { AddMoneyRecordModal } from '@/components/money/AddMoneyRecordModal'

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuickAddType = 'task' | 'habit' | 'expense' | 'note' | 'splitbill' | 'money_given' | 'money_borrowed' | null

interface QuickAddModalProps {
  type: QuickAddType
  onClose: () => void
  onTaskAdded?: (task: DashboardTask) => void
}

// ─── Shell: backdrop + slide-up panel ────────────────────────────────────────

const TITLES: Record<NonNullable<QuickAddType>, string> = {
  task:           '+ New Task',
  habit:          '+ New Habit',
  expense:        '+ Add Expense',
  note:           '+ Quick Note',
  splitbill:      '+ Split a Bill',
  money_given:    '+ Money Given',
  money_borrowed: '+ Money Borrowed',
}

export function QuickAddModal({ type, onClose, onTaskAdded }: QuickAddModalProps) {
  // Money types delegate to the dedicated modal
  if (type === 'money_given' || type === 'money_borrowed') {
    return (
      <AddMoneyRecordModal
        isOpen={!!type}
        defaultDirection={type === 'money_given' ? 'given' : 'borrowed'}
        onClose={onClose}
        onCreated={onClose}
      />
    )
  }

  return (
    <AnimatePresence>
      {type && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            className={cn(
              'glass-floating relative w-full z-10',
              'rounded-t-3xl sm:rounded-2xl',
              'max-h-[90vh] overflow-y-auto',
              type === 'splitbill' ? 'sm:max-w-lg' : 'sm:max-w-md'
            )}
            style={{ boxShadow: 'var(--glass-shadow-xl)' }}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            {/* Drag handle (mobile) */}
            <div className="flex justify-center pt-3 sm:hidden">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border-strong)' }} />
            </div>

            {/* Header */}
            <div
              className="flex items-center justify-between px-5 pt-4 sm:pt-5 pb-4"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {TITLES[type]}
              </h2>
              <button
                onClick={onClose}
                className="nav-hover p-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>

            {/* Body */}
            <div className="p-5">
              {type === 'task' && <AddTaskForm onClose={onClose} onAdded={onTaskAdded} />}
              {type === 'habit' && <AddHabitForm onClose={onClose} />}
              {type === 'expense' && <AddExpenseForm onClose={onClose} />}
              {type === 'note' && <AddNoteForm onClose={onClose} />}
              {type === 'splitbill' && <AddSplitBillForm onClose={onClose} />}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

// ─── ADD TASK ─────────────────────────────────────────────────────────────────

function AddTaskForm({
  onClose,
  onAdded,
}: {
  onClose: () => void
  onAdded?: (task: DashboardTask) => void
}) {
  const { success, error } = useToast()
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium')
  const [dueTime, setDueTime] = useState('')

  const today = new Date().toISOString().split('T')[0]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          priority,
          dueDate: today,
          dueTime: dueTime || undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        success('Task added!')
        onAdded?.({
          _id: data.task._id,
          title: data.task.title,
          completed: false,
          priority,
          dueDate: today,
          dueTime: dueTime || undefined,
        })
        onClose()
      } else {
        error('Failed to add task')
      }
    } catch {
      error('Failed to add task')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <GlassInput
        label="Task title"
        placeholder="What needs to be done?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        required
      />

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Priority</label>
          <div className="flex gap-2">
            {(['low', 'medium', 'high'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={cn(
                  'flex-1 py-2 rounded-xl text-xs font-medium border transition-all capitalize',
                  priority === p
                    ? p === 'high'
                      ? 'bg-red-500/15 border-red-500/35 text-red-600'
                      : p === 'medium'
                      ? 'bg-amber-500/15 border-amber-500/35 text-amber-600'
                      : 'bg-emerald-500/15 border-emerald-500/35 text-emerald-600'
                    : 'glass border-black/[0.07] hover:bg-black/[0.04]'
                )}
                style={priority !== p ? { color: 'var(--text-muted)' } : {}}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <GlassInput
          label="Time (optional)"
          type="time"
          value={dueTime}
          onChange={(e) => setDueTime(e.target.value)}
        />
      </div>

      <GlassButton type="submit" variant="primary" fullWidth loading={saving} disabled={!title.trim()}>
        <Check size={14} />
        Add Task
      </GlassButton>
    </form>
  )
}

// ─── ADD HABIT ────────────────────────────────────────────────────────────────

function AddHabitForm({ onClose }: { onClose: () => void }) {
  const { success, error } = useToast()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('⭐')
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/habits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), icon, frequency }),
      })
      if (res.ok) {
        success('Habit created!')
        onClose()
      } else {
        error('Failed to create habit')
      }
    } catch {
      error('Failed to create habit')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <GlassInput
        label="Habit name"
        placeholder="e.g. Drink water, Exercise…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        required
      />

      <div>
        <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Icon</label>
        <div className="grid grid-cols-10 gap-1.5">
          {HABIT_ICONS.map((ic) => (
            <button
              key={ic}
              type="button"
              onClick={() => setIcon(ic)}
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center text-base transition-all',
                icon === ic
                  ? 'bg-indigo-500/15 border border-indigo-500/35 scale-110'
                  : 'glass hover:bg-black/[0.05]'
              )}
            >
              {ic}
            </button>
          ))}
        </div>
      </div>

      <GlassSelect
        label="Frequency"
        value={frequency}
        onChange={(v) => setFrequency(v as 'daily' | 'weekly')}
        options={[
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
        ]}
      />

      <GlassButton type="submit" variant="primary" fullWidth loading={saving} disabled={!name.trim()}>
        <Plus size={14} />
        Create Habit
      </GlassButton>
    </form>
  )
}

// ─── ADD EXPENSE ──────────────────────────────────────────────────────────────

function AddExpenseForm({ onClose }: { onClose: () => void }) {
  const { success, error } = useToast()
  const [saving, setSaving] = useState(false)
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('food')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = parseAmountExpression(amount)
    const amt = parsed.value
    if (!amt || amt <= 0) return
    setSaving(true)
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          category,
          description: description.trim() || undefined,
          date,
        }),
      })
      if (res.ok) {
        success('Expense added!')
        onClose()
      } else {
        error('Failed to add expense')
      }
    } catch {
      error('Failed to add expense')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <SmartAmountInput
        label="Amount"
        value={amount}
        onChange={(raw) => setAmount(raw)}
        currency="INR"
        autoFocus
        required
      />

      <div>
        <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>Category</label>
        <div className="grid grid-cols-4 gap-2">
          {EXPENSE_CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => setCategory(cat.value)}
              className={cn(
                'flex flex-col items-center gap-1 py-2.5 rounded-xl text-xs border transition-all',
                category === cat.value
                  ? 'bg-indigo-500/12 border-indigo-500/35 text-indigo-600'
                  : 'glass border-black/[0.07] hover:bg-black/[0.04]'
              )}
              style={category !== cat.value ? { color: 'var(--text-secondary)' } : {}}
            >
              <span className="text-base">{cat.emoji}</span>
              <span className="truncate w-full text-center">{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      <GlassInput
        label="Description (optional)"
        placeholder="What was this for?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <GlassInput
        label="Date"
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        required
      />

      <GlassButton
        type="submit"
        variant="primary"
        fullWidth
        loading={saving}
        disabled={!amount || (parseAmountExpression(amount).value ?? 0) <= 0}
      >
        <Check size={14} />
        Add Expense
      </GlassButton>
    </form>
  )
}

// ─── ADD NOTE ─────────────────────────────────────────────────────────────────

function AddNoteForm({ onClose }: { onClose: () => void }) {
  const { success, error } = useToast()
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      })
      if (res.ok) {
        success('Note saved!')
        onClose()
      } else {
        error('Failed to save note')
      }
    } catch {
      error('Failed to save note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <GlassInput
        label="Title"
        placeholder="Note title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        required
      />

      <GlassTextarea
        label="Content"
        placeholder="Write your note here…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={5}
      />

      <GlassButton type="submit" variant="primary" fullWidth loading={saving} disabled={!title.trim()}>
        <Check size={14} />
        Save Note
      </GlassButton>
    </form>
  )
}

// ─── SPLIT BILL ───────────────────────────────────────────────────────────────

function AddSplitBillForm({ onClose }: { onClose: () => void }) {
  const { success, error } = useToast()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [total, setTotal] = useState('')
  const [people, setPeople] = useState<string[]>(['', ''])

  function addPerson() {
    setPeople((prev) => [...prev, ''])
  }

  function updatePerson(i: number, val: string) {
    setPeople((prev) => prev.map((p, idx) => (idx === i ? val : p)))
  }

  function removePerson(i: number) {
    if (people.length <= 2) return
    setPeople((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = parseAmountExpression(total)
    const amt = parsed.value
    const filledPeople = people.filter((p) => p.trim())
    if (!name.trim() || !amt || filledPeople.length < 2) return
    setSaving(true)

    const peopleList = filledPeople.map((p, i) => ({
      id: `p${i}`,
      name: p.trim(),
      paidAmount: i === 0 ? amt : 0,
    }))
    const perHead = amt / peopleList.length
    const items = [
      {
        id: 'item1',
        name: name.trim(),
        price: amt,
        quantity: 1,
        assignedPeople: peopleList.map((p) => p.id),
      },
    ]

    try {
      const res = await fetch('/api/group-bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          date: new Date().toISOString().split('T')[0],
          currency: 'INR',
          people: peopleList,
          items,
          splitMode: 'equal',
          customSplits: [],
          discountType: 'amount',
          discountValue: 0,
          taxType: 'amount',
          taxValue: 0,
          serviceChargeType: 'amount',
          serviceChargeValue: 0,
          tipType: 'amount',
          tipValue: 0,
          subtotal: amt,
          discountAmount: 0,
          taxAmount: 0,
          serviceChargeAmount: 0,
          tipAmount: 0,
          total: amt,
          settlements: peopleList.slice(1).map((p) => ({
            fromPerson: p.id,
            toPerson: peopleList[0].id,
            amount: Math.round(perHead * 100) / 100,
            settled: false,
          })),
          savedAsExpense: false,
        }),
      })
      if (res.ok) {
        success('Bill split created!')
        onClose()
      } else {
        error('Failed to create bill split')
      }
    } catch {
      error('Failed to create bill split')
    } finally {
      setSaving(false)
    }
  }

  const filledPeople = people.filter((p) => p.trim())
  const amt = parseAmountExpression(total).value ?? 0
  const perHead = filledPeople.length >= 2 && amt > 0 ? amt / filledPeople.length : 0

  return (
    <form onSubmit={submit} className="space-y-4">
      <GlassInput
        label="Bill name"
        placeholder="e.g. Dinner with Friends"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        required
      />

      <SmartAmountInput
        label="Total amount"
        value={total}
        onChange={(raw) => setTotal(raw)}
        currency="INR"
        required
      />

      <div>
        <label className="text-sm font-medium block mb-2" style={{ color: 'var(--text-secondary)' }}>People</label>
        <div className="space-y-2">
          {people.map((person, i) => (
            <div key={i} className="flex items-center gap-2">
              <GlassInput
                placeholder={i === 0 ? 'You (paid)' : `Person ${i + 1}`}
                value={person}
                onChange={(e) => updatePerson(i, e.target.value)}
                className="flex-1"
              />
              {people.length > 2 && (
                <button
                  type="button"
                  onClick={() => removePerson(i)}
                  className="p-2 rounded-lg glass hover:bg-red-500/10 hover:text-red-500 transition-colors shrink-0"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addPerson}
          className="mt-2 text-xs text-indigo-500 hover:text-indigo-600 flex items-center gap-1 transition-colors"
        >
          <Plus size={11} /> Add person
        </button>
      </div>

      {perHead > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="glass rounded-xl px-4 py-3 flex items-center justify-between"
        >
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Per person</span>
          <span className="text-sm font-bold text-indigo-600">₹{perHead.toFixed(2)}</span>
        </motion.div>
      )}

      <GlassButton
        type="submit"
        variant="primary"
        fullWidth
        loading={saving}
        disabled={!name.trim() || !total || (parseAmountExpression(total).value ?? 0) <= 0 || filledPeople.length < 2}
      >
        <Check size={14} />
        Create Split
      </GlassButton>
    </form>
  )
}
