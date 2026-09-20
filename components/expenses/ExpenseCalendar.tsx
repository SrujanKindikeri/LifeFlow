'use client'

/**
 * ExpenseCalendar
 * ──────────────────────────────────────────────────────────────────────────────
 * Liquid Glass calendar popover for the Personal Expenses tab.
 *
 * • Fetches per-day totals from GET /api/expenses/calendar?month=YYYY-MM
 * • Shows a dot + total for days with expenses
 * • Highlights today with a ring; selected date gets a blue-tinted pill
 * • Desktop: floating popover below the trigger button
 * • Mobile: bottom sheet
 * • Full keyboard navigation (arrow keys, Home/End, PgUp/PgDn, Enter/Space)
 * • ARIA roles: grid / gridcell / rowgroup
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DaySummary {
  date: string  // YYYY-MM-DD
  count: number
  total: number
}

interface ExpenseCalendarProps {
  /** Currently selected date (YYYY-MM-DD) or null */
  selectedDate: string | null
  onSelectDate: (date: string) => void
  /** Trigger element ref — used to position popover on desktop */
  triggerRef: React.RefObject<HTMLButtonElement | null>
  isOpen: boolean
  onClose: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const DAY_FULL   = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

function toYYYYMM(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

function todayString(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * Build the 6×7 (max) grid of day-cells for a given month.
 * Week starts on Monday (index 0 = Mon … 6 = Sun).
 * Cells before the 1st and after the last are null (empty).
 */
function buildGrid(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1).getDay() // 0=Sun … 6=Sat
  const offset   = firstDay === 0 ? 6 : firstDay - 1 // convert to Mon-based
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (string | null)[] = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  // Pad to a full week row
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExpenseCalendar({
  selectedDate,
  onSelectDate,
  triggerRef,
  isOpen,
  onClose,
}: ExpenseCalendarProps) {
  const today = todayString()
  const nowDate = new Date()

  const [viewYear,  setViewYear]  = useState(nowDate.getFullYear())
  const [viewMonth, setViewMonth] = useState(nowDate.getMonth()) // 0-based

  // Day-summary data from the API — keyed by YYYY-MM-DD
  const [dayData,    setDayData]    = useState<Record<string, DaySummary>>({})
  const [loadingCal, setLoadingCal] = useState(false)

  // Focused cell for keyboard nav (YYYY-MM-DD or null)
  const [focusedDate, setFocusedDate] = useState<string | null>(null)

  const gridRef      = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ── Fetch calendar data when month changes ──────────────────────────────────
  const fetchMonth = useCallback(async (year: number, month: number) => {
    setLoadingCal(true)
    try {
      const ym = toYYYYMM(year, month)
      const res = await fetch(`/api/expenses/calendar?month=${ym}`)
      if (!res.ok) return
      const data: { days: DaySummary[] } = await res.json()
      const map: Record<string, DaySummary> = {}
      for (const d of data.days) map[d.date] = d
      setDayData(map)
    } catch {
      // silent — calendar still renders, just without indicators
    } finally {
      setLoadingCal(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchMonth(viewYear, viewMonth)
  }, [isOpen, viewYear, viewMonth, fetchMonth])

  // When calendar opens, jump view to the selected date's month (if set)
  useEffect(() => {
    if (isOpen && selectedDate) {
      const [y, m] = selectedDate.split('-').map(Number)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setViewYear(y)
      setViewMonth(m - 1)
      setFocusedDate(selectedDate)
    } else if (isOpen) {
      setFocusedDate(`${String(viewYear)}-${String(viewMonth + 1).padStart(2, '0')}-01`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Focus first cell when calendar opens
  useEffect(() => {
    if (isOpen && focusedDate) {
      const cell = gridRef.current?.querySelector<HTMLElement>(`[data-date="${focusedDate}"]`)
      cell?.focus()
    }
  }, [isOpen, focusedDate])

  // ── Month navigation ────────────────────────────────────────────────────────
  function prevMonth() {
    setViewMonth((m) => {
      if (m === 0) { setViewYear((y) => y - 1); return 11 }
      return m - 1
    })
  }

  function nextMonth() {
    setViewMonth((m) => {
      if (m === 11) { setViewYear((y) => y + 1); return 0 }
      return m + 1
    })
  }

  function goToToday() {
    const n = new Date()
    setViewYear(n.getFullYear())
    setViewMonth(n.getMonth())
    setFocusedDate(today)
  }

  // ── Grid ────────────────────────────────────────────────────────────────────
  const grid = useMemo(() => buildGrid(viewYear, viewMonth), [viewYear, viewMonth])

  // ── Date selection ──────────────────────────────────────────────────────────
  function handleSelect(date: string) {
    onSelectDate(date)
    onClose()
  }

  // ── Keyboard navigation ─────────────────────────────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!focusedDate) return
    const [fy, fm, fd] = focusedDate.split('-').map(Number)
    let next: Date | null = null

    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); next = new Date(fy, fm - 1, fd - 1); break
      case 'ArrowRight': e.preventDefault(); next = new Date(fy, fm - 1, fd + 1); break
      case 'ArrowUp':    e.preventDefault(); next = new Date(fy, fm - 1, fd - 7); break
      case 'ArrowDown':  e.preventDefault(); next = new Date(fy, fm - 1, fd + 7); break
      case 'Home':       e.preventDefault(); next = new Date(fy, fm - 1, 1); break
      case 'End': {
        e.preventDefault()
        const last = new Date(fy, fm, 0).getDate()
        next = new Date(fy, fm - 1, last)
        break
      }
      case 'PageUp':   e.preventDefault(); prevMonth(); return
      case 'PageDown': e.preventDefault(); nextMonth(); return
      case 'Enter':
      case ' ':
        e.preventDefault()
        handleSelect(focusedDate)
        return
      case 'Escape':
        e.preventDefault()
        onClose()
        return
      default: return
    }

    if (!next) return
    const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
    // If we moved to a different month, navigate there
    if (next.getFullYear() !== viewYear || next.getMonth() !== viewMonth) {
      setViewYear(next.getFullYear())
      setViewMonth(next.getMonth())
    }
    setFocusedDate(nextStr)
  }

  // After month change from keyboard nav, refocus the cell
  useEffect(() => {
    if (!focusedDate || !isOpen) return
    requestAnimationFrame(() => {
      const cell = gridRef.current?.querySelector<HTMLElement>(`[data-date="${focusedDate}"]`)
      cell?.focus()
    })
  }, [focusedDate, viewYear, viewMonth, isOpen])

  // ── Click outside to close ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    function onPointerDown(e: PointerEvent) {
      if (
        containerRef.current && !containerRef.current.contains(e.target as Node) &&
        triggerRef.current  && !triggerRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [isOpen, onClose, triggerRef])

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <motion.div
            className="fixed inset-0 z-40 sm:hidden"
            style={{ background: 'rgba(0,0,0,0.20)', backdropFilter: 'blur(3px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onPointerDown={onClose}
          />

          {/* Calendar panel — bottom sheet on mobile, popover on desktop */}
          <motion.div
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Expense calendar"
            className={cn(
              // Common
              'z-50 w-full select-none',
              // Mobile: fixed bottom sheet
              'fixed bottom-0 left-0 right-0 rounded-t-[28px]',
              // Desktop: absolute popover below trigger (position handled by parent wrapper)
              'sm:absolute sm:bottom-auto sm:left-auto sm:right-auto sm:rounded-2xl sm:w-[340px]',
            )}
            style={{
              background: 'var(--glass-floating-bg)',
              backdropFilter: 'blur(40px) saturate(1.9)',
              WebkitBackdropFilter: 'blur(40px) saturate(1.9)',
              border: '1px solid var(--glass-floating-border)',
              boxShadow: 'var(--glass-shadow-lg)',
            }}
            // Mobile: slide up from bottom; desktop: fade + scale from top
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{   opacity: 0, y: 16,  scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.85 }}
          >
            {/* Drag handle (mobile) */}
            <div className="flex justify-center pt-3 pb-0 sm:hidden">
              <div className="w-9 h-1 rounded-full" style={{ background: 'var(--border-strong)' }} />
            </div>

            <div className="p-4 pb-5 sm:p-5">
              {/* ── Header: month nav ── */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={prevMonth}
                  aria-label="Previous month"
                  className="p-1.5 rounded-xl transition-colors nav-hover focus-ring"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <ChevronLeft size={16} />
                </button>

                <div className="text-center flex-1 px-2">
                  <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {MONTH_NAMES[viewMonth]} {viewYear}
                  </span>
                  {loadingCal && (
                    <span className="ml-2 inline-block w-3 h-3 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin-slow" />
                  )}
                </div>

                <div className="flex items-center gap-0.5">
                  {/* Today shortcut */}
                  <button
                    onClick={goToToday}
                    aria-label="Go to today"
                    className="px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors nav-hover focus-ring"
                    style={{ color: 'var(--accent)' }}
                  >
                    Today
                  </button>
                  <button
                    onClick={nextMonth}
                    aria-label="Next month"
                    className="p-1.5 rounded-xl transition-colors nav-hover focus-ring"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <ChevronRight size={16} />
                  </button>
                  {/* Close (desktop) */}
                  <button
                    onClick={onClose}
                    aria-label="Close calendar"
                    className="hidden sm:flex p-1.5 rounded-xl transition-colors nav-hover focus-ring ml-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* ── Day-of-week header ── */}
              <div
                className="grid grid-cols-7 mb-1"
                role="row"
                aria-hidden="true"
              >
                {DAY_LABELS.map((d, i) => (
                  <div
                    key={i}
                    className="text-center text-[10px] font-semibold uppercase tracking-wider pb-2"
                    style={{ color: 'var(--text-faint)' }}
                    aria-label={DAY_FULL[i]}
                  >
                    {d}
                  </div>
                ))}
              </div>

              {/* ── Calendar grid ── */}
              <div
                ref={gridRef}
                className="grid grid-cols-7 gap-y-0.5"
                role="grid"
                aria-label={`${MONTH_NAMES[viewMonth]} ${viewYear}`}
                onKeyDown={handleKeyDown}
              >
                {grid.map((date, idx) => {
                  if (!date) {
                    return (
                      <div
                        key={`empty-${idx}`}
                        role="gridcell"
                        aria-hidden="true"
                        className="h-10"
                      />
                    )
                  }

                  const summary   = dayData[date]
                  const isToday   = date === today
                  const isSelected = date === selectedDate
                  const hasFocus  = date === focusedDate
                  const hasData   = !!summary

                  return (
                    <DayCell
                      key={date}
                      date={date}
                      summary={summary ?? null}
                      isToday={isToday}
                      isSelected={isSelected}
                      isFocused={hasFocus}
                      hasData={hasData}
                      onSelect={handleSelect}
                      onFocus={setFocusedDate}
                    />
                  )
                })}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─── DayCell ──────────────────────────────────────────────────────────────────

interface DayCellProps {
  date:       string
  summary:    DaySummary | null
  isToday:    boolean
  isSelected: boolean
  isFocused:  boolean
  hasData:    boolean
  onSelect:   (date: string) => void
  onFocus:    (date: string) => void
}

function DayCell({
  date,
  summary,
  isToday,
  isSelected,
  isFocused,
  hasData,
  onSelect,
  onFocus,
}: DayCellProps) {
  const dayNum = parseInt(date.split('-')[2], 10)

  // Human-readable label for screen reader
  const [y, m, d] = date.split('-')
  const dateObj = new Date(Number(y), Number(m) - 1, Number(d))
  const ariaLabel = [
    dateObj.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    isToday ? ', today' : '',
    isSelected ? ', selected' : '',
    hasData ? `, ${summary!.count} expense${summary!.count !== 1 ? 's' : ''}, ${formatCurrency(summary!.total)}` : ', no expenses',
  ].join('')

  return (
    <div
      role="gridcell"
      data-date={date}
      tabIndex={isFocused ? 0 : -1}
      aria-label={ariaLabel}
      aria-selected={isSelected}
      onClick={() => onSelect(date)}
      onFocus={() => onFocus(date)}
      className={cn(
        'relative flex flex-col items-center justify-start pt-1.5 pb-1',
        'rounded-xl cursor-pointer transition-colors duration-100',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
        // Hover state for unselected days
        !isSelected && 'nav-hover',
      )}
      style={{
        // Selected: blue-tinted glass circle/pill
        ...(isSelected ? {
          background: 'rgba(37,99,235,0.10)',
          border: '1px solid rgba(37,99,235,0.22)',
          boxShadow: '0 1px 4px rgba(37,99,235,0.10)',
        } : {}),
      }}
    >
      {/* Date number */}
      <span
        className={cn(
          'text-[12px] font-semibold leading-none relative z-10',
          'w-6 h-6 flex items-center justify-center rounded-full',
          // Today ring
          isToday && !isSelected && 'ring-1 ring-blue-500/60',
          isToday && isSelected  && 'ring-1 ring-blue-600/50',
        )}
        style={{
          color: isSelected
            ? 'var(--accent)'
            : isToday
              ? 'var(--accent)'
              : 'var(--text-primary)',
          fontWeight: (isToday || isSelected) ? 700 : 500,
        }}
      >
        {dayNum}
      </span>

      {/* Expense indicator */}
      {hasData && summary && (
        <div className="flex flex-col items-center gap-px mt-0.5">
          {/* Dot */}
          <span
            className="w-1 h-1 rounded-full"
            style={{ background: isSelected ? 'var(--accent)' : 'var(--accent-light)' }}
          />
          {/* Amount label */}
          <span
            className="text-[8px] leading-none tabular-nums font-medium"
            style={{
              color: isSelected ? 'var(--accent-text)' : 'var(--text-muted)',
              maxWidth: '38px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {formatCurrency(summary.total)}
          </span>
        </div>
      )}
    </div>
  )
}
