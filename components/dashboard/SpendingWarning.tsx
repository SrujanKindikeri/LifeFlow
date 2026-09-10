'use client'

import { motion } from 'framer-motion'
import { TrendingUp, AlertTriangle, Info, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { GlassCard } from '@/components/ui/GlassCard'
import type { SpendingWarning as SpendingWarningType } from '@/lib/dashboard'

interface Props {
  warnings: SpendingWarningType[]
}

export function SpendingWarningSection({ warnings }: Props) {
  if (warnings.length === 0) return null

  return (
    <div className="space-y-2">
      {warnings.map((w, i) => {
        const isWarning = w.severity === 'warning'
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.07 }}
          >
            <GlassCard padding="sm" level="regular">
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  isWarning
                    ? 'bg-red-500/10 border border-red-500/20'
                    : 'bg-amber-500/10 border border-amber-500/20'
                }`}>
                  {isWarning
                    ? <AlertTriangle size={14} className="text-red-500" />
                    : <TrendingUp size={14} className="text-amber-500" />
                  }
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider"
                      style={{ color: isWarning ? 'var(--danger)' : 'var(--warning)' }}>
                      {isWarning ? 'Spending Warning' : 'Spending Notice'}
                    </span>
                  </div>
                  <p className="text-sm leading-snug" style={{ color: 'var(--text-primary)' }}>
                    {w.message}
                  </p>
                  {w.detail && (
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                      {w.detail}
                    </p>
                  )}
                  {w.linkToAnalytics && (
                    <Link
                      href="/app/analytics"
                      className="inline-flex items-center gap-1 text-[11px] mt-2 text-indigo-500 hover:text-indigo-600 transition-colors font-medium"
                    >
                      View Analytics <ArrowRight size={9} />
                    </Link>
                  )}
                </div>

                {/* Info icon */}
                <Info size={12} className="shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }} />
              </div>
            </GlassCard>
          </motion.div>
        )
      })}
    </div>
  )
}
