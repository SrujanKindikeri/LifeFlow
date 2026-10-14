'use client'

/**
 * components/sync/ConflictResolutionModal.tsx
 *
 * Side-by-side conflict review UI for the LifeFlow offline sync layer.
 *
 * SHOWN WHEN
 * ──────────
 * The sync engine detects that the same record was modified both locally
 * and on the server since the last sync. Automatic resolution is attempted
 * first; this modal appears only when manual review is required.
 *
 * DESIGN
 * ──────
 * • Two columns: "Your version" vs "Server version"
 * • Clear diff of changed fields (highlighted)
 * • Two actions: "Keep mine" or "Use server version"
 * • Non-blocking: the rest of the app is still usable
 * • Entity-specific field labels (notes show content, tasks show title/status)
 *
 * USES the existing LifeFlow Liquid Glass design system (GlassCard, Modal).
 */

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, X, Check, Server, Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getOfflineDB } from '@/lib/db/offline'
import { applyConflictResolution } from '@/lib/sync/conflict'
import { triggerSync } from '@/lib/sync/engine'
import type { ConflictRecord, SyncEntityType } from '@/types/sync'

// ─── Entity field labels ──────────────────────────────────────────────────────

const ENTITY_LABELS: Record<SyncEntityType, string> = {
  note:         'Note',
  task:         'Task',
  habit:        'Habit',
  habitLog:     'Habit Log',
  expense:      'Expense',
  subscription: 'Subscription',
  project:      'Project',
}

const IMPORTANT_FIELDS: Record<SyncEntityType, string[]> = {
  note:         ['title', 'content', 'tags', 'pinned', 'archived'],
  task:         ['title', 'description', 'completed', 'priority', 'dueDate'],
  habit:        ['name', 'description', 'frequency', 'target'],
  habitLog:     ['completed', 'date'],
  expense:      ['amount', 'category', 'description', 'date'],
  subscription: ['serviceName', 'amountMinor', 'status', 'nextBillingDate'],
  project:      ['title', 'description', 'status', 'dueDate', 'color'],
}

// ─── Field value formatter ────────────────────────────────────────────────────

function formatValue(field: string, value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (field === 'amountMinor' && typeof value === 'number') {
    return `₹${(value / 100).toFixed(2)}`
  }
  if (field === 'amount' && typeof value === 'number') {
    return `₹${value.toFixed(2)}`
  }
  if (field === 'tags' && Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : '(no tags)'
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string' && value.length > 120) {
    return value.slice(0, 120) + '…'
  }
  return String(value)
}

// ─── ConflictResolutionModal component ───────────────────────────────────────

