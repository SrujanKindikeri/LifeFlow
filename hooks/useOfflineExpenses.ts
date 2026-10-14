'use client'

/**
 * hooks/useOfflineExpenses.ts — Offline-capable expenses CRUD.
 *
 * FINANCIAL DATA SAFETY
 * ─────────────────────
 * • Offline creates always set source: 'personal'. The subscription expense
 *   generation logic runs only on the server (subscriptionScheduler.ts).
 * • The server's unique partial index on (sourceSubscriptionId, subscriptionBillingDate)
 *   prevents duplicate subscription expenses even if the same mutation is
 *   retried multiple times (idempotency via mutationId on the server).
 * • Amount is stored as a float (rupees) in IndexedDB, matching the API format.
 *   The server converts to paise for storage. We never store paise offline
 *   to avoid unit confusion with the existing non-sync expense forms.
 * • Sensitive financial data (amounts, categories) is in IndexedDB.
 *   See account-guard.ts for the shared-device security notice.
 */

import { useState, useEffect, useCallback } from 'react'
import { getOfflineDB } from '@/lib/db/offline'
import { enqueueOperation } from '@/lib/sync/outbox'
import { generateLocalId, generateMutationId, nowIso } from '@/lib/sync/ids'
import { triggerSync } from '@/lib/sync/engine'
import type { LocalExpense } from '@/types/sync'

interface CreateExpenseData {
  amount: number
  category: string
  description?: string
  date: string
  paymentMethod?: string
}

interface UseOfflineExpensesOptions {
  clientUserId: string
  /** Month filter: 'YYYY-MM' */
  month?: string
  /** Category filter */
  category?: string
}

interface UseOfflineExpensesReturn {
  expenses: LocalExpense[]
  loading: boolean
  totalAmount: number
  createExpense: (data: CreateExpenseData) => Promise<LocalExpense>
  updateExpense: (id: string, data: Partial<CreateExpenseData>) => Promise<void>
  deleteExpense: (id: string) => Promise<void>
}

export function useOfflineExpenses({
  clientUserId,
  month,
  category,
}: UseOfflineExpensesOptions): UseOfflineExpensesReturn {
  const [expenses, setExpenses] = useState<LocalExpense[]>([])
  const [loading, setLoading]   = useState(true)

  const load = useCallback(async () => {
    if (typeof window === 'undefined' || !clientUserId) return
    try {
      const db  = getOfflineDB()
      const all = await db.expenses.where('clientUserId').equals(clientUserId).toArray()

      const filtered = all
        .filter((e) => !e.deleted)
        .filter((e) => e.source === 'personal')  // Only show personal expenses offline
        .filter((e) => !month    || e.date.startsWith(month))
        .filter((e) => !category || e.category === category)
        .sort((a, b) => {
          // Date desc, then createdAt desc
          const dateDiff = b.date.localeCompare(a.date)
          if (dateDiff !== 0) return dateDiff
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        })

      setExpenses(filtered)
    } catch { /* IndexedDB unavailable */ } finally { setLoading(false) }
  }, [clientUserId, month, category])

  useEffect(() => { void load() }, [load])

  const totalAmount = expenses.reduce((sum, e) => sum + e.amount, 0)

  const createExpense = useCallback(async (data: CreateExpenseData): Promise<LocalExpense> => {
    const db  = getOfflineDB()
    const now = nowIso()
    const id  = generateLocalId()

    const expense: LocalExpense = {
      _id: id, userId: clientUserId, clientUserId,
      amount: data.amount, category: data.category,
      description: data.description, date: data.date,
      paymentMethod: data.paymentMethod,
      source: 'personal',  // always 'personal' for offline creates
      syncStatus: 'pending_sync', serverRevision: 0, lastMutationId: generateMutationId(),
      createdAt: now, updatedAt: now,
    }

    await db.expenses.add(expense)
    await enqueueOperation({
      clientUserId, entityType: 'expense', entityId: id, op: 'create',
      payload: { amount: data.amount, category: data.category, description: data.description, date: data.date, paymentMethod: data.paymentMethod },
    })
    setExpenses((prev) => [expense, ...prev])
    void triggerSync()
    return expense
  }, [clientUserId])

  const updateExpense = useCallback(async (id: string, data: Partial<CreateExpenseData>): Promise<void> => {
    const db       = getOfflineDB()
    const existing = await db.expenses.get(id)
    if (!existing || existing.clientUserId !== clientUserId) return
    const now = nowIso()
    const upd = { ...data, updatedAt: now, syncStatus: 'pending_sync' as const, lastMutationId: generateMutationId() }
    await db.expenses.update(id, upd)
    await enqueueOperation({ clientUserId, entityType: 'expense', entityId: id, op: 'update', payload: data, serverRevision: existing.serverRevision })
    setExpenses((prev) => prev.map((e) => e._id === id ? { ...e, ...upd } : e))
    void triggerSync()
  }, [clientUserId])

  const deleteExpense = useCallback(async (id: string): Promise<void> => {
    const db       = getOfflineDB()
    const existing = await db.expenses.get(id)
    if (!existing || existing.clientUserId !== clientUserId) return
    await db.expenses.update(id, { deleted: true, syncStatus: 'pending_sync' as const })
    await enqueueOperation({ clientUserId, entityType: 'expense', entityId: id, op: 'delete', payload: { _id: id }, serverRevision: existing.serverRevision })
    setExpenses((prev) => prev.filter((e) => e._id !== id))
    void triggerSync()
  }, [clientUserId])

  return { expenses, loading, totalAmount, createExpense, updateExpense, deleteExpense }
}
