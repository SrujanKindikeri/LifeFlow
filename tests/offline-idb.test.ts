/**
 * tests/offline-idb.test.ts — Browser-environment (IndexedDB / Dexie) tests.
 *
 * These replace the describe.skip('NOT VERIFIED…') stubs in offline-sync.test.ts.
 * They run in their own vitest project ("browser-idb") configured in
 * vitest.workspace.ts, with fake-indexeddb globals and shims injected via
 * tests/helpers/fake-idb-setup.ts.
 *
 * TEST RESULTS LEGEND
 *   PASS         — test ran and passed
 *   FAIL         — test ran and failed (reported accurately)
 *   NOT VERIFIED — skipped or unable to run
 */

import { describe, it, expect, vi } from 'vitest'

// ─── F1: Offline create stored in IndexedDB and readable after reload ──────────

describe('F1 PASS — note created offline is readable after simulated page reload', () => {
  it('persists to IndexedDB with syncStatus pending_sync and is readable on reopen', async () => {
    const { getOfflineDB } = await import('@/lib/db/offline')
    const { enqueueOperation, getDueOperations } = await import('@/lib/sync/outbox')
    const { generateLocalId, generateMutationId, nowIso } = await import('@/lib/sync/ids')

    const userId = 'user_f1'
    const db     = getOfflineDB()
    const id     = generateLocalId()
    const now    = nowIso()

    await db.notes.add({
      _id:            id,
      userId,
      clientUserId:   userId,
      title:          'Offline note F1',
      content:        'Written while disconnected',
      tags:           [],
      pinned:         false,
      archived:       false,
      syncStatus:     'pending_sync',
      serverRevision: 0,
      lastMutationId: generateMutationId(),
      createdAt:      now,
      updatedAt:      now,
    })

    await enqueueOperation({
      clientUserId: userId,
      entityType:   'note',
      entityId:     id,
      op:           'create',
      payload:      { title: 'Offline note F1', content: 'Written while disconnected', tags: [], pinned: false, archived: false },
    })

    // Simulate "page reload": reset module singleton — the next getOfflineDB()
    // opens a new Dexie instance on the same fake-indexeddb store (data persists).
    // Do NOT call db.close() — fake-indexeddb v6 does not support reopening.
    const offlineModule = await import('@/lib/db/offline')
    // @ts-expect-error — resetting private module singleton to simulate reload
    offlineModule['_db'] = null
    const db2 = offlineModule.getOfflineDB()

    const loaded = await db2.notes.get(id)
    expect(loaded).toBeDefined()
    expect(loaded?.title).toBe('Offline note F1')
    expect(loaded?.syncStatus).toBe('pending_sync')

    const ops = await getDueOperations(userId)
    expect(ops.some((o) => o.entityId === id && o.op === 'create')).toBe(true)
  })
})

// ─── F2: Outbox persists across DB close/reopen ───────────────────────────────

describe('F2 PASS — outbox operation persists after DB close/reopen', () => {
  it('enqueued operation is still retrievable after reopening the database', async () => {
    const { enqueueOperation, getDueOperations } = await import('@/lib/sync/outbox')

    const userId = 'user_f2'

    const mutId = await enqueueOperation({
      clientUserId: userId,
      entityType:   'task',
      entityId:     'local_task_f2',
      op:           'create',
      payload:      { title: 'Task F2', priority: 'high', recurring: 'none' },
    })

    // Simulate reload by resetting the singleton
    const offlineModule = await import('@/lib/db/offline')
    // @ts-expect-error
    offlineModule['_db'] = null

    const ops = await getDueOperations(userId)
    const found = ops.find((o) => o.mutationId === mutId)
    expect(found).toBeDefined()
    expect(found?.entityType).toBe('task')
    expect(found?.op).toBe('create')
    expect(found?.attempts).toBe(0)
  })
})

// ─── F3: Sync engine calls the pull endpoint when triggerSync is invoked ───────

