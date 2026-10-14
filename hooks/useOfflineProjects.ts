'use client'

/**
 * hooks/useOfflineProjects.ts — Offline-capable projects CRUD.
 */

import { useState, useEffect, useCallback } from 'react'
import { getOfflineDB } from '@/lib/db/offline'
import { enqueueOperation } from '@/lib/sync/outbox'
import { generateLocalId, generateMutationId, nowIso } from '@/lib/sync/ids'
import { triggerSync } from '@/lib/sync/engine'
import type { LocalProject } from '@/types/sync'

interface CreateProjectData {
  title: string
  description?: string
  status?: 'active' | 'on_hold' | 'completed' | 'archived'
  dueDate?: string
  color?: string
}

interface UseOfflineProjectsReturn {
  projects: LocalProject[]
  loading: boolean
  createProject: (data: CreateProjectData) => Promise<LocalProject>
  updateProject: (id: string, data: Partial<CreateProjectData>) => Promise<void>
  deleteProject: (id: string) => Promise<void>
}

export function useOfflineProjects({ clientUserId }: { clientUserId: string }): UseOfflineProjectsReturn {
  const [projects, setProjects] = useState<LocalProject[]>([])
  const [loading, setLoading]   = useState(true)

  const load = useCallback(async () => {
    if (typeof window === 'undefined' || !clientUserId) return
    try {
      const db  = getOfflineDB()
      const all = await db.projects.where('clientUserId').equals(clientUserId).toArray()
      setProjects(
        all
          .filter((p) => !p.deleted)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      )
    } catch { /* IndexedDB unavailable */ } finally { setLoading(false) }
  }, [clientUserId])

  useEffect(() => { void load() }, [load])

  const createProject = useCallback(async (data: CreateProjectData): Promise<LocalProject> => {
    const db  = getOfflineDB()
    const now = nowIso()
    const id  = generateLocalId()
    const project: LocalProject = {
      _id: id, userId: clientUserId, clientUserId,
      title: data.title, description: data.description,
      status: data.status ?? 'active', dueDate: data.dueDate,
      color: data.color ?? '#3b82f6',
      syncStatus: 'pending_sync', serverRevision: 0, lastMutationId: generateMutationId(),
      createdAt: now, updatedAt: now,
    }
    await db.projects.add(project)
    await enqueueOperation({ clientUserId, entityType: 'project', entityId: id, op: 'create', payload: { title: project.title, description: project.description, status: project.status, dueDate: project.dueDate, color: project.color } })
    setProjects((prev) => [project, ...prev])
    void triggerSync()
    return project
  }, [clientUserId])

  const updateProject = useCallback(async (id: string, data: Partial<CreateProjectData>): Promise<void> => {
    const db       = getOfflineDB()
    const existing = await db.projects.get(id)
    if (!existing || existing.clientUserId !== clientUserId) return
    const now = nowIso()
    const upd = { ...data, updatedAt: now, syncStatus: 'pending_sync' as const, lastMutationId: generateMutationId() }
    await db.projects.update(id, upd)
    await enqueueOperation({ clientUserId, entityType: 'project', entityId: id, op: 'update', payload: data, serverRevision: existing.serverRevision })
    setProjects((prev) => prev.map((p) => p._id === id ? { ...p, ...upd } : p))
    void triggerSync()
  }, [clientUserId])

  const deleteProject = useCallback(async (id: string): Promise<void> => {
    const db       = getOfflineDB()
    const existing = await db.projects.get(id)
    if (!existing || existing.clientUserId !== clientUserId) return
    await db.projects.update(id, { deleted: true, syncStatus: 'pending_sync' as const })
    await enqueueOperation({ clientUserId, entityType: 'project', entityId: id, op: 'delete', payload: { _id: id }, serverRevision: existing.serverRevision })
    setProjects((prev) => prev.filter((p) => p._id !== id))
    void triggerSync()
  }, [clientUserId])

  return { projects, loading, createProject, updateProject, deleteProject }
}
