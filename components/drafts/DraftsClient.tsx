'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, SlidersHorizontal, Plus } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { EmptyState, SkeletonCard } from '@/components/ui/Loading'
import { useToast } from '@/components/ui/Toast'
import { DraftCard } from '@/components/drafts/DraftCard'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Draft, DraftType } from '@/types/drafts'

// ─── Filter definitions ───────────────────────────────────────────────────────

type SortOption = 'updatedAt' | 'createdAt' | 'oldest'

interface FilterTab {
  value: DraftType | 'all'
  label: string
}

const FILTER_TABS: FilterTab[] = [
  { value: 'all',           label: 'All'           },
  { value: 'note',          label: 'Notes'         },
  { value: 'task',          label: 'Tasks'         },
  { value: 'habit',         label: 'Habits'        },
  { value: 'expense',       label: 'Expenses'      },
  { value: 'groupBill',     label: 'Group Bills'   },
  { value: 'moneyGiven',    label: 'Money Given'   },
  { value: 'moneyBorrowed', label: 'Money Borrowed'},
  { value: 'goal',          label: 'Goals'         },
  { value: 'project',       label: 'Projects'      },
  { value: 'subscription',  label: 'Subscriptions' },
  { value: 'savingsGoal',   label: 'Savings'       },
]

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'updatedAt', label: 'Recently updated' },
  { value: 'createdAt', label: 'Recently created' },
  { value: 'oldest',    label: 'Oldest first'     },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function DraftsClient() {
  const router = useRouter()
  const { error: toastError } = useToast()

  const [drafts,      setDrafts]      = useState<Draft[]>([])
  const [loading,     setLoading]     = useState(true)
  const [total,       setTotal]       = useState(0)
  const [page,        setPage]        = useState(1)
  const [hasMore,     setHasMore]     = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const [search,   setSearch]   = useState('')
  const [typeFilter, setTypeFilter] = useState<DraftType | 'all'>('all')
  const [sort,     setSort]     = useState<SortOption>('updatedAt')
  const [showSort, setShowSort] = useState(false)

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchDrafts = useCallback(async (reset = true) => {
    if (reset) {
      setLoading(true)
      setPage(1)
    } else {
      setLoadingMore(true)
    }

    try {
      const currentPage = reset ? 1 : page + 1
      const params = new URLSearchParams({
        sort,
        limit: '20',
        page:  String(currentPage),
      })
      if (typeFilter !== 'all') params.set('type', typeFilter)
      if (debouncedSearch)      params.set('q', debouncedSearch)

      const res = await fetch(`/api/drafts?${params}`)
      if (!res.ok) throw new Error()
      const data = await res.json()

      if (reset) {
        setDrafts(data.drafts)
      } else {
        setDrafts((prev) => [...prev, ...data.drafts])
        setPage(currentPage)
      }
      setTotal(data.total)
      setHasMore(data.hasMore)
    } catch {
      toastError('Failed to load drafts')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, debouncedSearch, sort])

  useEffect(() => { void fetchDrafts(true) }, [fetchDrafts])

  function handleDraftDeleted(id: string) {
    setDrafts((prev) => prev.filter((d) => d._id !== id))
    setTotal((t) => Math.max(0, t - 1))
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 flex flex-col gap-5 max-w-5xl mx-auto">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Drafts
          </h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Continue where you left off.
            {total > 0 && (
              <span className="ml-1">
                {total} draft{total !== 1 ? 's' : ''} saved.
              </span>
            )}
          </p>
        </div>

        <GlassButton
          variant="primary"
          size="sm"
          onClick={() => router.push('/app/dashboard')}
          icon={<Plus size={13} />}
        >
          <span className="hidden sm:inline">Create something</span>
          <span className="sm:hidden">Create</span>
        </GlassButton>
      </div>

      {/* ── Search + sort bar ── */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        {/* Search */}
        <div className="relative flex-1">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--text-faint)' }}
          />
          <input
            className="glass-input w-full rounded-xl pl-8.5 pr-9 py-2.5 text-sm"
            placeholder="Search drafts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search drafts"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 hover:opacity-80 transition-opacity"
              style={{ color: 'var(--text-faint)' }}
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Sort picker */}
        <div className="relative">
          <button
            onClick={() => setShowSort((v) => !v)}
            className={cn(
              'flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-sm glass transition-colors',
              showSort && 'bg-black/[0.04]'
            )}
            style={{ color: 'var(--text-secondary)' }}
          >
            <SlidersHorizontal size={13} />
            <span className="hidden sm:inline">{SORT_OPTIONS.find((s) => s.value === sort)?.label}</span>
          </button>
          <AnimatePresence>
            {showSort && (
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: 6 }}
                animate={{ opacity: 1, scale: 1,    y: 0 }}
                exit={{   opacity: 0, scale: 0.94, y: 4 }}
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                className="absolute right-0 top-full mt-1.5 z-20 rounded-xl py-1 min-w-[180px]"
                style={{
                  background: 'rgba(255,255,255,0.97)',
                  backdropFilter: 'blur(24px)',
                  border: '1px solid rgba(0,0,0,0.08)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.10)',
                }}
              >
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setSort(opt.value); setShowSort(false) }}
                    className={cn(
                      'w-full text-left px-4 py-2 text-sm transition-colors',
                      sort === opt.value ? 'font-semibold' : 'hover:bg-black/[0.04]'
                    )}
                    style={{ color: sort === opt.value ? 'var(--accent)' : 'var(--text-secondary)' }}
                  >
                    {opt.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Type filter tabs (horizontal scroll on mobile) ── */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setTypeFilter(tab.value)}
            className={cn(
              'shrink-0 px-3 py-1.5 rounded-xl text-[12px] font-medium transition-all whitespace-nowrap',
              typeFilter === tab.value
                ? 'glass-segment-active text-white'
                : 'glass hover:bg-black/[0.04]'
            )}
            style={typeFilter !== tab.value ? { color: 'var(--text-muted)' } : {}}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Drafts grid ── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : drafts.length === 0 ? (
        <EmptyState
          icon="📝"
          title={debouncedSearch || typeFilter !== 'all' ? 'No drafts match your search' : 'No drafts yet'}
          description={
            !debouncedSearch && typeFilter === 'all'
              ? 'Start something and save it for later. Your unfinished Notes, Tasks, Expenses and more will appear here.'
              : undefined
          }
          action={
            !debouncedSearch && typeFilter === 'all' ? (
              <GlassButton
                variant="primary"
                size="sm"
                onClick={() => router.push('/app/dashboard')}
                icon={<Plus size={13} />}
              >
                Create something
              </GlassButton>
            ) : undefined
          }
        />
      ) : (
        <>
          <motion.div
            layout
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
          >
            <AnimatePresence mode="popLayout">
              {drafts.map((draft) => (
                <DraftCard
                  key={draft._id}
                  draft={draft}
                  onDeleted={handleDraftDeleted}
                />
              ))}
            </AnimatePresence>
          </motion.div>

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <GlassButton
                variant="secondary"
                size="sm"
                onClick={() => fetchDrafts(false)}
                loading={loadingMore}
              >
                Load more
              </GlassButton>
            </div>
          )}
        </>
      )}
    </div>
  )
}