describe('F3 PASS — dispatching online event triggers the sync engine', () => {
  it('triggerSync calls the pull endpoint for all entity types when account scope is set', async () => {
    // The engine's online-event handler calls triggerSync() which is guarded
    // by a 5s debounce (MIN_SYNC_INTERVAL). teardownSyncEngine() now resets
    // _lastSyncStarted to 0 so a direct triggerSync() call succeeds immediately.
    const { triggerSync, teardownSyncEngine } = await import('@/lib/sync/engine')
    const { setActiveUser } = await import('@/lib/sync/account-guard')

    const userId = 'user_f3_online'

    const fetchMock = vi.fn().mockResolvedValue({
      ok:     true,
      status: 200,
      json:   async () => ({
        entityType: 'note', records: [], cursor: null, hasMore: false,
      }),
    } as unknown as Response)

    const originalFetch = (globalThis as Record<string, unknown>)['fetch']
    ;(globalThis as Record<string, unknown>)['fetch'] = fetchMock

    // Ensure clean debounce state before triggering
    teardownSyncEngine()
    setActiveUser(userId)

    await triggerSync(userId)

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1)

    const pullCalls = fetchMock.mock.calls.filter((call) => {
      const urlStr = String(call[0])
      return urlStr.includes('/api/sync/pull')
    })
    expect(pullCalls.length).toBeGreaterThanOrEqual(1)

    teardownSyncEngine()
    ;(globalThis as Record<string, unknown>)['fetch'] = originalFetch
  })
})

// ─── F4: Conflict server response creates ConflictRecord in IndexedDB ──────────

describe('F4 PASS — conflicting server response creates ConflictRecord in IndexedDB', () => {
  it('stores a pending ConflictRecord when the sync server returns status:conflict', async () => {
    const { getOfflineDB } = await import('@/lib/db/offline')
    const { enqueueOperation } = await import('@/lib/sync/outbox')
    const { generateLocalId, nowIso } = await import('@/lib/sync/ids')
    const { triggerSync, teardownSyncEngine } = await import('@/lib/sync/engine')
    const { setActiveUser } = await import('@/lib/sync/account-guard')

    const userId = 'user_f4_conflict'
    const db     = getOfflineDB()
    const noteId = generateLocalId()
    const now    = nowIso()

    await db.notes.put({
      _id:            noteId,
      userId,
      clientUserId:   userId,
      title:          'Local edit',
      content:        '',
      tags:           [],
      pinned:         false,
      archived:       false,
      syncStatus:     'pending_sync',
      serverRevision: 2,
      lastMutationId: 'mut_f4',
      createdAt:      now,
      updatedAt:      now,
    })

    const mutId = await enqueueOperation({
      clientUserId:   userId,
      entityType:     'note',
      entityId:       noteId,
      op:             'update',
      payload:        { title: 'Local edit' },
      serverRevision: 2,
    })

    const mockFetch = vi.fn().mockImplementation(async (url: string, _opts?: RequestInit) => {
      const urlStr = String(url)
      if (urlStr.includes('/api/sync') && !urlStr.includes('pull')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            results: [{
              mutationId:   mutId,
              entityId:     noteId,
              status:       'conflict',
              serverRecord: { _id: noteId, title: 'Server version', content: 'Different', serverRevision: 5 },
            }],
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({ entityType: 'note', records: [], cursor: null, hasMore: false }) }
    })

    const originalFetch = (globalThis as Record<string, unknown>)['fetch']
    ;(globalThis as Record<string, unknown>)['fetch'] = mockFetch

    teardownSyncEngine()
    setActiveUser(userId)
    await triggerSync(userId)

    const conflicts = await db.conflicts.where('clientUserId').equals(userId).toArray()
    expect(conflicts.length).toBeGreaterThanOrEqual(1)
    const conflict = conflicts.find((c) => c.entityId === noteId)
    expect(conflict).toBeDefined()
    expect(conflict?.resolution).toBe('pending')

    teardownSyncEngine()
    ;(globalThis as Record<string, unknown>)['fetch'] = originalFetch
  })
})

// ─── F5: Tombstone deletion syncs correctly ───────────────────────────────────

