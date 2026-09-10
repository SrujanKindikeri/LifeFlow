'use client'

/**
 * useDraft — per-form draft autosave hook
 *
 * Usage:
 *   const { draftId, saveStatus, saveDraft, deleteDraft, hasMeaningfulData } = useDraft({
 *     type: 'expense',
 *     initialDraftId: searchParams.get('draftId') ?? undefined,
 *     getTitle: () => form.description || 'Expense Draft',
 *     getData: () => ({ amount: form.amount, category: form.category, ... }),
 *     hasMeaningfulData: () => Boolean(form.amount || form.description),
 *   })
 *
 * Rules enforced:
 * - Does NOT autosave an empty form (hasMeaningfulData guard).
 * - Debounces autosave by 1.5 s after the last change.
 * - Uses a stable draftId so every autosave updates the same draft (no duplicates).
 * - Tracks in-flight request sequence to prevent stale writes overwriting newer data.
 * - Exposes saveStatus: 'idle' | 'saving' | 'saved' | 'error' for UI feedback.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DraftType } from '@/models/Draft'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface UseDraftOptions {
  /** Draft type — maps to the DraftType union */
  type: DraftType
  /** If the user navigated from /app/drafts by clicking Continue, pass the existing draftId */
  initialDraftId?: string
  /** Returns the title to display in the Drafts list */
  getTitle: () => string
  /** Returns the current form state to persist */
  getData: () => Record<string, unknown>
  /** Returns true when the form has enough content to be worth saving as a draft */
  hasMeaningfulData: () => boolean
  /** Autosave debounce delay in ms (default: 1500) */
  debounceMs?: number
}

export interface UseDraftReturn {
  /** The MongoDB _id of the draft, once created */
  draftId: string | null
  /** Current save state for UI indicator */
  saveStatus: SaveStatus
  /** Manually trigger a save (e.g. on "Save Draft" button click) */
  saveDraft: () => Promise<string | null>
  /** Delete the current draft (e.g. after finalization or explicit discard) */
  deleteDraft: () => Promise<void>
  /** Trigger a debounced autosave — call this whenever form data changes */
  triggerAutosave: () => void
  /** Whether the form currently has content worth saving */
  hasMeaningfulData: () => boolean
}

export function useDraft({
  type,
  initialDraftId,
  getTitle,
  getData,
  hasMeaningfulData,
  debounceMs = 1500,
}: UseDraftOptions): UseDraftReturn {
  const [draftId, setDraftId] = useState<string | null>(initialDraftId ?? null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  // Tracks the sequence number of the last save request we sent.
  // If a later save completes before an earlier one, we ignore the earlier result.
  const seqRef = useRef(0)
  const latestCompletedSeqRef = useRef(0)

  // Debounce timer handle
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep a ref to draftId so callbacks always see the current value without
  // needing to be re-created when draftId changes.
  const draftIdRef = useRef<string | null>(initialDraftId ?? null)
  useEffect(() => {
    draftIdRef.current = draftId
  }, [draftId])

  // ── Core save function ────────────────────────────────────────────────────

  const saveDraft = useCallback(async (): Promise<string | null> => {
    if (!hasMeaningfulData()) return null

    const seq = ++seqRef.current
    setSaveStatus('saving')

    try {
      const title = getTitle() || 'Untitled Draft'
      const data = getData()
      const currentDraftId = draftIdRef.current

      let res: Response

      if (currentDraftId) {
        // Update existing draft
        res = await fetch(`/api/drafts/${currentDraftId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, data }),
        })
      } else {
        // Create new draft
        res = await fetch('/api/drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, title, data }),
        })
      }

      // Stale-response guard: ignore if a newer request already completed
      if (seq < latestCompletedSeqRef.current) return draftIdRef.current

      latestCompletedSeqRef.current = seq

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        console.error('[useDraft] save failed:', err)
        setSaveStatus('error')
        return draftIdRef.current
      }

      const json = await res.json()
      const savedId: string = json.draft._id

      setDraftId(savedId)
      draftIdRef.current = savedId
      setSaveStatus('saved')

      // Reset indicator back to idle after 3 s
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 3000)

      return savedId
    } catch (err) {
      if (seq < latestCompletedSeqRef.current) return draftIdRef.current
      latestCompletedSeqRef.current = seq
      console.error('[useDraft] network error:', err)
      setSaveStatus('error')
      return draftIdRef.current
    }
  }, [type, getTitle, getData, hasMeaningfulData])

  // ── Debounced autosave trigger ────────────────────────────────────────────

  const triggerAutosave = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      void saveDraft()
    }, debounceMs)
  }, [saveDraft, debounceMs])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [])

  // ── Delete draft ──────────────────────────────────────────────────────────

  const deleteDraft = useCallback(async () => {
    const id = draftIdRef.current
    if (!id) return
    try {
      await fetch(`/api/drafts/${id}`, { method: 'DELETE' })
      setDraftId(null)
      draftIdRef.current = null
    } catch (err) {
      console.error('[useDraft] delete failed:', err)
    }
  }, [])

  return {
    draftId,
    saveStatus,
    saveDraft,
    deleteDraft,
    triggerAutosave,
    hasMeaningfulData,
  }
}
