'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, CheckSquare, StickyNote, Wallet, Edit3, X } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassTextarea } from '@/components/ui/GlassInput'
import { SmartAmountInput } from '@/components/ui/SmartAmountInput'
import { parseAmountExpression } from '@/lib/amountParser'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'

// ─── Pure client-side NLP parsing ────────────────────────────────────────────
// No external AI. Simple deterministic rules. Confidence determines whether
// to show a confirmation or ask the user to select type manually.

interface ParsedItem {
  type: 'task' | 'note' | 'money_given' | 'money_borrowed' | 'expense'
  confidence: 'high' | 'low'
  fields: Record<string, string | number | undefined>
  raw: string
}

function parseInput(raw: string): ParsedItem {
  const text = raw.trim()
  const lower = text.toLowerCase()

  // Amount extraction
  const amountMatch = text.match(/[₹$]?\s*(\d+(?:[,\d]*)?(?:\.\d{1,2})?)/i)
  const amount = amountMatch
    ? parseFloat(amountMatch[1].replace(/,/g, ''))
    : undefined

  // Person extraction: "Rahul owes me" / "I owe Rahul" / "from Rahul" / "to Rahul"
  const owesToMe = text.match(/(\w+)\s+owes\s+me/i)
  const iOweTo   = text.match(/(?:i owe|pay)\s+(\w+)/i)
  const person   = owesToMe?.[1] ?? iOweTo?.[1]

  // Date extraction: simple keywords
  const dateMap: Record<string, () => string> = {
    today:     () => new Date().toISOString().split('T')[0],
    tomorrow:  () => { const d = new Date(); d.setDate(d.getDate()+1); return d.toISOString().split('T')[0] },
    monday:    () => nextWeekday(1),
    tuesday:   () => nextWeekday(2),
    wednesday: () => nextWeekday(3),
    thursday:  () => nextWeekday(4),
    friday:    () => nextWeekday(5),
    saturday:  () => nextWeekday(6),
    sunday:    () => nextWeekday(0),
  }
  let date: string | undefined
  for (const [key, fn] of Object.entries(dateMap)) {
    if (lower.includes(key)) { date = fn(); break }
  }

  // Classify
  if (owesToMe && amount) {
    return { type: 'money_given', confidence: 'high', fields: { person, amount, date }, raw: text }
  }
  if (iOweTo && amount) {
    return { type: 'money_borrowed', confidence: 'high', fields: { person, amount, date }, raw: text }
  }
  if (/\bspent\b|\bpaid\b|\bbought\b|\bpurchased\b|\bspend\b/.test(lower) && amount) {
    // Try to detect category
    const category = lower.includes('food') || lower.includes('eat') || lower.includes('lunch') || lower.includes('dinner') || lower.includes('breakfast')
      ? 'food'
      : lower.includes('transport') || lower.includes('uber') || lower.includes('auto') || lower.includes('cab') || lower.includes('bus')
      ? 'transport'
      : lower.includes('shop') || lower.includes('buy') || lower.includes('bought')
      ? 'shopping'
      : 'other'
    return { type: 'expense', confidence: 'high', fields: { amount, date, category, description: text }, raw: text }
  }
  if (/\bidea\b|\bnote\b|\bremember\b|\bthink\b|\bwrite\b/.test(lower)) {
    return { type: 'note', confidence: 'high', fields: { title: text.slice(0,80), content: text }, raw: text }
  }
  if (/\bdue\b|\bdeadline\b|\bsubmit\b|\bcomplete\b|\bfinish\b|\bdo\b|\bschedule\b|\bremind\b|\bmeeting\b/.test(lower) || date) {
    return { type: 'task', confidence: 'high', fields: { title: text.slice(0,150), dueDate: date, priority: lower.includes('urgent') || lower.includes('important') ? 'high' : 'medium' }, raw: text }
  }

  // Fallback: could be task or note
  return { type: 'task', confidence: 'low', fields: { title: text.slice(0,150) }, raw: text }
}