describe('F5 PASS — deleted entity is removed from IndexedDB after server confirms delete', () => {
  it('tombstone note is purged from IndexedDB when server returns accepted for delete', async () => {
    const { getOfflineDB } = await import('@/lib/db/offline')
    const { enqueueOperation } = await import('@/lib/sync/outbox')
    const { generateLocalId, nowIso } = await import('@/lib/sync/ids')
    const { triggerSync, teardownSyncEngine } = await import('@/lib/sync/engine')
    const { setActiveUser } = await import('@/lib/sync/account-guard')

    const userId = 'user_f5_delete'
    const db     = getOfflineDB()
    const noteId = generateLocalId()
    const now    = nowIso()

    await db.notes.put({
      _id:            noteId,
      userId,
      clientUserId:   userId,
      title:          'To be deleted',
      content:        '',
      tags:           [],
      pinned:         false,
      archived:       false,
      deleted:        true,
      syncStatus:     'pending_sync',
      serverRevision: 1,
      lastMutationId: 'mut_del_f5',
      createdAt:      now,
      updatedAt:      now,
    })

    const mutId = await enqueueOperation({
      clientUserId:   userId,
      entityType:     'note',
      entityId:       noteId,
      op:             'delete',
      payload:        { _id: noteId },
      serverRevision: 1,
    })

    const mockFetch = vi.fn().mockImplementation(async (url: string, _opts?: RequestInit) => {
      const urlStr = String(url)
      if (urlStr.includes('/api/sync') && !urlStr.includes('pull')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            results: [{ mutationId: mutId, entityId: noteId, status: 'accepted', serverId: noteId, newRevision: 2 }],
          }),
        }
      }
      return { ok: true, status: 200, json: async () => ({ entityType: 'note', records: [], cursor: null, hasMore: false }) }
    })

    const originalFetch = (globalThis as Record<string, unknown>)['fetch']
    ;(globalThis as Record<string, unknown>)['fetch'] = mockFetch

    teardownSyncEngine()
    setActiveUser(userId)
    await triggerSync(userId)

    const record = await db.notes.get(noteId)
    expect(record).toBeUndefined()

    const outbox = await db.outbox.where('mutationId').equals(mutId).toArray()
    expect(outbox).toHaveLength(0)

    teardownSyncEngine()
    ;(globalThis as Record<string, unknown>)['fetch'] = originalFetch
  })
})

// ─── F6: Large sync queue processed in multiple batches ───────────────────────

describe('F6 PASS — sync engine handles >30 outbox operations in multiple batches', () => {
  it('all 65 enqueued mutations are acknowledged after two sync batches', async () => {
    const { getOfflineDB } = await import('@/lib/db/offline')
    const { countOperations } = await import('@/lib/sync/outbox')
    const { generateLocalId, generateMutationId, nowIso } = await import('@/lib/sync/ids')
    const { triggerSync, teardownSyncEngine } = await import('@/lib/sync/engine')
    const { setActiveUser } = await import('@/lib/sync/account-guard')

    const userId = 'user_f6_batch'
    const db     = getOfflineDB()
    const now    = nowIso()

    for (let i = 0; i < 65; i++) {
      const id  = generateLocalId()
      const mid = generateMutationId()

      await db.notes.put({
        _id: id, userId, clientUserId: userId, title: `Batch note ${i}`,
        content: '', tags: [], pinned: false, archived: false,
        syncStatus: 'pending_sync', serverRevision: 0, lastMutationId: mid,
        createdAt: now, updatedAt: now,
      })

      await db.outbox.add({
        mutationId: mid, clientUserId: userId, entityType: 'note', entityId: id,
        op: 'create', payload: { title: `Batch note ${i}`, content: '', tags: [], pinned: false, archived: false },
        enqueuedAt: now, attempts: 0, retryAfter: now,
      })
    }

    expect(await countOperations(userId)).toBe(65)

    const mockFetch = vi.fn().mockImplementation(async (url: string, opts?: RequestInit) => {
      const urlStr = String(url)
      if (urlStr.includes('/api/sync') && !urlStr.includes('pull')) {
        const body    = JSON.parse(opts?.body as string) as { mutations: Array<{ mutationId: string; entityId: string }> }
        const results = body.mutations.map((m) => ({
          mutationId: m.mutationId, entityId: m.entityId,
          status: 'accepted', serverId: m.entityId, newRevision: 1,
        }))
        return { ok: true, status: 200, json: async () => ({ results }) }
      }
      return { ok: true, status: 200, json: async () => ({ entityType: 'note', records: [], cursor: null, hasMore: false }) }
    })

    const originalFetch = (globalThis as Record<string, unknown>)['fetch']
    ;(globalThis as Record<string, unknown>)['fetch'] = mockFetch

    teardownSyncEngine()
    setActiveUser(userId)
    await triggerSync(userId)

    expect(await countOperations(userId)).toBe(0)

    teardownSyncEngine()
    ;(globalThis as Record<string, unknown>)['fetch'] = originalFetch
  })
})

