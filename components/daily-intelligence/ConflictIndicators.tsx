'use client'

import Link from 'next/link'
import { AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScheduleConflict, ConflictSeverity } from '@/lib/dailyIntelligence/conflictDetector'

interface Props {
  conflicts: ScheduleConflict[]
}

const SEVERITY_STYLES: Record<ConflictSeverity, { bg: string; border: string; icon: string }> = {
  confirmed: { bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.2)',   icon: '#ef4444' },
  likely:    { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.2)',  icon: '#d97706' },
  possible:  { bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.2)', icon: '#64748b' },
}

const SEVERITY_LABEL: Record<ConflictSeverity, string> = {
  confirmed: 'Confirmed',
  likely:    'Likely',
  possible:  'Possible',
}

export function ConflictIndicators({ conflicts }: Props) {
  if (conflicts.length === 0) return null

  return (
    <div className="space-y-2">
      {conflicts.map((c, i) => {
        const s = SEVERITY_STYLES[c.severity]
        const Icon = c.severity === 'confirmed' || c.severity === 'likely'
          ? AlertTriangle
          : Info
        return (
          <div
            key={i}
            className="rounded-xl p-3 min-w-0"
            style={{ background: s.bg, border: `1px solid ${s.border}` }}
          >
            <div className="flex items-start gap-2 min-w-0">
              <Icon size={13} className="shrink-0 mt-0.5" style={{ color: s.icon }} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <p className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {c.title}
                  </p>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{ background: s.border, color: s.icon }}
                  >
                    {SEVERITY_LABEL[c.severity]}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {c.description}
                </p>
                {c.links.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {c.links.slice(0, 3).map((l) => (
                      <Link
                        key={l.href}
                        href={l.href}
                        className={cn(
                          'text-[10px] underline underline-offset-2 truncate max-w-[140px]',
                          'hover:opacity-70 transition-opacity'
                        )}
                        style={{ color: s.icon }}
                      >
                        {l.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
