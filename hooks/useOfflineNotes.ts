'use client'

/**
 * hooks/useOfflineNotes.ts — Offline-capable notes CRUD.
 *
 * READ PATH:  IndexedDB (always fresh from local store).
 * WRITE PATH: Write to IndexedDB immediately → enqueue in outbox → trigger sync.
 *
 * The existing online forms and API routes continue to work unchanged.
 * This hook is the offline-first alternative for components that need to
 * support offline use.
 *
 * SECURITY: clientUserId is always sourced from the server session (passed in
 * from the SyncProvider/useCurrentUser hook), never from client-generated data.
 */

import { useState, useEffect, useCallback } from 'react'
import { getOfflineDB } from '@/lib/db/offline'
import { enqueueOperation } from '@/lib/sync/outbox'
import { generateLocalId, generateMutationId, nowIso } from '@/lib/sync/ids'
import { triggerSync } from '@/lib/sync/engine'
import type { LocalNote } from '@/types/sync'

interface UseOfflineNotesOptions {
  clientUserId: string
  /** Filter: 'active' (default), 'archived', 'all' */
  filter?: 'active' | 'archived' | 'all'
}

interface UseOfflineNotesReturn {
  notes: LocalNote[]
  loading: boolean
  createNote: (data: CreateNoteData) => Promise<LocalNote>
  updateNote: (id: string, data: Partial<CreateNoteData>) => Promise<void>
  deleteNote: (id: string) => Promise<void>
}

interface CreateNoteData {
  title: string
  content?: string
  tags?: string[]
  pinned?: boolean
  archived?: boolean
}

export function useOfflineNotes({
  clientUserId,
  filter = 'active',
}: UseOfflineNotesOptions): UseOfflineNotesReturn {
  const [notes, setNotes]   = useState<LocalNote[]>([])
  const [loading, setLoading] = useState(true)

  // ── Load from IndexedDB ──────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (typeof window === 'undefined' || !clientUserId) return
    try {
      const db  = getOfflineDB()
      let query = db.notes.where('clientUserId').equals(clientUserId)

      const all = await query.toArray()

      const filtered = all
        .filter((n) => !n.deleted)
        .filter((n) => {
          if (filter === 'archived') return n.archived
          if (filter === 'active')   return !n.archived
          return true
        })
        .sort((a, b) => {
          // Pinned first, then by updatedAt desc
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        })

      setNotes(filtered)
    } catch {
      // IndexedDB unavailable — leave empty
    } finally {
      setLoading(false)
    }
  }, [clientUserId, filter])

  useEffect(() => {
    void load()
  }, [load])

  // ── Create ───────────────────────────────────────────────────────────────
  const createNote = useCallback(async (data: CreateNoteData): Promise<LocalNote> => {
    const db  = getOfflineDB()
    const now = nowIso()
    const id  = generateLocalId()

    const note: LocalNote = {
      _id:           id,
      userId:        clientUserId,
      clientUserId,
      title:         data.title,
      content:       data.content ?? '',
      tags:          data.tags ?? [],
      pinned:        data.pinned ?? false,
      archived:      data.archived ?? false,
      syncStatus:    'pending_sync',
      serverRevision: 0,
      lastMutationId: generateMutationId(),
      createdAt:     now,
      updatedAt:     now,
    }

    await db.notes.add(note)

    await enqueueOperation({
      clientUserId,
      entityType: 'note',
      entityId:   id,
      op:         'create',
      payload:    { title: note.title, content: note.content, tags: note.tags, pinned: note.pinned, archived: note.archived },
    })

    setNotes((prev) => [note, ...prev].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    }))

    void triggerSync()
    return note
  }, [clientUserId])

  // ── Update ───────────────────────────────────────────────────────────────
  const updateNote = useCallback(async (id: string, data: Partial<CreateNoteData>): Promise<void> => {
    const db      = getOfflineDB()
    const existing = await db.notes.get(id)
    if (!existing || existing.clientUserId !== clientUserId) return

    const now     = nowIso()
    const mutId   = generateMutationId()
    const updated = { ...data, updatedAt: now, syncStatus: 'pending_sync' as const, lastMutationId: mutId }

    await db.notes.update(id, updated)

    await enqueueOperation({
      clientUserId,
      entityType:     'note',
      entityId:       id,
      op:             'update',
      payload:        data,
      serverRevision: existing.serverRevision,
    })

    setNotes((prev) =>
      prev.map((n) => n._id === id ? { ...n, ...updated } : n)
    )

    void triggerSync()
  }, [clientUserId])

  // ── Delete ───────────────────────────────────────────────────────────────
  const deleteNote = useCallback(async (id: string): Promise<void> => {
    const db       = getOfflineDB()
    const existing = await db.notes.get(id)
    if (!existing || existing.clientUserId !== clientUserId) return

    // Tombstone locally — keep record until server confirms deletion
    await db.notes.update(id, { deleted: true, syncStatus: 'pending_sync' as const })

    await enqueueOperation({
      clientUserId,
      entityType:     'note',
      entityId:       id,
      op:             'delete',
      payload:        { _id: id },
      serverRevision: existing.serverRevision,
    })

    setNotes((prev) => prev.filter((n) => n._id !== id))
    void triggerSync()
  }, [clientUserId])

  return { notes, loading, createNote, updateNote, deleteNote }
}
