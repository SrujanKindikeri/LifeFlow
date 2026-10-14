'use client'

/**
 * hooks/useOfflineSubscriptions.ts — Offline-capable subscriptions CRUD.
 *
 * SERVER-SIDE ONLY OPERATIONS (never run offline)
 * ─────────────────────────────────────────────────
 * • Subscription renewal automation (runSubscriptionScheduler)
 * • Auto-creating expense records on billing dates
 * • Email/push notifications about upcoming renewals
 *
 * All of the above remain on the server. This hook provides:
 * • Offline READ of cached subscriptions
 * • Offline CREATE of new subscriptions (queued for server sync)
 * • Offline UPDATE of non-billing fields (serviceName, notes, status, category)
 * • Offline DELETE (queued for server sync)
 *
 * BILLING FIELDS (amount, billingCycle, nextBillingDate) can only be
 * reliably edited online because they drive server-side scheduler logic.
 * The sync endpoint only applies safe fields for offline updates.
 */

import { useState, useEffect, useCallback } from 'react'
import { getOfflineDB } from '@/lib/db/offline'
import { enqueueOperation } from '@/lib/sync/outbox'
import { generateLocalId, generateMutationId, nowIso } from '@/lib/sync/ids'
import { triggerSync } from '@/lib/sync/engine'
import type { LocalSubscription } from '@/types/sync'

interface CreateSubscriptionData {
  serviceName: string
  amount: number
  currency?: string
  billingCycle: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'
  customIntervalDays?: number
  nextBillingDate: string
  category?: string
  paymentMethod?: string
  status?: 'active' | 'paused' | 'cancelled'
  autoCreateExpense?: boolean
  notes?: string
}

interface UseOfflineSubscriptionsReturn {
  subscriptions: LocalSubscription[]
  loading: boolean
  summary: { monthlyTotalMinor: number; yearlyTotalMinor: number; activeCount: number }
  createSubscription: (data: CreateSubscriptionData) => Promise<LocalSubscription>
  /** Only updates safe non-billing fields offline */
  updateSubscription: (id: string, data: { serviceName?: string; notes?: string; status?: 'active' | 'paused' | 'cancelled'; category?: string; paymentMethod?: string }) => Promise<void>
  deleteSubscription: (id: string) => Promise<void>
}

function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100)
}

export function useOfflineSubscriptions({
  clientUserId,
}: {
  clientUserId: string
}): UseOfflineSubscriptionsReturn {
  const [subscriptions, setSubscriptions] = useState<LocalSubscription[]>([])
  const [loading, setLoading]             = useState(true)

  const load = useCallback(async () => {
    if (typeof window === 'undefined' || !clientUserId) return
    try {
      const db  = getOfflineDB()
      const all = await db.subscriptions.where('clientUserId').equals(clientUserId).toArray()
      setSubscriptions(
        all
          .filter((s) => !s.deleted)
          .sort((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate))
      )
    } catch { /* IndexedDB unavailable */ } finally { setLoading(false) }
  }, [clientUserId])

  useEffect(() => { void load() }, [load])

  // Compute summary from local data
  const summary = (() => {
    const active = subscriptions.filter((s) => s.status === 'active')
    let monthly = 0
    for (const s of active) {
      switch (s.billingCycle) {
        case 'weekly':    monthly += Math.round(s.amountMinor * 4.33); break
        case 'monthly':   monthly += s.amountMinor; break
        case 'quarterly': monthly += Math.round(s.amountMinor / 3); break
        case 'yearly':    monthly += Math.round(s.amountMinor / 12); break
        case 'custom':
          if (s.customIntervalDays) monthly += Math.round((s.amountMinor / s.customIntervalDays) * 30)
          break
      }
    }
    return { monthlyTotalMinor: monthly, yearlyTotalMinor: monthly * 12, activeCount: active.length }
  })()

  const createSubscription = useCallback(async (data: CreateSubscriptionData): Promise<LocalSubscription> => {
    const db          = getOfflineDB()
    const now         = nowIso()
    const id          = generateLocalId()
    const amountMinor = rupeesToPaise(data.amount)

    const sub: LocalSubscription = {
      _id: id, userId: clientUserId, clientUserId,
      serviceName: data.serviceName, amountMinor, amount: data.amount,
      currency: data.currency ?? 'INR',
      billingCycle: data.billingCycle, customIntervalDays: data.customIntervalDays,
      nextBillingDate: data.nextBillingDate, lastBillingDate: null,
      category: data.category ?? 'other', paymentMethod: data.paymentMethod,
      status: data.status ?? 'active', autoCreateExpense: data.autoCreateExpense ?? true,
      notes: data.notes,
      syncStatus: 'pending_sync', serverRevision: 0, lastMutationId: generateMutationId(),
      createdAt: now, updatedAt: now,
    }

    await db.subscriptions.add(sub)
    await enqueueOperation({
      clientUserId, entityType: 'subscription', entityId: id, op: 'create',
      payload: { serviceName: sub.serviceName, amountMinor, currency: sub.currency, billingCycle: sub.billingCycle, customIntervalDays: sub.customIntervalDays, nextBillingDate: sub.nextBillingDate, category: sub.category, paymentMethod: sub.paymentMethod, status: sub.status, autoCreateExpense: sub.autoCreateExpense, notes: sub.notes },
    })
    setSubscriptions((prev) => [...prev, sub].sort((a, b) => a.nextBillingDate.localeCompare(b.nextBillingDate)))
    void triggerSync()
    return sub
  }, [clientUserId])

  const updateSubscription = useCallback(async (id: string, data: { serviceName?: string; notes?: string; status?: 'active' | 'paused' | 'cancelled'; category?: string; paymentMethod?: string }): Promise<void> => {
    const db       = getOfflineDB()
    const existing = await db.subscriptions.get(id)
    if (!existing || existing.clientUserId !== clientUserId) return
    const now = nowIso()
    const upd = { ...data, updatedAt: now, syncStatus: 'pending_sync' as const, lastMutationId: generateMutationId() }
    await db.subscriptions.update(id, upd)
    await enqueueOperation({ clientUserId, entityType: 'subscription', entityId: id, op: 'update', payload: data, serverRevision: existing.serverRevision })
    setSubscriptions((prev) => prev.map((s) => s._id === id ? { ...s, ...upd } : s))
    void triggerSync()
  }, [clientUserId])

  const deleteSubscription = useCallback(async (id: string): Promise<void> => {
    const db       = getOfflineDB()
    const existing = await db.subscriptions.get(id)
    if (!existing || existing.clientUserId !== clientUserId) return
    await db.subscriptions.update(id, { deleted: true, syncStatus: 'pending_sync' as const })
    await enqueueOperation({ clientUserId, entityType: 'subscription', entityId: id, op: 'delete', payload: { _id: id }, serverRevision: existing.serverRevision })
    setSubscriptions((prev) => prev.filter((s) => s._id !== id))
    void triggerSync()
  }, [clientUserId])

  return { subscriptions, loading, summary, createSubscription, updateSubscription, deleteSubscription }
}