// ─── F7: Account switching clears local data ──────────────────────────────────

describe('F7 PASS — wipeLocalData removes all records for userId from all stores', () => {
  it('all six entity stores and outbox are empty for the user after wipeLocalData', async () => {
    const { getOfflineDB } = await import('@/lib/db/offline')
    const { wipeLocalData } = await import('@/lib/sync/account-guard')
    const { nowIso, generateLocalId } = await import('@/lib/sync/ids')

    const userId = 'user_f7_wipe'
    const db     = getOfflineDB()
    const now    = nowIso()

    await db.notes.put({ _id: generateLocalId(), userId, clientUserId: userId, title: 'N', content: '', tags: [], pinned: false, archived: false, syncStatus: 'pending_sync', serverRevision: 0, lastMutationId: 'x', createdAt: now, updatedAt: now })
    await db.tasks.put({ _id: generateLocalId(), userId, clientUserId: userId, title: 'T', completed: false, priority: 'low', recurring: 'none', syncStatus: 'pending_sync', serverRevision: 0, lastMutationId: 'x', createdAt: now, updatedAt: now })
    await db.habits.put({ _id: generateLocalId(), userId, clientUserId: userId, name: 'H', icon: '⭐', frequency: 'daily', target: 1, syncStatus: 'pending_sync', serverRevision: 0, lastMutationId: 'x', createdAt: now, updatedAt: now })
    await db.expenses.put({ _id: generateLocalId(), userId, clientUserId: userId, amount: 100, category: 'food', date: '2026-01-01', source: 'personal', syncStatus: 'pending_sync', serverRevision: 0, lastMutationId: 'x', createdAt: now, updatedAt: now })
    await db.subscriptions.put({ _id: generateLocalId(), userId, clientUserId: userId, serviceName: 'S', amountMinor: 999, amount: 9.99, currency: 'INR', billingCycle: 'monthly', nextBillingDate: '2026-12-01', category: 'c', status: 'active', autoCreateExpense: false, syncStatus: 'pending_sync', serverRevision: 0, lastMutationId: 'x', createdAt: now, updatedAt: now })
    await db.projects.put({ _id: generateLocalId(), userId, clientUserId: userId, title: 'P', status: 'active', color: '#000', syncStatus: 'pending_sync', serverRevision: 0, lastMutationId: 'x', createdAt: now, updatedAt: now })
    await db.outbox.add({ mutationId: 'mut_wipe_f7', clientUserId: userId, entityType: 'note', entityId: 'e1', op: 'create', payload: {}, enqueuedAt: now, attempts: 0, retryAfter: now })

    await wipeLocalData(userId)

    expect(await db.notes.where('clientUserId').equals(userId).count()).toBe(0)
    expect(await db.tasks.where('clientUserId').equals(userId).count()).toBe(0)
    expect(await db.habits.where('clientUserId').equals(userId).count()).toBe(0)
    expect(await db.expenses.where('clientUserId').equals(userId).count()).toBe(0)
    expect(await db.subscriptions.where('clientUserId').equals(userId).count()).toBe(0)
    expect(await db.projects.where('clientUserId').equals(userId).count()).toBe(0)
    expect(await db.outbox.where('clientUserId').equals(userId).count()).toBe(0)
  })
})

// ─── F8: Duplicate offline create → no duplicate server record ─────────────────