export function ConflictResolutionModal({
  clientUserId,
}: {
  clientUserId: string
}) {
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([])
  const [current, setCurrent]     = useState<ConflictRecord | null>(null)
  const [resolving, setResolving] = useState(false)

  // Load pending conflicts
  const loadConflicts = useCallback(async () => {
    if (typeof window === 'undefined') return
    try {
      const db   = getOfflineDB()
      const rows = await db.conflicts
        .where('[clientUserId+resolution]')
        .equals([clientUserId, 'pending'])
        .toArray()
      setConflicts(rows)
      setCurrent(rows[0] ?? null)
    } catch {
      // IndexedDB not available
    }
  }, [clientUserId])

  useEffect(() => {
    void loadConflicts()
    // Re-check every 10 seconds (the engine may detect new conflicts)
    const interval = setInterval(loadConflicts, 10_000)
    return () => clearInterval(interval)
  }, [loadConflicts])

  const handleResolve = useCallback(
    async (choice: 'keep_local' | 'keep_server') => {
      if (!current?.id) return
      setResolving(true)
      try {
        await applyConflictResolution(current.id, choice)
        await loadConflicts()
        // Trigger a sync to upload the kept-local version if needed
        void triggerSync()
      } finally {
        setResolving(false)
      }
    },
    [current, loadConflicts],
  )

  const handleDismiss = useCallback(() => {
    setCurrent(null)
  }, [])

  if (!current) return null

  const entityType   = current.entityType
  const entityLabel  = ENTITY_LABELS[entityType]
  const fields       = IMPORTANT_FIELDS[entityType]
  const local        = current.localData
  const server       = current.serverData

  // Find which fields differ between local and server
  const changedFields = fields.filter(
    (f) => JSON.stringify(local[f]) !== JSON.stringify(server[f]),
  )

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        key="conflict-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
        onClick={handleDismiss}
        aria-modal="true"
        role="dialog"
        aria-label={`Resolve conflict for ${entityLabel}`}
      >
        <motion.div
          key="conflict-modal"
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0,  scale: 1 }}
          exit={{ opacity: 0,   y: 40,  scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="relative w-full max-w-lg rounded-3xl p-0 overflow-hidden"
          style={{
            background:    'var(--glass-floating-bg)',
            border:        '1px solid var(--glass-floating-border)',
            boxShadow:     'var(--glass-shadow-md)',
            backdropFilter:'blur(36px) saturate(1.8)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-5 py-4 border-b"
            style={{ borderColor: 'var(--glass-regular-border)' }}
          >
            <span
              className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(217,119,6,0.12)' }}
              aria-hidden
            >
              <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />
            </span>
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-semibold truncate"
                style={{ color: 'var(--text-primary)' }}
              >
                Sync conflict — {entityLabel}
              </p>
              <p
                className="text-xs"
                style={{ color: 'var(--text-secondary)' }}
              >
                {conflicts.length > 1
                  ? `${conflicts.length} conflicts to resolve`
                  : 'This record was changed in two places'}
              </p>
            </div>
            <button
              onClick={handleDismiss}
              className="p-1.5 rounded-xl opacity-50 hover:opacity-80 transition-opacity"
              style={{ color: 'var(--text-secondary)' }}
              aria-label="Dismiss (resolve later)"
            >
              <X size={15} />
            </button>
          </div>

          {/* Diff table */}
          <div className="px-5 pt-4 pb-2 overflow-y-auto max-h-64">
            {changedFields.length === 0 ? (
              <p className="text-xs text-center py-4" style={{ color: 'var(--text-tertiary)' }}>
                No field differences found.
              </p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="text-left pb-2 font-medium w-24" style={{ color: 'var(--text-secondary)' }}>Field</th>
                    <th className="text-left pb-2 font-medium px-2" style={{ color: 'var(--text-secondary)' }}>
                      <span className="flex items-center gap-1">
                        <Smartphone size={10} aria-hidden />Your version
                      </span>
                    </th>
                    <th className="text-left pb-2 font-medium pl-2" style={{ color: 'var(--text-secondary)' }}>
                      <span className="flex items-center gap-1">
                        <Server size={10} aria-hidden />Server version
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {changedFields.map((field) => (
                    <tr
                      key={field}
                      className="border-t"
                      style={{ borderColor: 'var(--glass-subtle-border)' }}
                    >
                      <td
                        className="py-1.5 font-medium capitalize"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {field}
                      </td>
                      <td
                        className={cn(
                          'py-1.5 px-2 rounded-l-lg break-all',
                          'bg-[rgba(37,99,235,0.06)]',
                        )}
                        style={{ color: 'var(--accent)' }}
                      >
                        {formatValue(field, local[field])}
                      </td>
                      <td
                        className="py-1.5 pl-2 break-all"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {formatValue(field, server[field])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Actions */}
          <div
            className="flex gap-3 px-5 py-4 border-t"
            style={{ borderColor: 'var(--glass-regular-border)' }}
          >
            <button
              onClick={() => void handleResolve('keep_local')}
              disabled={resolving}
              className={cn(
                'flex-1 flex items-center justify-center gap-2',
                'py-2.5 rounded-xl text-sm font-medium',
                'transition-opacity disabled:opacity-40 hover:opacity-80',
              )}
              style={{ background: 'var(--glass-elevated-bg)', border: '1px solid var(--glass-elevated-border)', color: 'var(--text-primary)' }}
              aria-label="Keep your local version"
            >
              <Smartphone size={13} aria-hidden />
              Keep mine
            </button>
            <button
              onClick={() => void handleResolve('keep_server')}
              disabled={resolving}
              className={cn(
                'flex-1 flex items-center justify-center gap-2',
                'py-2.5 rounded-xl text-sm font-medium',
                'transition-opacity disabled:opacity-40 hover:opacity-80',
              )}
              style={{ background: 'var(--accent)', color: '#fff' }}
              aria-label="Use server version"
            >
              <Check size={13} aria-hidden />
              Use server
            </button>
          </div>

          {/* Additional conflicts indicator */}
          {conflicts.length > 1 && (
            <p
              className="text-center text-xs pb-3"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {conflicts.length - 1} more conflict{conflicts.length - 1 > 1 ? 's' : ''} remaining
            </p>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
