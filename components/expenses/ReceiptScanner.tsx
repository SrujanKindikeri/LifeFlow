'use client'

import { useState, useRef } from 'react'
import { Scan, Check, X, AlertTriangle } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { GlassInput, GlassSelect } from '@/components/ui/GlassInput'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { EXPENSE_CATEGORIES } from '@/lib/utils'

/**
 * Receipt Scanner — client-side extraction via browser OCR heuristics.
 *
 * Since no OCR API is available, we extract from image filenames and
 * allow the user to fill in all fields manually. The key requirement is:
 * NEVER auto-save — always show a confirmation form first.
 */

interface ExtractedReceipt {
  merchant: string
  amount: string
  date: string
  category: string
  items: string
  confidence: 'high' | 'partial' | 'low'
  notes: string
}

const CAT_OPTIONS = EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: `${c.emoji} ${c.label}` }))

function extractFromFilename(filename: string): Partial<ExtractedReceipt> {
  // Best-effort extraction from filename — all fields are editable by user
  const lower = filename.toLowerCase().replace(/\.(jpg|jpeg|png|pdf|webp)$/i, '')
  const amountMatch = lower.match(/(\d+(?:\.\d{1,2})?)/)?.[1]
  const dateMatch = lower.match(/(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4}|\d{8})/)?.[1]

  return {
    merchant:   '',
    amount:     amountMatch ?? '',
    date:       dateMatch ?? new Date().toISOString().split('T')[0],
    category:   'other',
    items:      '',
    confidence: 'low',
    notes:      `Receipt file: ${filename}`,
  }
}

export function ReceiptScanner({ onExpenseAdded }: { onExpenseAdded: () => void }) {
  const { success, error: showError } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [extracted, setExtracted] = useState<ExtractedReceipt | null>(null)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [fields, setFields] = useState<ExtractedReceipt>({
    merchant: '', amount: '', date: new Date().toISOString().split('T')[0],
    category: 'other', items: '', confidence: 'low', notes: '',
  })

  function handleFile(file: File) {
    setScanning(true)

    // Simulate a brief scan delay for UX
    setTimeout(() => {
      const partial = extractFromFilename(file.name)
      const result: ExtractedReceipt = {
        merchant:   partial.merchant ?? '',
        amount:     partial.amount ?? '',
        date:       partial.date ?? new Date().toISOString().split('T')[0],
        category:   partial.category ?? 'other',
        items:      partial.items ?? '',
        confidence: partial.confidence ?? 'low',
        notes:      partial.notes ?? '',
      }
      setExtracted(result)
      setFields(result)
      setScanning(false)
      setModalOpen(true)
    }, 800)
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    handleFile(file)
    // Reset input so same file can be selected again
    e.target.value = ''
  }

  function setField(k: keyof ExtractedReceipt, v: string) {
    setFields((p) => ({ ...p, [k]: v }))
  }

  async function confirm() {
    if (!fields.amount || !parseFloat(fields.amount)) {
      showError('Amount is required'); return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount:      parseFloat(fields.amount),
          category:    fields.category,
          description: [fields.merchant, fields.items, fields.notes].filter(Boolean).join(' · ').slice(0,200) || 'Receipt expense',
          date:        fields.date,
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error) }
      success('Expense added from receipt')
      setModalOpen(false)
      setExtracted(null)
      onExpenseAdded()
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Failed to add expense')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={onFileChange} />

      <GlassButton
        variant="secondary"
        size="sm"
        icon={scanning ? undefined : <Scan size={14}/>}
        loading={scanning}
        onClick={() => fileRef.current?.click()}
      >
        {scanning ? 'Scanning…' : 'Scan Receipt'}
      </GlassButton>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Review Receipt" size="md">
        {extracted && (
          <div className="flex flex-col gap-4">
            {/* Confidence banner */}
            <div
              className="flex items-start gap-2 p-3 rounded-xl"
              style={{
                background: extracted.confidence === 'low' ? 'rgba(245,158,11,0.08)' : 'rgba(22,163,74,0.08)',
                border: `1px solid ${extracted.confidence === 'low' ? 'rgba(245,158,11,0.2)' : 'rgba(22,163,74,0.2)'}`,
              }}
            >
              {extracted.confidence === 'low'
                ? <AlertTriangle size={14} style={{ color: '#b45309', flexShrink: 0, marginTop: 1 }} />
                : <Check size={14} style={{ color: '#16a34a', flexShrink: 0, marginTop: 1 }} />}
              <p className="text-xs leading-relaxed" style={{ color: extracted.confidence === 'low' ? '#b45309' : '#15803d' }}>
                {extracted.confidence === 'low'
                  ? 'Could not automatically extract receipt details. Please fill in the fields below before confirming.'
                  : 'Receipt scanned. Please review and confirm the details.'}
              </p>
            </div>

            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              ⚠️ This expense will NOT be saved until you click &quot;Confirm &amp; Add Expense&quot;.
            </p>

            <GlassInput label="Merchant / Store" value={fields.merchant} onChange={(e) => setField('merchant', e.target.value)} placeholder="e.g. Big Bazaar" />
            <div className="grid grid-cols-2 gap-3">
              <GlassInput label="Amount (₹)" type="number" min={0.01} step={0.01} value={fields.amount} onChange={(e) => setField('amount', e.target.value)} placeholder="0.00" />
              <GlassInput label="Date" type="date" value={fields.date} onChange={(e) => setField('date', e.target.value)} />
            </div>
            <GlassSelect label="Category" value={fields.category} onChange={(v) => setField('category', v)} options={CAT_OPTIONS} />
            <GlassInput label="Items (optional)" value={fields.items} onChange={(e) => setField('items', e.target.value)} placeholder="Bread, milk, eggs…" />

            <div className="flex gap-2.5 justify-end">
              <GlassButton variant="ghost" size="sm" icon={<X size={13}/>} onClick={() => setModalOpen(false)}>Cancel</GlassButton>
              <GlassButton variant="primary" size="sm" loading={saving} icon={<Check size={13}/>} onClick={confirm}>
                Confirm &amp; Add Expense
              </GlassButton>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