function nextWeekday(target: number): string {
  const d = new Date()
  const curr = d.getDay()
  const diff = (target - curr + 7) % 7 || 7
  d.setDate(d.getDate() + diff)
  return d.toISOString().split('T')[0]
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  task:           <CheckSquare size={16} />,
  note:           <StickyNote  size={16} />,
  expense:        <Wallet      size={16} />,
  money_given:    <Wallet      size={16} />,
  money_borrowed: <Wallet      size={16} />,
}

const TYPE_LABELS: Record<string, string> = {
  task: 'Task', note: 'Note', expense: 'Personal Expense',
  money_given: 'Money Given', money_borrowed: 'Money Borrowed',
}

const TYPE_COLORS: Record<string, string> = {
  task: '#3b82f6', note: '#8b5cf6', expense: '#ef4444',
  money_given: '#10b981', money_borrowed: '#f59e0b',
}

const ALL_TYPES: ParsedItem['type'][] = ['task','note','expense','money_given','money_borrowed']

export function SmartInbox({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { success, error: showError } = useToast()
  const [input, setInput] = useState('')
  const [parsed, setParsed] = useState<ParsedItem | null>(null)
  const [fields, setFields] = useState<Record<string, string | number | undefined>>({})
  const [saving, setSaving] = useState(false)

  function analyse() {
    if (!input.trim()) return
    const result = parseInput(input)
    setParsed(result)
    // Store amountExpr as a string version of the detected amount
    const amountNum = result.fields.amount
    setFields({
      ...result.fields,
      amountExpr: amountNum != null ? String(amountNum) : '',
    })
  }

  function changeType(type: ParsedItem['type']) {
    if (!parsed) return
    setParsed({ ...parsed, type, confidence: 'high' })
  }

  function setField(k: string, v: string | number | undefined) {
    setFields((p) => ({ ...p, [k]: v }))
  }

  async function confirm() {
    if (!parsed) return
    setSaving(true)
    // Resolve the expression to a numeric amount
    const resolvedAmount = parseAmountExpression(String(fields.amountExpr ?? fields.amount ?? '')).value ?? fields.amount
    try {
      const today = new Date().toISOString().split('T')[0]

      if (parsed.type === 'task') {
        const res = await fetch('/api/tasks', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: fields.title ?? parsed.raw, priority: fields.priority ?? 'medium', dueDate: fields.dueDate ?? '', recurring: 'none' }),
        })
        if (!res.ok) throw new Error('Failed to create task')
        success('Task created')
      } else if (parsed.type === 'note') {
        const res = await fetch('/api/notes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: fields.title ?? parsed.raw.slice(0,80), content: fields.content ?? parsed.raw }),
        })
        if (!res.ok) throw new Error('Failed to create note')
        success('Note created')
      } else if (parsed.type === 'expense') {
        const res = await fetch('/api/expenses', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: resolvedAmount, category: fields.category ?? 'other', description: fields.description ?? parsed.raw, date: fields.date ?? today }),
        })
        if (!res.ok) throw new Error('Failed to create expense')
        success('Expense added')
      } else if (parsed.type === 'money_given' || parsed.type === 'money_borrowed') {
        const res = await fetch('/api/money-records', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            person: { name: fields.person ?? 'Unknown' },
            direction: parsed.type === 'money_given' ? 'given' : 'borrowed',
            amount: resolvedAmount,
            reason: parsed.raw,
            givenDate: fields.date ?? today,
          }),
        })
        if (!res.ok) throw new Error('Failed to create money record')
        success('Money record created')
      }

      setInput(''); setParsed(null); setFields({})
      onClose()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to save')
    } finally { setSaving(false) }
  }

  function reset() { setParsed(null); setFields({}) }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Smart Inbox" size="md">
      <div className="flex flex-col gap-4">
        <GlassTextarea
          placeholder={`Type anything…\n"Rahul owes me ₹500"\n"Pay electricity bill Friday"\n"Spent ₹250 on food"\n"Project idea: build a weather app"`}
          value={input}
          onChange={(e) => { setInput(e.target.value); if (parsed) reset() }}
          rows={3}
        />

        {!parsed && (
          <GlassButton
            variant="primary"
            icon={<Sparkles size={14} />}
            onClick={analyse}
            disabled={!input.trim()}
            fullWidth
          >
            Analyse
          </GlassButton>
        )}

        <AnimatePresence>
          {parsed && (
            <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }} className="flex flex-col gap-4">

              {/* Detected type */}
              <div className="p-3 rounded-xl" style={{ background: `${TYPE_COLORS[parsed.type]}10`, border: `1px solid ${TYPE_COLORS[parsed.type]}22` }}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2" style={{ color: TYPE_COLORS[parsed.type] }}>
                    {TYPE_ICONS[parsed.type]}
                    <span className="font-semibold text-sm">{TYPE_LABELS[parsed.type]}</span>
                  </div>
                  {parsed.confidence === 'low' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.15)', color: '#b45309' }}>
                      Low confidence — verify
                    </span>
                  )}
                </div>
              </div>

              {/* Type selector */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>Change type</p>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => changeType(t)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${parsed.type===t ? 'text-white' : 'hover:bg-black/[0.04]'}`}
                      style={{ background: parsed.type===t ? TYPE_COLORS[t] : 'transparent', color: parsed.type===t ? '#fff' : 'var(--text-muted)' }}
                    >
                      {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Editable fields */}
              <div className="flex flex-col gap-3">
                {(parsed.type === 'task') && (
                  <>
                    <GlassInput label="Title" value={String(fields.title ?? '')} onChange={(e) => setField('title', e.target.value)} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <GlassInput label="Due Date" type="date" value={String(fields.dueDate ?? '')} onChange={(e) => setField('dueDate', e.target.value)} />
                    </div>
                  </>
                )}
                {parsed.type === 'note' && (
                  <>
                    <GlassInput label="Title" value={String(fields.title ?? '')} onChange={(e) => setField('title', e.target.value)} />
                    <GlassTextarea label="Content" value={String(fields.content ?? '')} onChange={(e) => setField('content', e.target.value)} rows={3} />
                  </>
                )}
                {parsed.type === 'expense' && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <SmartAmountInput
                        label="Amount (₹)"
                        value={String(fields.amountExpr ?? '')}
                        onChange={(raw) => setField('amountExpr', raw)}
                        currency="INR"
                      />
                      <GlassInput label="Date" type="date" value={String(fields.date ?? '')} onChange={(e) => setField('date', e.target.value)} />
                    </div>
                    <GlassInput label="Description" value={String(fields.description ?? '')} onChange={(e) => setField('description', e.target.value)} />
                  </>
                )}
                {(parsed.type === 'money_given' || parsed.type === 'money_borrowed') && (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <GlassInput label="Person" value={String(fields.person ?? '')} onChange={(e) => setField('person', e.target.value)} />
                      <SmartAmountInput
                        label="Amount (₹)"
                        value={String(fields.amountExpr ?? '')}
                        onChange={(raw) => setField('amountExpr', raw)}
                        currency="INR"
                      />
                    </div>
                    <GlassInput label="Date" type="date" value={String(fields.date ?? new Date().toISOString().split('T')[0])} onChange={(e) => setField('date', e.target.value)} />
                    <p className="text-xs" style={{ color: '#b45309' }}>
                      ⚠️ Review carefully before confirming — financial records cannot be automatically reversed.
                    </p>
                  </>
                )}
              </div>

              {/* Action row — wraps on very narrow screens (320px) */}
              <div className="flex flex-wrap gap-2 justify-end">
                <GlassButton variant="ghost" size="sm" icon={<X size={13}/>} onClick={reset}>Back</GlassButton>
                <GlassButton variant="secondary" size="sm" icon={<Edit3 size={13}/>} onClick={reset}>Edit</GlassButton>
                <GlassButton variant="primary" size="sm" loading={saving} onClick={confirm} className="flex-1 sm:flex-none min-w-0">
                  <span className="truncate">Create {TYPE_LABELS[parsed.type]}</span>
                </GlassButton>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  )
}
