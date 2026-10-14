'use client'

/**
 * components/sync/SyncStatusBar.tsx
 *
 * This file previously contained the floating SyncStatusBar pill.
 * That component has been removed — sync status is now surfaced inside
 * the Profile page as a "Data Sync" section.
 *
 * This file is kept because it exports SyncBadge, which is used by
 * list rows and card headers to show per-record sync status.
 */

import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Per-record sync badge ────────────────────────────────────────────────────

/**
 * SyncBadge — tiny inline status indicator for a single record.
 * Use inside list rows or card headers.
 *
 * @example <SyncBadge status={note.syncStatus} />
 */
import type { SyncStatus } from '@/types/sync'

const BADGE_CONFIG: Record<SyncStatus, { label: string; color: string }> = {
  saved_locally: { label: 'Saved',    color: 'var(--text-tertiary)' },
  pending_sync:  { label: 'Pending',  color: 'var(--accent)'        },
  syncing:       { label: 'Syncing',  color: 'var(--accent)'        },
  synced:        { label: 'Synced',   color: 'var(--success)'       },
  conflict:      { label: 'Conflict', color: 'var(--warning)'       },
  sync_failed:   { label: 'Failed',   color: 'var(--danger)'        },
}

export function SyncBadge({
  status,
  className,
}: {
  status:     SyncStatus
  className?: string
}) {
  const { label, color } = BADGE_CONFIG[status] ?? BADGE_CONFIG.synced

  // 'synced' is the default, quiet state — no badge needed.
  if (status === 'synced') return null

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full',
        className,
      )}
      style={{ color, background: `${color}18`, border: `1px solid ${color}33` }}
      aria-label={`Sync status: ${label}`}
    >
      {status === 'syncing' && (
        <RefreshCw size={8} className="animate-spin" aria-hidden />
      )}
      {label}
    </span>
  )
}
