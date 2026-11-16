'use client'

/**
 * DailyIntelligenceCard — compact home dashboard card.
 *
 * Fetches the morning briefing via GET /api/daily-intelligence and shows:
 * - Greeting + date
 * - Top 3 priorities
 * - Overdue count badge
 * - Habits at risk count
 * - Schedule conflict warning
 * - Financial alert count
 * - "View full briefing" link
 * - Last generated time
 * - Manual refresh button (rate-limited)
 * - Loading / empty / error / stale states
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  Brain, RefreshCw, AlertTriangle, CheckSquare,
  Flame, TrendingUp, ArrowRight, Clock, WifiOff,
} from 'lucide-react'
import { GlassCard } from '@/components/ui/GlassCard'
import { cn } from '@/lib/utils'
import type { IDailyBriefing } from '@/models/DailyBriefing'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiResponse {
  briefing: IDailyBriefing
  cached: boolean
}

type LoadState = 'idle' | 'loading' | 'success' | 'error' | 'offline'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatGeneratedAt(dateStr: string | Date): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMin = Math.round((now.getTime() - d.getTime()) / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function isStale(generatedAt: Date | string): boolean {
  const ms = new Date(generatedAt).getTime()
  return Date.now() - ms > 4 * 60 * 60 * 1000 // >4 hours
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DailyIntelligenceCard() {
  const [state, setState]       = useState<LoadState>('loading')
  const [data, setData]         = useState<IDailyBriefing | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [retryAfter, setRetryAfter] = useState(0)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true)
    else setState('loading')

    try {
      const url = force ? '/api/daily-intelligence' : '/api/daily-intelligence?type=morning'
      const opts: RequestInit = force
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'morning' }) }
        : { method: 'GET' }

      const r = await fetch(force ? '/api/daily-intelligence' : url, opts)

      if (r.status === 429) {
        const body = await r.json().catch(() => ({})) as { retryAfterSeconds?: number }
        setRetryAfter(body.retryAfterSeconds ?? 300)
        // Start countdown
        if (countdownRef.current) clearInterval(countdownRef.current)
        countdownRef.current = setInterval(() => {
          setRetryAfter((prev) => {
            if (prev <= 1) {
              clearInterval(countdownRef.current!)
              return 0
            }
            return prev - 1
          })
        }, 1000)
        return
      }

      if (!r.ok) {
        setState('error')
        return
      }

      const json = await r.json() as ApiResponse
      setData(json.briefing)
      setState('success')
    } catch {
      setState(navigator.onLine ? 'error' : 'offline')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
    return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
  }, [load])

  // ── Loading ──────────────────────────────────────────────────────────────
  if (state === 'loading') {
    return (
      <GlassCard padding="md" className="animate-pulse">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-xl bg-black/[0.06]" />
          <div className="h-3 w-32 rounded-full bg-black/[0.06]" />
        </div>
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-3 rounded-full bg-black/[0.05]" style={{ width: `${80 - i * 12}%` }} />
          ))}
        </div>
      </GlassCard>
    )
  }

  // ── Offline ───────────────────────────────────────────────────────────────
  if (state === 'offline') {
    return (
      <GlassCard padding="sm">
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <WifiOff size={14} />
          <span>Daily Intelligence unavailable offline</span>
        </div>
      </GlassCard>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (state === 'error') {
    return (
      <GlassCard padding="sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            <AlertTriangle size={14} style={{ color: 'var(--danger)' }} />
            <span>Could not load briefing</span>
          </div>
          <button
            onClick={() => load(false)}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Retry
          </button>
        </div>
      </GlassCard>
    )
  }

  // ── Empty / opted-out ─────────────────────────────────────────────────────
  if (!data || !data.hasContent) {
    return (
      <GlassCard padding="md">
        <div className="flex items-center gap-2 mb-3">
          <Brain size={14} style={{ color: '#6366f1' }} />
          <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Daily Intelligence
          </h2>
        </div>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {data ? 'Nothing urgent today — you\'re on track! ✨' : 'Enable Daily Intelligence in your profile to get personalised briefings.'}
        </p>
        <Link
          href="/app/daily-intelligence"
          className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
        >
          View full briefing <ArrowRight size={10} />
        </Link>
      </GlassCard>
    )
  }

  const content = data.content
  const overdueCount  = content.overdueTasks.length
  const atRiskHabits  = content.habitsAtRisk.filter((h) => !h.completedToday).length
  const conflictCount = content.conflicts.length
  const finAlerts     = content.financialAlerts.length
  const stale         = isStale(data.generatedAt)

  return (
    <GlassCard padding="md">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <Brain size={14} style={{ color: '#6366f1', flexShrink: 0 }} />
          <h2
            className="font-semibold truncate"
            style={{ color: 'var(--text-primary)', fontSize: 'clamp(12px,3.5vw,13px)' }}
          >
            Daily Intelligence
          </h2>
          {stale && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: 'rgba(245,158,11,0.12)', color: '#d97706' }}>
              stale
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {retryAfter > 0 ? (
            <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{retryAfter}s</span>
          ) : (
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              aria-label="Refresh briefing"
              className="p-1 rounded-lg hover:bg-black/[0.04] transition-colors disabled:opacity-40"
            >
              <RefreshCw size={12} className={cn(refreshing && 'animate-spin')} style={{ color: 'var(--text-faint)' }} />
            </button>
          )}
        </div>
      </div>

      {/* Top priorities */}
      {content.topPriorities.length > 0 && (
        <div className="space-y-1.5 mb-4">
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>
            Today&apos;s priorities
          </p>
          {content.topPriorities.slice(0, 3).map((t, i) => (
            <motion.div
              key={t._id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-start gap-2"
            >
              <span
                className="mt-0.5 text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                style={{ background: '#6366f1', color: '#fff' }}
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[12px] truncate" style={{ color: 'var(--text-primary)' }}>{t.title}</p>
                {t.dueTime && (
                  <p className="text-[10px] flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
                    <Clock size={9} />{t.dueTime}
                  </p>
                )}
              </div>
              {t.priority === 'high' && (
                <span className="text-[9px] px-1 py-0.5 rounded-full shrink-0"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                  high
                </span>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Status pills */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {overdueCount > 0 && (
          <Link href="/app/tasks">
            <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full cursor-pointer hover:opacity-80 transition-opacity"
                  style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
              <AlertTriangle size={9} />
              {overdueCount} overdue
            </span>
          </Link>
        )}
        {atRiskHabits > 0 && (
          <Link href="/app/habits">
            <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full cursor-pointer hover:opacity-80 transition-opacity"
                  style={{ background: 'rgba(249,115,22,0.1)', color: '#f97316' }}>
              <Flame size={9} />
              {atRiskHabits} habit{atRiskHabits > 1 ? 's' : ''}
            </span>
          </Link>
        )}
        {conflictCount > 0 && (
          <Link href="/app/daily-intelligence">
            <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full cursor-pointer hover:opacity-80 transition-opacity"
                  style={{ background: 'rgba(245,158,11,0.1)', color: '#d97706' }}>
              <CheckSquare size={9} />
              {conflictCount} conflict{conflictCount > 1 ? 's' : ''}
            </span>
          </Link>
        )}
        {finAlerts > 0 && (
          <Link href="/app/daily-intelligence">
            <span className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-full cursor-pointer hover:opacity-80 transition-opacity"
                  style={{ background: 'rgba(16,185,129,0.1)', color: '#059669' }}>
              <TrendingUp size={9} />
              {finAlerts} financial
            </span>
          </Link>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: 'rgba(0,0,0,0.06)' }}>
        <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
          Updated {formatGeneratedAt(data.generatedAt)}
        </p>
        <Link
          href="/app/daily-intelligence"
          className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors"
        >
          Full briefing <ArrowRight size={9} />
        </Link>
      </div>
    </GlassCard>
  )
}
