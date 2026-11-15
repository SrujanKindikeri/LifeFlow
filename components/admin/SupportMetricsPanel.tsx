'use client'

/**
 * SupportMetricsPanel.tsx — Collapsible metrics header for the Support Center.
 *
 * Fetches GET /api/admin/support/metrics and renders:
 *  - Status counts (open, waiting for admin, overdue, unassigned)
 *  - Response-time stats (avg first response, median, avg resolution)
 *  - 30-day volume trend (BarChart)
 *  - Top categories and priority breakdown
 *
 * The panel is collapsible so it doesn't crowd the ticket list below.
 * Falls back gracefully when no data exists yet.
 */

import React, { useCallback, useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { ChevronDown, ChevronUp, RefreshCw, Clock, HeadphonesIcon, AlertTriangle, Users } from 'lucide-react'
import { AdminCard, ErrorState, LoadingSpinner, StatCard } from '@/components/admin/AdminCard'
import { formatRelativeTime } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SupportMetrics {
  generatedAt: string
  counts: {
    open: number; waitingForAdmin: number; waitingForUser: number
    resolved: number; closed: number; total: number
    unassigned: number; overdue: number
  }
  responseTimes: {
    avgFirstResponseHours:    number | null
    medianFirstResponseHours: number | null
    avgResolutionHours:       number | null
    sampleSizeResponse:       number
    sampleSizeResolution:     number
    note:                     string
  }
  volume: { trend: { date: string; created: number; resolved: number }[] }
  topCategories:    { category: string; count: number }[]
  priorityBreakdown:{ priority: string; count: number }[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtHours(h: number): string {
  if (h < 1)  return `${Math.round(h * 60)}m`
  if (h < 24) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}d`
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', timeZone: 'UTC',
    })
  } catch { return iso }
}

function fmtDateLabel(label: React.ReactNode): string {
  return fmtDate(typeof label === 'string' ? label : String(label ?? ''))
}

const CATEGORY_LABELS: Record<string, string> = {
  account_and_login:            'Account & Login',
  notifications:                'Notifications',
  offline_sync:                 'Offline Sync',
  notes_tasks_habits_projects:  'Notes/Tasks/Habits',
  expenses_and_subscriptions:   'Expenses & Subs',
  payments_and_group_bills:     'Payments & Bills',
  bugs_and_technical:           'Bugs & Technical',
  other:                        'Other',
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#dc2626',
  high:   '#d97706',
  normal: 'var(--accent)',
  low:    'var(--text-muted)',
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SupportMetricsPanel() {
  const [data, setData]           = useState<SupportMetrics | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [expanded, setExpanded]   = useState(true)

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/admin/support/metrics')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? 'Failed to load metrics')
      setData(json as SupportMetrics)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load metrics')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <div className="mb-4">
      {/* ── Collapse toggle header ─────────────────────────────────── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl mb-2 text-left"
        style={{ background: 'var(--glass-subtle-bg)', border: '1px solid var(--border)' }}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <HeadphonesIcon size={14} style={{ color: 'var(--accent)' }} />
          <span className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            Support Metrics
          </span>
          {data && !loading && (
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              · {data.counts.open} open · updated {formatRelativeTime(data.generatedAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); void load(true) }}
            disabled={refreshing}
            className="p-1 rounded-lg"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Refresh metrics"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          </button>
          {expanded ? <ChevronUp size={14} style={{ color: 'var(--text-muted)' }} />
                    : <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} />}
        </div>
      </button>

      {/* ── Collapsible content ───────────────────────────────────── */}
      {expanded && (
        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-6"><LoadingSpinner /></div>
          ) : error ? (
            <ErrorState message={error} />
          ) : data ? (
            <>
              {/* Status counts */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard
                  label="Open"
                  value={data.counts.open}
                  color={data.counts.open > 0 ? 'warning' : 'success'}
                  icon={<HeadphonesIcon size={16} />}
                />
                <StatCard
                  label="Waiting: Admin"
                  value={data.counts.waitingForAdmin}
                  color={data.counts.waitingForAdmin > 0 ? 'danger' : 'success'}
                  icon={<Users size={16} />}
                />
                <StatCard
                  label="Overdue (>48h)"
                  value={data.counts.overdue}
                  color={data.counts.overdue > 0 ? 'danger' : 'success'}
                  icon={<AlertTriangle size={16} />}
                />
                <StatCard
                  label="Unassigned"
                  value={data.counts.unassigned}
                  color={data.counts.unassigned > 0 ? 'warning' : 'success'}
                  icon={<Clock size={16} />}
                />
              </div>

              {/* Response times */}
              <div className="grid grid-cols-3 gap-3">
                <StatCard
                  label="Avg First Response"
                  value={data.responseTimes.avgFirstResponseHours !== null
                    ? fmtHours(data.responseTimes.avgFirstResponseHours)
                    : '—'}
                  sub={data.responseTimes.sampleSizeResponse > 0
                    ? `${data.responseTimes.sampleSizeResponse} tickets (30d)`
                    : 'No data yet'}
                  icon={<Clock size={16} />}
                  color={
                    data.responseTimes.avgFirstResponseHours === null ? 'default' :
                    data.responseTimes.avgFirstResponseHours < 4  ? 'success' :
                    data.responseTimes.avgFirstResponseHours < 24 ? 'warning' : 'danger'
                  }
                />
                <StatCard
                  label="Median First Response"
                  value={data.responseTimes.medianFirstResponseHours !== null
                    ? fmtHours(data.responseTimes.medianFirstResponseHours)
                    : '—'}
                  icon={<Clock size={16} />}
                  color="info"
                />
                <StatCard
                  label="Avg Resolution"
                  value={data.responseTimes.avgResolutionHours !== null
                    ? fmtHours(data.responseTimes.avgResolutionHours)
                    : '—'}
                  sub={data.responseTimes.sampleSizeResolution > 0
                    ? `${data.responseTimes.sampleSizeResolution} resolved (30d)`
                    : 'No resolved tickets yet'}
                  icon={<Clock size={16} />}
                  color={
                    data.responseTimes.avgResolutionHours === null ? 'default' :
                    data.responseTimes.avgResolutionHours < 24 ? 'success' :
                    data.responseTimes.avgResolutionHours < 72 ? 'warning' : 'danger'
                  }
                />
              </div>

              {/* Volume trend chart */}
              {data.volume.trend.some((p) => p.created > 0 || p.resolved > 0) && (
                <AdminCard>
                  <p className="text-[12px] font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
                    Ticket Volume (30 days)
                  </p>
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={data.volume.trend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={fmtDate}
                        tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                        tickLine={false} axisLine={false}
                        interval={6}
                      />
                      <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        labelFormatter={fmtDateLabel}
                        contentStyle={{ background: 'var(--glass-floating-bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 11 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 10, paddingTop: 6 }} iconType="circle" />
                      <Bar dataKey="created"  name="Created"  fill="var(--accent)"   radius={[2,2,0,0]} />
                      <Bar dataKey="resolved" name="Resolved" fill="#10b981" radius={[2,2,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </AdminCard>
              )}

              {/* Categories + priorities side by side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.topCategories.length > 0 && (
                  <AdminCard padding="sm">
                    <p className="text-[12px] font-semibold px-3 pt-1 mb-2" style={{ color: 'var(--text-primary)' }}>
                      Open by Category
                    </p>
                    <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                      {data.topCategories.map((c) => (
                        <div key={c.category} className="flex items-center justify-between py-1.5 px-3 text-[12px]">
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {CATEGORY_LABELS[c.category] ?? c.category}
                          </span>
                          <span className="font-bold" style={{ color: 'var(--accent)' }}>{c.count}</span>
                        </div>
                      ))}
                    </div>
                  </AdminCard>
                )}
                {data.priorityBreakdown.length > 0 && (
                  <AdminCard padding="sm">
                    <p className="text-[12px] font-semibold px-3 pt-1 mb-2" style={{ color: 'var(--text-primary)' }}>
                      Open by Priority
                    </p>
                    <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                      {data.priorityBreakdown.map((p) => (
                        <div key={p.priority} className="flex items-center justify-between py-1.5 px-3 text-[12px]">
                          <span className="font-semibold capitalize"
                            style={{ color: PRIORITY_COLOR[p.priority] ?? 'var(--text-secondary)' }}>
                            {p.priority}
                          </span>
                          <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{p.count}</span>
                        </div>
                      ))}
                    </div>
                  </AdminCard>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
