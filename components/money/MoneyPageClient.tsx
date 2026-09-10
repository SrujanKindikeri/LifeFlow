'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, ArrowUpRight, ArrowDownLeft,
  IndianRupee, Filter, Loader2, TrendingUp, TrendingDown,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'
import { MoneyRecordCard } from './MoneyRecordCard'
import { MoneyRecordDetail } from './MoneyRecordDetail'
import { AddMoneyRecordModal } from './AddMoneyRecordModal'
import { formatPaiseDisplay } from './types'
import type { MoneyRecordData, MoneyDirection, MoneyStatus } from './types'
import { cn } from '@/lib/utils'

type TabValue = 'all' | 'given' | 'borrowed'
type SortValue = 'newest' | 'oldest' | 'highest' | 'highest_outstanding' | 'due_soon'
type FilterStatus = 'all' | MoneyStatus

const TABS: { value: TabValue; label: string; icon: React.ReactNode }[] = [
  { value: 'all',      label: 'All',      icon: <IndianRupee size={13} /> },
  { value: 'given',    label: 'Given',    icon: <ArrowUpRight size={13} /> },
  { value: 'borrowed', label: 'Borrowed', icon: <ArrowDownLeft size={13} /> },
]

const STATUS_FILTERS: { value: FilterStatus; label: string }[] = [
  { value: 'all',            label: 'All' },
  { value: 'pending',        label: 'Pending' },
  { value: 'partially_paid', label: 'Partial' },
  { value: 'paid',           label: 'Paid' },
  { value: 'overdue',        label: 'Overdue' },
]

const SORT_OPTIONS: { value: SortValue; label: string }[] = [
  { value: 'newest',            label: 'Newest' },
  { value: 'oldest',            label: 'Oldest' },
  { value: 'highest',           label: 'Highest Amount' },
  { value: 'highest_outstanding', label: 'Highest Outstanding' },
  { value: 'due_soon',          label: 'Due Soon' },
]

