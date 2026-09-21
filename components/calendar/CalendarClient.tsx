'use client'

import React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, Calendar, CheckSquare, Flame, Wallet, Users, CreditCard, Target, FolderOpen, X } from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { useToast } from '@/components/ui/Toast'
import { formatPaise } from '@/lib/moneyCalculator'

interface CalEvent {
  date: string; type: string; id: string; title: string; status?: string
  metadata?: Record<string, unknown>
}

const TYPE_ICONS: Record<string, React.ReactNode> = {  task:         <CheckSquare size={12} />,
  habit:        <Flame size={12} />,
  money:        <Wallet size={12} />,
  group_bill:   <Users size={12} />,
  subscription: <CreditCard size={12} />,
  goal:         <Target size={12} />,
  project:      <FolderOpen size={12} />,
}

const TYPE_COLORS: Record<string, string> = {
  task: '#3b82f6', habit: '#f97316', money: '#10b981',
  group_bill: '#0ea5e9', subscription: '#8b5cf6', goal: '#6366f1', project: '#ec4899',
}

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export function CalendarClient() {
  const { error: showError } = useToast()
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth()) // 0-indexed
  const [byDate, setByDate] = useState<Record<string, CalEvent[]>>({})
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const todayStr = today.toISOString().split('T')[0]

  const load = useCallback(async (year: number, month: number) => {
    setLoading(true)
    const from = `${year}-${String(month+1).padStart(2,'0')}-01`
    const lastDay = new Date(year, month+1, 0).getDate()
    const to = `${year}-${String(month+1).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`
    try {
      const res = await fetch(`/api/calendar?from=${from}&to=${to}`)
      const data = await res.json()
      setByDate(data.byDate ?? {})
    } catch { showError('Failed to load calendar') }
    finally { setLoading(false) }
  }, [showError, setLoading, setByDate])

  useEffect(() => { void load(viewYear, viewMonth) }, [viewYear, viewMonth, load])

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y-1); setViewMonth(11) }
    else setViewMonth((m) => m-1)
    setSelectedDate(null)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y+1); setViewMonth(0) }
    else setViewMonth((m) => m+1)
    setSelectedDate(null)
  }

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1).getDay() // 0=Sun
  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate()
  // Offset so Monday=0
  const startOffset = firstDay === 0 ? 6 : firstDay - 1
  const cells: (number | null)[] = [...Array(startOffset).fill(null), ...Array.from({length: daysInMonth}, (_, i) => i+1)]
  while (cells.length % 7 !== 0) cells.push(null)

  function dateStr(day: number) {
    return `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
  }

  const selectedEvents = selectedDate ? (byDate[selectedDate] ?? []) : []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Calendar</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Unified life timeline</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-2 rounded-xl glass hover:bg-black/[0.04] transition-colors" style={{ color: 'var(--text-muted)' }}><ChevronLeft size={16}/></button>
          <span className="text-sm font-semibold min-w-[110px] text-center" style={{ color: 'var(--text-primary)' }}>
            {MONTHS[viewMonth]} {viewYear}
          </span>
          <button onClick={nextMonth} className="p-2 rounded-xl glass hover:bg-black/[0.04] transition-colors" style={{ color: 'var(--text-muted)' }}><ChevronRight size={16}/></button>
        </div>
      </div>

      {/* Desktop: full calendar grid */}
      <GlassCard padding="none" className="hidden sm:block overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b" style={{ borderColor: 'var(--border)' }}>
          {DAYS.map((d) => (
            <div key={d} className="py-2.5 text-center text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{d}</div>
          ))}
        </div>
        {/* Cells */}
        <div className={`grid grid-cols-7 ${loading ? 'opacity-50' : ''}`}>
          {cells.map((day, i) => {
            const ds = day ? dateStr(day) : ''
            const events = ds ? (byDate[ds] ?? []) : []
            const isToday = ds === todayStr
            const isSelected = ds === selectedDate
            return (
              <div
                key={i}
                onClick={() => day && setSelectedDate(isSelected ? null : ds)}
                className={`min-h-[72px] p-1.5 border-b border-r cursor-pointer transition-colors ${day ? 'hover:bg-black/[0.02]' : ''}`}
                style={{ borderColor: 'var(--border)', background: isSelected ? 'rgba(59,130,246,0.06)' : undefined }}
              >
                {day && (
                  <>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold mb-1 ${isToday ? 'text-white' : ''}`}
                      style={{ background: isToday ? 'var(--accent)' : 'transparent', color: isToday ? '#fff' : 'var(--text-secondary)' }}>
                      {day}
                    </div>
                    <div className="flex flex-wrap gap-0.5">
                      {events.slice(0,3).map((e) => (
                        <div key={e.id} className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TYPE_COLORS[e.type] ?? '#6b7280' }} title={e.title} />
                      ))}
                      {events.length > 3 && <span className="text-[9px]" style={{ color: 'var(--text-faint)' }}>+{events.length-3}</span>}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </GlassCard>

      {/* Mobile: compact month picker + list */}
      <div className="sm:hidden">
        <div className="grid grid-cols-7 gap-1 mb-4">
          {DAYS.map((d) => <div key={d} className="text-center text-[10px] font-bold" style={{ color: 'var(--text-faint)' }}>{d[0]}</div>)}
          {cells.map((day, i) => {
            const ds = day ? dateStr(day) : ''
            const events = ds ? (byDate[ds] ?? []) : []
            const isToday = ds === todayStr
            const isSelected = ds === selectedDate
            return (
              <button
                key={i}
                onClick={() => day && setSelectedDate(isSelected ? null : ds)}
                className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs font-semibold relative transition-all ${!day ? 'invisible' : ''}`}
                style={{
                  background: isToday ? 'var(--accent)' : isSelected ? 'rgba(59,130,246,0.1)' : 'transparent',
                  color: isToday ? '#fff' : 'var(--text-secondary)',
                }}>
                {day}
                {events.length > 0 && <div className="w-1 h-1 rounded-full absolute bottom-0.5" style={{ background: isToday ? 'rgba(255,255,255,0.7)' : 'var(--accent)' }} />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected date panel */}
      <AnimatePresence>
        {selectedDate && (
          <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-4 }}>
            <GlassCard padding="md">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Calendar size={16} style={{ color: 'var(--accent)' }} />
                  <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                    {new Date(selectedDate+'T00:00:00').toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long' })}
                  </h2>
                </div>
                <button onClick={() => setSelectedDate(null)} className="p-1 rounded-lg hover:bg-black/[0.05]" style={{ color: 'var(--text-muted)' }}><X size={14}/></button>
              </div>

              {selectedEvents.length === 0 ? (
                <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>Nothing on this day.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {selectedEvents.map((e) => (
                    <div key={e.id} className="flex items-center gap-3 px-3 py-2 rounded-xl" style={{ background: `${TYPE_COLORS[e.type] ?? '#6b7280'}10` }}>
                      <span style={{ color: TYPE_COLORS[e.type] ?? '#6b7280' }}>
                        {(TYPE_ICONS as Record<string, React.ReactNode>)[e.type] ?? <span />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{e.title}</p>
                        {e.metadata?.amountMinor != null && (
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatPaise(Number(e.metadata.amountMinor))}</p>
                        )}
                      </div>
                      {e.status && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: 'rgba(0,0,0,0.06)', color: 'var(--text-muted)' }}>
                          {e.status}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {Object.entries(TYPE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
            <span className="text-xs capitalize" style={{ color: 'var(--text-faint)' }}>{type.replace('_',' ')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

