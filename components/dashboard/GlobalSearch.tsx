'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import {
  Search, X, StickyNote, CheckCircle2, Flame,
  Receipt, Users, Plus, Loader2, HandCoins,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SearchResult } from '@/app/api/search/route'

// ─── Icon map ─────────────────────────────────────────────────────────────────
const TYPE_META: Record<SearchResult['type'], { label: string; icon: React.ReactNode; color: string }> = {
  note:        { label: 'Note',           icon: <StickyNote  size={13} />, color: 'text-yellow-500' },
  task:        { label: 'Task',           icon: <CheckCircle2 size={13}/>, color: 'text-indigo-500' },
  habit:       { label: 'Habit',          icon: <Flame       size={13} />, color: 'text-orange-500' },
  expense:     { label: 'Expense',        icon: <Receipt     size={13} />, color: 'text-emerald-500'},
  groupBill:   { label: 'Group Bill',     icon: <Users       size={13} />, color: 'text-violet-500' },
  moneyRecord: { label: 'Money Tracker',  icon: <HandCoins   size={13} />, color: 'text-blue-500'   },
}

const QUICK_ACTIONS = [
  { label: '+ Create Note',    type: 'note'      as const },
  { label: '+ Add Task',       type: 'task'      as const },
  { label: '+ Add Expense',    type: 'expense'   as const },
  { label: '+ Split Bill',     type: 'splitbill' as const },
]

interface Props {
  isOpen: boolean
  onClose: () => void
  onQuickAdd?: (type: 'note' | 'task' | 'expense' | 'splitbill') => void
}

export function GlobalSearch({ isOpen, onClose, onQuickAdd }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus input when opened; reset state via ref to avoid cascading renders
  const pendingResetRef = useRef(false)
  useEffect(() => {
    if (isOpen) {
      pendingResetRef.current = true
      setTimeout(() => {
        if (pendingResetRef.current) {
          setQuery('')
          setResults([])
          setActiveIdx(0)
          pendingResetRef.current = false
        }
        inputRef.current?.focus()
      }, 0)
    } else {
      pendingResetRef.current = false
    }
  }, [isOpen])

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 1) { setResults([]); setSearching(false); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setResults(data.results ?? [])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(query), 280)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, doSearch])

  // Group results by type
  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    acc[r.type] = [...(acc[r.type] ?? []), r]
    return acc
  }, {})

  // Flat list for keyboard nav
  const flat = results

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, flat.length - 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)) }
      if (e.key === 'Enter' && flat[activeIdx]) {
        navigate(flat[activeIdx])
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [isOpen, flat, activeIdx, onClose]) // eslint-disable-line react-hooks/exhaustive-deps

  function navigate(result: SearchResult) {
    router.push(result.href)
    onClose()
  }

  const typeOrder: SearchResult['type'][] = ['note', 'task', 'habit', 'expense', 'groupBill', 'moneyRecord']
  let globalIdx = 0

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Global search"
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(6px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            className="relative w-full max-w-lg"
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,   scale: 1    }}
            exit={{ opacity: 0,   y: -12,  scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.85 }}
          >
            <div
              className="glass-floating rounded-2xl overflow-hidden"
              style={{ boxShadow: 'var(--glass-shadow-xl)' }}
            >
              {/* Input row */}
              <div
                className="flex items-center gap-3 px-4 py-3.5"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                {searching
                  ? <Loader2 size={16} className="animate-spin flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                  : <Search size={16} className="flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                }
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setActiveIdx(0) }}
                  placeholder="Search LifeFlow…"
                  className="flex-1 bg-transparent outline-none text-sm"
                  style={{ color: 'var(--text-primary)' }}
                  autoComplete="off"
                  aria-label="Search"
                />
                {query && (
                  <button
                    onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus() }}
                    className="nav-hover p-1 rounded-lg transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label="Clear search"
                  >
                    <X size={13} />
                  </button>
                )}
                <kbd
                  className="hidden sm:block text-[10px] px-1.5 py-0.5 rounded font-mono"
                  style={{ background: 'var(--border-strong)', color: 'var(--text-faint)' }}
                >
                  ESC
                </kbd>
              </div>

              {/* Results */}
              <div className="max-h-[55vh] overflow-y-auto">
                {/* No query — show quick actions */}
                {!query && (
                  <div className="p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-2"
                      style={{ color: 'var(--text-faint)' }}>
                      Quick Actions
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {QUICK_ACTIONS.map((a) => (
                        <button
                          key={a.type}
                          onClick={() => { onQuickAdd?.(a.type); onClose() }}
                          className="flex items-center gap-2 text-[12px] px-3 py-2.5 rounded-xl glass hover:bg-black/[0.04] transition-colors text-left"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          <Plus size={12} className="text-indigo-500 shrink-0" />
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Searching */}
                {query && searching && results.length === 0 && (
                  <div className="py-8 text-center">
                    <Loader2 size={18} className="animate-spin mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Searching…</p>
                  </div>
                )}

                {/* No results */}
                {query && !searching && results.length === 0 && (
                  <div className="py-8 text-center px-4">
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      No results found for &ldquo;{query}&rdquo;
                    </p>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>
                      Try a different keyword.
                    </p>
                    {/* Quick actions even when no results */}
                    <div className="mt-4 grid grid-cols-2 gap-1.5">
                      {QUICK_ACTIONS.map((a) => (
                        <button
                          key={a.type}
                          onClick={() => { onQuickAdd?.(a.type); onClose() }}
                          className="flex items-center gap-1.5 text-[11px] px-3 py-2 rounded-xl glass hover:bg-black/[0.04] transition-colors"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          <Plus size={11} className="text-indigo-500" />
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Grouped results */}
                {query && !searching && results.length > 0 && (
                  <div className="p-2 space-y-3">
                    {typeOrder.map((type) => {
                      const group = grouped[type]
                      if (!group?.length) return null
                      const meta = TYPE_META[type]
                      return (
                        <div key={type}>
                          <p className="text-[10px] font-semibold uppercase tracking-wider px-2 mb-1 flex items-center gap-1.5"
                            style={{ color: 'var(--text-faint)' }}>
                            <span className={meta.color}>{meta.icon}</span>
                            {meta.label}s
                          </p>
                          {group.map((r) => {
                            const idx = globalIdx++
                            const isActive = idx === activeIdx
                            return (
                              <button
                                key={r._id}
                                onClick={() => navigate(r)}
                                onMouseEnter={() => setActiveIdx(idx)}
                                className={cn(
                                  'w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-colors',
                                  isActive ? 'bg-indigo-500/08' : 'hover:bg-black/[0.04]'
                                )}
                              >
                                <span className={cn('mt-0.5 flex-shrink-0', meta.color)}>{meta.icon}</span>
                                <div className="min-w-0">
                                  <p className="text-[13px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                                    {r.title}
                                  </p>
                                  {r.subtitle && (
                                    <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                                      {r.subtitle}
                                    </p>
                                  )}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Footer hint */}
              <div
                className="flex items-center justify-between px-4 py-2"
                style={{ borderTop: '1px solid rgba(0,0,0,0.05)' }}
              >
                <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                  ↑↓ navigate · Enter select · Esc close
                </span>
                <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                  ⌘K
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
