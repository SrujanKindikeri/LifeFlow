'use client'

/**
 * GroupBillCalendar
 * ──────────────────────────────────────────────────────────────────────────────
 * Liquid Glass calendar popover for the Group Bills tab.
 *
 * • Fetches per-day group bill data from GET /api/group-bills/calendar?month=YYYY-MM
 * • Days with bills show bill name(s) and total
 * • Same Liquid Glass design as ExpenseCalendar — desktop popover / mobile sheet
 * • Full keyboard navigation + ARIA grid roles
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BillSummary {
  name: string
  total: number
  currency: string
}

interface DayBills {
  date: string
  bills: BillSummary[]
}

interface GroupBillCalendarProps {
  selectedDate: string | null
  onSelectDate: (date: string) => void
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

function buildGrid(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1).getDay()
  const offset   = firstDay === 0 ? 6 : firstDay - 1
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GroupBillCalendar({
  selectedDate,
  onSelectDate,
  triggerRef,
  isOpen,
  onClose,
}: GroupBillCalendarProps) {
  const today   = todayString()
  const nowDate = new Date()

  const [viewYear,  setViewYear]  = useState(nowDate.getFullYear())
  const [viewMonth, setViewMonth] = useState(nowDate.getMonth())

  // day data keyed by YYYY-MM-DD
  const [dayData,    setDayData]    = useState<Record<string, DayBills>>({})
  const [loadingCal, setLoadingCal] = useState(false)
  const [focusedDate, setFocusedDate] = useState<string | null>(null)

  const gridRef      = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchMonth = useCallback(async (year: number, month: number) => {
    setLoadingCal(true)
    try {
      const ym  = toYYYYMM(year, month)
      const res = await fetch(`/api/group-bills/calendar?month=${ym}`)
      if (!res.ok) return
      const data: { days: DayBills[] } = await res.json()
      const map: Record<string, DayBills> = {}
      for (const d of data.days) map[d.date] = d
      setDayData(map)
    } catch {
      // silent
    } finally {
      setLoadingCal(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchMonth(viewYear, viewMonth)
  }, [isOpen, viewYear, viewMonth, fetchMonth])

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

  useEffect(() => {
    if (isOpen && focusedDate) {
      const cell = gridRef.current?.querySelector<HTMLElement>(`[data-date="${focusedDate}"]`)
      cell?.focus()
    }
  }, [isOpen, focusedDate])

  // ── Month nav ───────────────────────────────────────────────────────────────
  function prevMonth() {
    setViewMonth((m) => { if (m === 0) { setViewYear((y) => y - 1); return 11 } return m - 1 })
  }
  function nextMonth() {
    setViewMonth((m) => { if (m === 11) { setViewYear((y) => y + 1); return 0 } return m + 1 })
  }
  function goToToday() {
    const n = new Date()
    setViewYear(n.getFullYear())
    setViewMonth(n.getMonth())
    setFocusedDate(today)
  }

  const grid = useMemo(() => buildGrid(viewYear, viewMonth), [viewYear, viewMonth])

  function handleSelect(date: string) {
    onSelectDate(date)
    onClose()
  }

  // ── Keyboard nav ────────────────────────────────────────────────────────────
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
        next = new Date(fy, fm - 1, new Date(fy, fm, 0).getDate())
        break
      }
      case 'PageUp':   e.preventDefault(); prevMonth(); return
      case 'PageDown': e.preventDefault(); nextMonth(); return
      case 'Enter':
      case ' ':
        e.preventDefault(); handleSelect(focusedDate); return
      case 'Escape':
        e.preventDefault(); onClose(); return
      default: return
    }

    if (!next) return
    const ns = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
    if (next.getFullYear() !== viewYear || next.getMonth() !== viewMonth) {
      setViewYear(next.getFullYear())
      setViewMonth(next.getMonth())
    }
    setFocusedDate(ns)
  }

  useEffect(() => {
    if (!focusedDate || !isOpen) return
    requestAnimationFrame(() => {
      const cell = gridRef.current?.querySelector<HTMLElement>(`[data-date="${focusedDate}"]`)
      cell?.focus()
    })
  }, [focusedDate, viewYear, viewMonth, isOpen])

  // ── Click outside ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return
    function onPointerDown(e: PointerEvent) {
      if (
        containerRef.current && !containerRef.current.contains(e.target as Node) &&
        triggerRef.current   && !triggerRef.current.contains(e.target as Node)
      ) onClose()
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

          <motion.div
            ref={containerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Group bill calendar"
            className={cn(
              'z-50 w-full select-none',
              'fixed bottom-0 left-0 right-0 rounded-t-[28px]',
              'sm:absolute sm:bottom-auto sm:left-auto sm:right-auto sm:rounded-2xl sm:w-[340px]',
            )}
            style={{
              background: 'rgba(255,255,255,0.96)',
              backdropFilter: 'blur(40px) saturate(1.9)',
              WebkitBackdropFilter: 'blur(40px) saturate(1.9)',
              border: '1px solid rgba(0,0,0,0.07)',
              boxShadow: '0 16px 60px rgba(0,0,0,0.12), 0 4px 20px rgba(0,0,0,0.07)',
            }}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,  scale: 1    }}
            exit={{   opacity: 0, y: 16,  scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.85 }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-0 sm:hidden">
              <div className="w-9 h-1 rounded-full" style={{ background: 'rgba(0,0,0,0.11)' }} />
            </div>

            <div className="p-4 pb-5 sm:p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={prevMonth}
                  aria-label="Previous month"
                  className="p-1.5 rounded-xl transition-colors hover:bg-black/[0.05] focus-ring"
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
                  <button
                    onClick={goToToday}
                    aria-label="Go to today"
                    className="px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors hover:bg-black/[0.05] focus-ring"
                    style={{ color: 'var(--accent)' }}
                  >
                    Today
                  </button>
                  <button
                    onClick={nextMonth}
                    aria-label="Next month"
                    className="p-1.5 rounded-xl transition-colors hover:bg-black/[0.05] focus-ring"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <ChevronRight size={16} />
                  </button>
                  <button
                    onClick={onClose}
                    aria-label="Close calendar"
                    className="hidden sm:flex p-1.5 rounded-xl transition-colors hover:bg-black/[0.05] focus-ring ml-1"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Day labels */}
              <div className="grid grid-cols-7 mb-1" role="row" aria-hidden="true">
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

              {/* Grid */}
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
                      <div key={`empty-${idx}`} role="gridcell" aria-hidden="true" className="h-10" />
                    )
                  }

                  const dayBills  = dayData[date]
                  const isToday   = date === today
                  const isSelected = date === selectedDate
                  const hasFocus  = date === focusedDate
                  const hasBills  = !!dayBills && dayBills.bills.length > 0

                  return (
                    <GroupDayCell
                      key={date}
                      date={date}
                      dayBills={dayBills ?? null}
                      isToday={isToday}
                      isSelected={isSelected}
                      isFocused={hasFocus}
                      hasBills={hasBills}
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

// ─── GroupDayCell ─────────────────────────────────────────────────────────────

interface GroupDayCellProps {
  date:       string
  dayBills:   DayBills | null
  isToday:    boolean
  isSelected: boolean
  isFocused:  boolean
  hasBills:   boolean
  onSelect:   (date: string) => void
  onFocus:    (date: string) => void
}

function GroupDayCell({
  date,
  dayBills,
  isToday,
  isSelected,
  isFocused,
  hasBills,
  onSelect,
  onFocus,
}: GroupDayCellProps) {
  const dayNum = parseInt(date.split('-')[2], 10)
  const [y, m, d] = date.split('-')
  const dateObj = new Date(Number(y), Number(m) - 1, Number(d))
  const count   = dayBills?.bills.length ?? 0
  const totalAmount = dayBills?.bills.reduce((s, b) => s + b.total, 0) ?? 0

  const ariaLabel = [
    dateObj.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    isToday ? ', today' : '',
    isSelected ? ', selected' : '',
    hasBills
      ? `, ${count} bill${count !== 1 ? 's' : ''}, total ${formatCurrency(totalAmount, dayBills?.bills[0]?.currency ?? 'INR')}`
      : ', no bills',
  ].join('')

  // For the label: show first bill name if 1 bill, or count if multiple
  const indicator = hasBills && dayBills
    ? dayBills.bills.length === 1
      ? dayBills.bills[0].name
      : `${dayBills.bills.length} bills`
    : null

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
        !isSelected && 'hover:bg-black/[0.04]',
      )}
      style={isSelected ? {
        background: 'rgba(37,99,235,0.10)',
        border: '1px solid rgba(37,99,235,0.22)',
        boxShadow: '0 1px 4px rgba(37,99,235,0.10)',
      } : {}}
    >
      {/* Date number */}
      <span
        className={cn(
          'text-[12px] font-semibold leading-none',
          'w-6 h-6 flex items-center justify-center rounded-full',
          isToday && !isSelected && 'ring-1 ring-blue-500/60',
          isToday && isSelected  && 'ring-1 ring-blue-600/50',
        )}
        style={{
          color: (isSelected || isToday) ? 'var(--accent)' : 'var(--text-primary)',
          fontWeight: (isToday || isSelected) ? 700 : 500,
        }}
      >
        {dayNum}
      </span>

      {/* Bill indicator */}
      {hasBills && indicator && (
        <div className="flex flex-col items-center gap-px mt-0.5">
          <span
            className="w-1 h-1 rounded-full"
            style={{ background: isSelected ? 'var(--accent)' : '#a855f7' }}
          />
          <span
            className="text-[7.5px] leading-none font-medium text-center"
            style={{
              color: isSelected ? 'var(--accent-text)' : 'var(--text-muted)',
              maxWidth: '38px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {indicator}
          </span>
        </div>
      )}
    </div>
  )
}
