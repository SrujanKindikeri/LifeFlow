'use client'

/**
 * DraftsContinueSection
 *
 * Dashboard widget: "Continue Where You Left Off"
 * Shows the user's most recently-updated drafts (up to 3).
 * Fetches its own data client-side so it never blocks the server dashboard render.
 * Reuses the compact DraftCard variant.
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { GlassCard } from '@/components/ui/GlassCard'
import { DraftCard } from '@/components/drafts/DraftCard'
import type { Draft } from '@/types/drafts'

export function DraftsContinueSection() {
  const [drafts,  setDrafts]  = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/drafts?sort=updatedAt&limit=3')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setDrafts(d.drafts) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Don't render anything while loading or if there are no drafts
  if (loading || drafts.length === 0) return null

  function handleDeleted(id: string) {
    setDrafts((prev) => prev.filter((d) => d._id !== id))
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <GlassCard padding="md" level="regular">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-xl flex items-center justify-center"
              style={{
                background: 'rgba(37,99,235,0.10)',
                border: '1px solid rgba(37,99,235,0.18)',
              }}
            >
              <BookOpen size={13} style={{ color: 'var(--accent)' }} />
            </div>
            <h2 className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              Continue Where You Left Off
            </h2>
          </div>

          <Link
            href="/app/drafts"
            className="flex items-center gap-1 text-[11px] hover:text-indigo-500 transition-colors"
            style={{ color: 'var(--text-faint)' }}
          >
            View all <ArrowRight size={10} />
          </Link>
        </div>

        {/* Compact draft list */}
        <div className="space-y-0.5">
          {drafts.map((draft) => (
            <DraftCard
              key={draft._id}
              draft={draft}
              onDeleted={handleDeleted}
              compact
            />
          ))}
        </div>
      </GlassCard>
    </motion.div>
  )
}