export function MoneyPageClient() {
  const { error } = useToast()

  const [records, setRecords]         = useState<MoneyRecordData[]>([])
  const [loading, setLoading]         = useState(true)
  const [tab, setTab]                 = useState<TabValue>('all')
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')
  const [sort, setSort]               = useState<SortValue>('newest')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [addModal, setAddModal]       = useState<MoneyDirection | null>(null)
  const [detailRecord, setDetailRecord] = useState<MoneyRecordData | null>(null)

  // ── Summary totals ─────────────────────────────────────────────────────────
  const toCollectMinor = records
    .filter((r) => r.direction === 'given' && r.status !== 'paid')
    .reduce((s, r) => s + r.remainingMinor, 0)
  const toPayMinor = records
    .filter((r) => r.direction === 'borrowed' && r.status !== 'paid')
    .reduce((s, r) => s + r.remainingMinor, 0)

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({ sort })
      if (tab !== 'all') params.set('direction', tab)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/money-records?${params.toString()}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setRecords(data.records ?? [])
    } catch {
      error('Failed to load money records')
    } finally {
      setLoading(false)
    }
  }, [tab, statusFilter, sort, error])

  useEffect(() => {
    fetchRecords()
  }, [fetchRecords])

  function handleCreated(record: MoneyRecordData) {
    setRecords((prev) => [record, ...prev])
  }

  function handleRecordUpdated(updated: MoneyRecordData) {
    setRecords((prev) => prev.map((r) => r._id === updated._id ? updated : r))
    if (detailRecord?._id === updated._id) setDetailRecord(updated)
  }

  function handleRecordDeleted(id: string) {
    setRecords((prev) => prev.filter((r) => r._id !== id))
    setDetailRecord(null)
  }

  // ── Detail view ────────────────────────────────────────────────────────────
  if (detailRecord) {
    return (
      <MoneyRecordDetail
        record={detailRecord}
        onBack={() => setDetailRecord(null)}
        onRecordUpdated={handleRecordUpdated}
        onRecordDeleted={handleRecordDeleted}
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold" style={{ color: 'var(--text-primary)' }}>
            Money Tracker
          </h1>
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Track who owes you and whom you owe
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GlassButton
            variant="ghost"
            size="sm"
            onClick={() => setFiltersOpen((v) => !v)}
            style={{ color: filtersOpen ? 'var(--accent)' : 'var(--text-muted)' }}
          >
            <Filter size={13} />
          </GlassButton>
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 gap-3">
        <motion.div
          className="rounded-2xl p-4"
          style={{
            background: 'rgba(99,102,241,0.07)',
            border: '1px solid rgba(99,102,241,0.15)',
          }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp size={13} className="text-indigo-500" />
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              To Collect
            </p>
          </div>
          <p className="text-[20px] font-bold tabular-nums text-indigo-600">
            {formatPaiseDisplay(toCollectMinor)}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
            people owe you
          </p>
        </motion.div>

        <motion.div
          className="rounded-2xl p-4"
          style={{
            background: 'rgba(249,115,22,0.07)',
            border: '1px solid rgba(249,115,22,0.15)',
          }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingDown size={13} className="text-orange-500" />
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              To Pay
            </p>
          </div>
          <p className="text-[20px] font-bold tabular-nums text-orange-500">
            {formatPaiseDisplay(toPayMinor)}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
            you owe others
          </p>
        </motion.div>
      </div>

      {/* ── Tabs ── */}
      <div
        className="flex gap-1 p-1 rounded-xl"
        style={{ background: 'rgba(0,0,0,0.05)' }}
      >
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all',
              tab === t.value
                ? 'text-white shadow-sm'
                : ''
            )}
            style={
              tab === t.value
                ? { background: 'var(--accent)', boxShadow: '0 2px 8px rgba(37,99,235,0.2)' }
                : { color: 'var(--text-muted)' }
            }
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Filters panel ── */}
      <AnimatePresence>
        {filtersOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <GlassCard padding="sm">
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>
                    Status
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {STATUS_FILTERS.map((f) => (
                      <button
                        key={f.value}
                        onClick={() => setStatusFilter(f.value)}
                        className={cn(
                          'px-3 py-1 rounded-full text-xs font-medium border transition-all',
                          statusFilter === f.value
                            ? 'text-white border-transparent'
                            : 'border-black/[0.08]'
                        )}
                        style={
                          statusFilter === f.value
                            ? { background: 'var(--accent)' }
                            : { color: 'var(--text-muted)', background: 'rgba(0,0,0,0.03)' }
                        }
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>
                    Sort by
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SORT_OPTIONS.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => setSort(s.value)}
                        className={cn(
                          'px-3 py-1 rounded-full text-xs font-medium border transition-all',
                          sort === s.value
                            ? 'text-white border-transparent'
                            : 'border-black/[0.08]'
                        )}
                        style={
                          sort === s.value
                            ? { background: 'var(--accent)' }
                            : { color: 'var(--text-muted)', background: 'rgba(0,0,0,0.03)' }
                        }
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Add buttons ── */}
      <div className="grid grid-cols-2 gap-2">
        <GlassButton
          variant="secondary"
          fullWidth
          onClick={() => setAddModal('given')}
          style={{ border: '1px solid rgba(99,102,241,0.25)', color: '#6366f1' }}
        >
          <Plus size={13} />
          Money Given
        </GlassButton>
        <GlassButton
          variant="secondary"
          fullWidth
          onClick={() => setAddModal('borrowed')}
          style={{ border: '1px solid rgba(249,115,22,0.25)', color: '#f97316' }}
        >
          <Plus size={13} />
          Money Borrowed
        </GlassButton>
      </div>

      {/* ── Records list ── */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      ) : records.length === 0 ? (
        <GlassCard padding="md">
          <div className="py-10 text-center">
            <div className="text-4xl mb-3">💸</div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
              No records yet
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
              Start tracking who owes you and whom you owe.
            </p>
            <div className="flex gap-2 justify-center">
              <GlassButton size="sm" variant="primary" onClick={() => setAddModal('given')}>
                <Plus size={12} /> Money Given
              </GlassButton>
              <GlassButton size="sm" variant="secondary" onClick={() => setAddModal('borrowed')}>
                <Plus size={12} /> Money Borrowed
              </GlassButton>
            </div>
          </div>
        </GlassCard>
      ) : (
        <div className="space-y-2.5">
          <AnimatePresence initial={false}>
            {records.map((record, idx) => (
              <motion.div
                key={record._id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ delay: idx * 0.04 }}
              >
                <MoneyRecordCard
                  record={record}
                  onClick={() => setDetailRecord(record)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* ── Add Modal ── */}
      <AddMoneyRecordModal
        isOpen={!!addModal}
        defaultDirection={addModal ?? 'given'}
        onClose={() => setAddModal(null)}
        onCreated={handleCreated}
      />
    </div>
  )
}
