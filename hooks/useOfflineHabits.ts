'use client'

/**
 * hooks/useOfflineHabits.ts — Offline-capable habits + habit logs CRUD.
 *
 * HABIT LOG IDEMPOTENCY
 * ─────────────────────
 * The server enforces a unique index on (userId, habitId, date).
 * Offline completions are idempotent: completing the same habit on the same
 * date twice produces one log entry. Removing a completion is also idempotent.
 *
 * CASCADING DELETE
 * ─────────────────
 * Deleting a habit locally also tombstones all its local logs.
 * The sync endpoint mirrors this (HabitLog.deleteMany on habit delete).
 */

import { useState, useEffect, useCallback } from 'react'
import { getOfflineDB } from '@/lib/db/offline'
import { enqueueOperation } from '@/lib/sync/outbox'
import { generateLocalId, generateMutationId, nowIso } from '@/lib/sync/ids'
import { triggerSync } from '@/lib/sync/engine'
import type { LocalHabit, LocalHabitLog } from '@/types/sync'

// ─── Habits ───────────────────────────────────────────────────────────────────

interface CreateHabitData {
  name: string
  icon?: string
  description?: string
  frequency?: 'daily' | 'weekly'
  target?: number
}

interface UseOfflineHabitsReturn {
  habits: LocalHabit[]
  loading: boolean
  createHabit: (data: CreateHabitData) => Promise<LocalHabit>
  updateHabit: (id: string, data: Partial<CreateHabitData>) => Promise<void>
  deleteHabit: (id: string) => Promise<void>
}

export function useOfflineHabits({ clientUserId }: { clientUserId: string }): UseOfflineHabitsReturn {
  const [habits, setHabits]   = useState<LocalHabit[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (typeof window === 'undefined' || !clientUserId) return
    try {
      const db  = getOfflineDB()
      const all = await db.habits.where('clientUserId').equals(clientUserId).toArray()
      setHabits(all.filter((h) => !h.deleted).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()))
    } catch { /* IndexedDB unavailable */ } finally { setLoading(false) }
  }, [clientUserId])

  useEffect(() => { void load() }, [load])

  const createHabit = useCallback(async (data: CreateHabitData): Promise<LocalHabit> => {
    const db  = getOfflineDB()
    const now = nowIso()
    const id  = generateLocalId()
    const habit: LocalHabit = {
      _id: id, userId: clientUserId, clientUserId,
      name: data.name, icon: data.icon ?? '⭐', description: data.description,
      frequency: data.frequency ?? 'daily', target: data.target ?? 1,
      syncStatus: 'pending_sync', serverRevision: 0, lastMutationId: generateMutationId(),
      createdAt: now, updatedAt: now,
    }
    await db.habits.add(habit)
    await enqueueOperation({ clientUserId, entityType: 'habit', entityId: id, op: 'create', payload: { name: habit.name, icon: habit.icon, description: habit.description, frequency: habit.frequency, target: habit.target } })
    setHabits((prev) => [...prev, habit])
    void triggerSync()
    return habit
  }, [clientUserId])

  const updateHabit = useCallback(async (id: string, data: Partial<CreateHabitData>): Promise<void> => {
    const db  = getOfflineDB()
    const existing = await db.habits.get(id)
    if (!existing || existing.clientUserId !== clientUserId) return
    const now = nowIso()
    const upd = { ...data, updatedAt: now, syncStatus: 'pending_sync' as const, lastMutationId: generateMutationId() }
    await db.habits.update(id, upd)
    await enqueueOperation({ clientUserId, entityType: 'habit', entityId: id, op: 'update', payload: data, serverRevision: existing.serverRevision })
    setHabits((prev) => prev.map((h) => h._id === id ? { ...h, ...upd } : h))
    void triggerSync()
  }, [clientUserId])

  const deleteHabit = useCallback(async (id: string): Promise<void> => {
    const db  = getOfflineDB()
    const existing = await db.habits.get(id)
    if (!existing || existing.clientUserId !== clientUserId) return
    await db.habits.update(id, { deleted: true, syncStatus: 'pending_sync' as const })
    // Tombstone all logs for this habit
    await db.habitLogs.where('clientUserId').equals(clientUserId)
      .and((l) => l.habitId === id)
      .modify({ deleted: true })
    await enqueueOperation({ clientUserId, entityType: 'habit', entityId: id, op: 'delete', payload: { _id: id }, serverRevision: existing.serverRevision })
    setHabits((prev) => prev.filter((h) => h._id !== id))
    void triggerSync()
  }, [clientUserId])

  return { habits, loading, createHabit, updateHabit, deleteHabit }
}

// ─── Habit logs ───────────────────────────────────────────────────────────────

interface UseHabitLogsReturn {
  logs: LocalHabitLog[]
  loading: boolean
  /** Returns true if the habit is completed for the given date */
  isCompleted: (habitId: string, date: string) => boolean
  toggleCompletion: (habitId: string, date: string) => Promise<void>
}

export function useOfflineHabitLogs({
  clientUserId,
  dateRange = 30,
}: {
  clientUserId: string
  dateRange?: number
}): UseHabitLogsReturn {
  const [logs, setLogs]       = useState<LocalHabitLog[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (typeof window === 'undefined' || !clientUserId) return
    try {
      const db    = getOfflineDB()
      const start = new Date()
      start.setDate(start.getDate() - dateRange)
      const startStr = start.toISOString().split('T')[0]
      const all = await db.habitLogs.where('clientUserId').equals(clientUserId).toArray()
      setLogs(all.filter((l) => !l.deleted && l.date >= startStr))
    } catch { /* IndexedDB unavailable */ } finally { setLoading(false) }
  }, [clientUserId, dateRange])

  useEffect(() => { void load() }, [load])

  const isCompleted = useCallback(
    (habitId: string, date: string) =>
      logs.some((l) => l.habitId === habitId && l.date === date && l.completed),
    [logs],
  )

  const toggleCompletion = useCallback(async (habitId: string, date: string): Promise<void> => {
    const db          = getOfflineDB()
    const existingLog = await db.habitLogs
      .where('[clientUserId+habitId+date]')
      .equals([clientUserId, habitId, date])
      .first()

    if (existingLog && existingLog.completed) {
      // Remove completion
      await db.habitLogs.update(existingLog._id, { completed: false, deleted: true, syncStatus: 'pending_sync' as const })
      await enqueueOperation({ clientUserId, entityType: 'habitLog', entityId: existingLog._id, op: 'update', payload: { habitId, date, completed: false } })
      setLogs((prev) => prev.filter((l) => !(l.habitId === habitId && l.date === date)))
    } else {
      // Add completion — upsert (idempotent)
      const now = nowIso()
      const id  = existingLog?._id ?? generateLocalId()
      const log: LocalHabitLog = {
        _id: id, userId: clientUserId, clientUserId,
        habitId, date, completed: true,
        syncStatus: 'pending_sync', serverRevision: 0, lastMutationId: generateMutationId(),
        createdAt: now, updatedAt: now,
      }
      await db.habitLogs.put(log)
      await enqueueOperation({ clientUserId, entityType: 'habitLog', entityId: id, op: 'create', payload: { habitId, date, completed: true } })
      setLogs((prev) => {
        const without = prev.filter((l) => !(l.habitId === habitId && l.date === date))
        return [...without, log]
      })
    }

    void triggerSync()
  }, [clientUserId])

  return { logs, loading, isCompleted, toggleCompletion }
}