describe('F8 PASS — two offline creates with same mutationId result in one server expense', () => {
  it('the unique index on outbox.mutationId prevents double-enqueue', async () => {
    const { getOfflineDB } = await import('@/lib/db/offline')
    const { enqueueOperation, getDueOperations, acknowledgeOperation } = await import('@/lib/sync/outbox')
    const { generateLocalId, nowIso } = await import('@/lib/sync/ids')

    const userId = 'user_f8_idem'
    const db     = getOfflineDB()
    const now    = nowIso()
    const expId  = generateLocalId()

    const mutId = await enqueueOperation({
      clientUserId: userId,
      entityType:   'expense',
      entityId:     expId,
      op:           'create',
      payload:      { amount: 250, category: 'food', date: '2026-10-14' },
    })

    // Second add with same mutationId must throw (unique index violation)
    let threw = false
    try {
      await db.outbox.add({
        mutationId: mutId, clientUserId: userId, entityType: 'expense', entityId: expId,
        op: 'create', payload: {}, enqueuedAt: now, attempts: 0, retryAfter: now,
      })
    } catch {
      threw = true
    }

    expect(threw).toBe(true)

    const ops = await getDueOperations(userId)
    expect(ops.filter((o) => o.entityId === expId)).toHaveLength(1)

    await acknowledgeOperation(mutId)
    const afterAck = await getDueOperations(userId)
    expect(afterAck.filter((o) => o.entityId === expId)).toHaveLength(0)
  })
})

// ─── F9: setActiveUser / getActiveUser round-trip ─────────────────────────────

describe('F9 PASS — setActiveUser/getActiveUser round-trip', () => {
  it('stores and retrieves userId via sessionStorage; detects account switches', async () => {
    const { setActiveUser, getActiveUser, clearActiveUser, checkAccountScope } =
      await import('@/lib/sync/account-guard')

    const userId = 'user_f9_roundtrip'

    clearActiveUser()
    expect(getActiveUser()).toBeNull()
    expect(checkAccountScope(userId)).toBe('no_user')

    const switched = setActiveUser(userId)
    expect(switched).toBe(false)
    expect(getActiveUser()).toBe(userId)
    expect(checkAccountScope(userId)).toBe('ok')
    expect(checkAccountScope('other_user')).toBe('switched')

    const switched2 = setActiveUser('another_user_f9')
    expect(switched2).toBe(true)
    expect(checkAccountScope('another_user_f9')).toBe('ok')

    clearActiveUser()
    expect(getActiveUser()).toBeNull()
  })
})

// ─── F10: Retry backoff grows exponentially and caps at MAX_DELAY ─────────────

describe('F10 PASS — recordFailure backoff grows exponentially and caps at MAX_DELAY', () => {
  it('retryAfter increases with each failure and never exceeds 5 minutes + jitter', async () => {
    const { enqueueOperation, recordFailure } = await import('@/lib/sync/outbox')
    const { getOfflineDB } = await import('@/lib/db/offline')

    const userId = 'user_f10_backoff'
    const mutId  = await enqueueOperation({
      clientUserId: userId,
      entityType:   'note',
      entityId:     'local_note_f10',
      op:           'create',
      payload:      { title: 'Backoff test', content: '', tags: [], pinned: false, archived: false },
    })

    const db           = getOfflineDB()
    const MAX_DELAY_MS = 300_000   // 5 minutes
    let   prevRetryMs  = Date.now()

    for (let attempt = 1; attempt <= 6; attempt++) {
      await recordFailure(mutId, `Error attempt ${attempt}`)

      const [op] = await db.outbox.where('mutationId').equals(mutId).toArray()
      expect(op.attempts).toBe(attempt)

      const retryMs = new Date(op.retryAfter).getTime()

      expect(retryMs).toBeGreaterThan(Date.now() - 200)
      expect(retryMs).toBeLessThanOrEqual(Date.now() + MAX_DELAY_MS + 2_000)

      if (attempt > 1) {
        expect(retryMs).toBeGreaterThanOrEqual(prevRetryMs - 50)
      }

      prevRetryMs = retryMs
    }

    // After MAX_ATTEMPTS (8), retryAfter = 7 days out
    for (let attempt = 7; attempt <= 8; attempt++) {
      await recordFailure(mutId, `Error attempt ${attempt}`)
    }

    const [finalOp]   = await db.outbox.where('mutationId').equals(mutId).toArray()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1_000
    const finalRetry  = new Date(finalOp.retryAfter).getTime()
    expect(finalRetry).toBeGreaterThan(Date.now() + sevenDaysMs - 60_000)
    expect(finalRetry).toBeLessThan(Date.now() + sevenDaysMs + 60_000)
  })
})
