'use client'

/**
 * hooks/useOfflineTasks.ts — Offline-capable tasks CRUD.
 */

import { useState, useEffect, useCallback } from 'react'
import { getOfflineDB } from '@/lib/db/offline'
import { enqueueOperation } from '@/lib/sync/outbox'
import { generateLocalId, generateMutationId, nowIso } from '@/lib/sync/ids'
import { triggerSync } from '@/lib/sync/engine'
import type { LocalTask } from '@/types/sync'

interface CreateTaskData {
  title: string
  description?: string
  priority?: 'low' | 'medium' | 'high'
  dueDate?: string
  dueTime?: string
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly'
}

interface UseOfflineTasksOptions {
  clientUserId: string
  /** If provided, only return tasks with this dueDate */
  dueDate?: string
  /** If provided, filter by completed status */
  completed?: boolean
}

interface UseOfflineTasksReturn {
  tasks: LocalTask[]
  loading: boolean
  createTask: (data: CreateTaskData) => Promise<LocalTask>
  updateTask: (id: string, data: Partial<CreateTaskData> & { completed?: boolean }) => Promise<void>
  toggleComplete: (id: string) => Promise<void>
  deleteTask: (id: string) => Promise<void>
}

export function useOfflineTasks({
  clientUserId,
  dueDate,
  completed,
}: UseOfflineTasksOptions): UseOfflineTasksReturn {
  const [tasks, setTasks]     = useState<LocalTask[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (typeof window === 'undefined' || !clientUserId) return
    try {
      const db  = getOfflineDB()
      const all = await db.tasks.where('clientUserId').equals(clientUserId).toArray()

      const filtered = all
        .filter((t) => !t.deleted)
        .filter((t) => dueDate === undefined || t.dueDate === dueDate)
        .filter((t) => completed === undefined || t.completed === completed)
        .sort((a, b) => {
          const pOrder = { high: 0, medium: 1, low: 2 }
          const pDiff  = (pOrder[a.priority] ?? 1) - (pOrder[b.priority] ?? 1)
          if (pDiff !== 0) return pDiff
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        })

      setTasks(filtered)
    } catch {
      // IndexedDB unavailable
    } finally {
      setLoading(false)
    }
  }, [clientUserId, dueDate, completed])

  useEffect(() => { void load() }, [load])

  const createTask = useCallback(async (data: CreateTaskData): Promise<LocalTask> => {
    const db  = getOfflineDB()
    const now = nowIso()
    const id  = generateLocalId()

    const task: LocalTask = {
      _id:           id,
      userId:        clientUserId,
      clientUserId,
      title:         data.title,
      description:   data.description,
      completed:     false,
      priority:      data.priority ?? 'medium',
      dueDate:       data.dueDate,
      dueTime:       data.dueTime,
      recurring:     data.recurring ?? 'none',
      syncStatus:    'pending_sync',
      serverRevision: 0,
      lastMutationId: generateMutationId(),
      createdAt:     now,
      updatedAt:     now,
    }

    await db.tasks.add(task)
    await enqueueOperation({ clientUserId, entityType: 'task', entityId: id, op: 'create', payload: { title: task.title, description: task.description, priority: task.priority, dueDate: task.dueDate, dueTime: task.dueTime, recurring: task.recurring } })
    setTasks((prev) => [task, ...prev])
    void triggerSync()
    return task
  }, [clientUserId])

  const updateTask = useCallback(async (id: string, data: Partial<CreateTaskData> & { completed?: boolean }): Promise<void> => {
    const db       = getOfflineDB()
    const existing = await db.tasks.get(id)
    if (!existing || existing.clientUserId !== clientUserId) return

    const now   = nowIso()
    const mutId = generateMutationId()
    const upd   = { ...data, updatedAt: now, syncStatus: 'pending_sync' as const, lastMutationId: mutId }

    await db.tasks.update(id, upd)
    await enqueueOperation({ clientUserId, entityType: 'task', entityId: id, op: 'update', payload: data, serverRevision: existing.serverRevision })
    setTasks((prev) => prev.map((t) => t._id === id ? { ...t, ...upd } : t))
    void triggerSync()
  }, [clientUserId])

  const toggleComplete = useCallback(async (id: string): Promise<void> => {
    const db       = getOfflineDB()
    const existing = await db.tasks.get(id)
    if (!existing || existing.clientUserId !== clientUserId) return
    await updateTask(id, { completed: !existing.completed })
  }, [clientUserId, updateTask])

  const deleteTask = useCallback(async (id: string): Promise<void> => {
    const db       = getOfflineDB()
    const existing = await db.tasks.get(id)
    if (!existing || existing.clientUserId !== clientUserId) return

    await db.tasks.update(id, { deleted: true, syncStatus: 'pending_sync' as const })
    await enqueueOperation({ clientUserId, entityType: 'task', entityId: id, op: 'delete', payload: { _id: id }, serverRevision: existing.serverRevision })
    setTasks((prev) => prev.filter((t) => t._id !== id))
    void triggerSync()
  }, [clientUserId])

  return { tasks, loading, createTask, updateTask, toggleComplete, deleteTask }
}
