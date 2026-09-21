'use client'

import { formatPaise } from '@/lib/moneyCalculator'

interface BudgetSummaryBarProps {
  totalBudgetMinor: number
  totalSpentMinor: number
  loading: boolean
}

export function BudgetSummaryBar({
  totalBudgetMinor,
  totalSpentMinor,
  loading,
}: BudgetSummaryBarProps) {
  const totalRemainingMinor = totalBudgetMinor - totalSpentMinor
  const remainingIsNegative = totalRemainingMinor < 0

  const usagePct =
    totalBudgetMinor > 0
      ? Math.round((totalSpentMinor / totalBudgetMinor) * 1000) / 10
      : 0

  if (loading) {
    return (
      <div
        className="glass rounded-2xl animate-pulse"
        style={{ height: '76px', background: 'rgba(0,0,0,0.04)' }}
      />
    )
  }

  return (
    <div className="glass-elevated rounded-2xl px-5 py-4">
      {/* 3 equal columns — stacks to 1 col only on the very smallest phones (< 360px) */}
      <div className="grid grid-cols-3 min-[360px]:grid-cols-3 gap-0">

        {/* ── Total Budget ── */}
        <SummaryCell
          label="Total Budget"
          value={formatPaise(totalBudgetMinor)}
          valueColor="var(--text-primary)"
          divider={false}
        />

        {/* ── Total Spent ── */}
        <SummaryCell
          label="Total Spent"
          value={formatPaise(totalSpentMinor)}
          valueColor={
            totalSpentMinor > totalBudgetMinor && totalBudgetMinor > 0
              ? 'var(--danger-text)'
              : 'var(--warning-text)'
          }
          divider
        />

        {/* ── Remaining ── */}
        <SummaryCell
          label="Remaining"
          value={
            remainingIsNegative
              ? `−${formatPaise(-totalRemainingMinor)}`
              : formatPaise(totalRemainingMinor)
          }
          valueColor={remainingIsNegative ? 'var(--danger-text)' : 'var(--success-text)'}
          divider
        />
      </div>

      {/* Thin progress bar */}
      {totalBudgetMinor > 0 && (
        <div
          className="rounded-full overflow-hidden mt-3"
          style={{ height: '3px', background: 'var(--border)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(100, usagePct)}%`,
              background:
                usagePct >= 100
                  ? 'var(--danger)'
                  : usagePct >= 80
                    ? 'var(--warning)'
                    : 'var(--accent)',
            }}
          />
        </div>
      )}
    </div>
  )
}

// ── Internal cell ─────────────────────────────────────────────────────────────

function SummaryCell({
  label,
  value,
  valueColor,
  divider,
}: {
  label: string
  value: string
  valueColor: string
  divider: boolean
}) {
  return (
    <div
      className="flex flex-col gap-0.5 min-w-0"
      style={{
        paddingLeft: divider ? '16px' : '0',
        borderLeft: divider ? '1px solid var(--border)' : 'none',
      }}
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-wide leading-none truncate"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </span>
      <span
        className="text-lg sm:text-xl font-bold leading-snug tracking-tight truncate"
        style={{ color: valueColor }}
      >
        {value}
      </span>
    </div>
  )
}
