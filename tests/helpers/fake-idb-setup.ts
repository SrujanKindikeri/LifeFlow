/**
 * tests/helpers/fake-idb-setup.ts
 *
 * Injects fake-indexeddb globals and shims for sessionStorage, window, and
 * document so Dexie 4 and the sync engine work in the Node.js test runner.
 *
 * KEY INVARIANT — do NOT call db.close() in test lifecycle hooks.
 * ───────────────────────────────────────────────────────────────
 * fake-indexeddb v6 does not support reopening a Dexie instance after close()
 * within the same process. Calling close() makes the database permanently
 * unavailable for that Dexie instance. The correct approach is:
 *   - Keep one Dexie connection open for the entire test file.
 *   - In afterEach, clear every table (wipe data without closing).
 *   - Reset the module-level `_db` singleton in beforeEach so each test
 *     gets a logically-fresh handle that still uses the same open connection.
 *
 * Tests that need to simulate a "page reload" (F1, F2) should NOT call
 * db.close(). They simulate the reload by resetting the module singleton
 * to null and calling getOfflineDB() again — this returns a NEW Dexie
 * instance that opens the same underlying fake-indexeddb store.
 * fake-indexeddb keeps the data in memory across multiple Dexie instances.
 */

import 'fake-indexeddb/auto'   // sets globalThis.indexedDB, IDBKeyRange, etc.
import { beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// ── sessionStorage shim ────────────────────────────────────────────────────────

const _sessionStore = new Map<string, string>()

const sessionStorageShim = {
  getItem:    (k: string) => _sessionStore.get(k) ?? null,
  setItem:    (k: string, v: string) => { _sessionStore.set(k, v) },
  removeItem: (k: string) => { _sessionStore.delete(k) },
  clear:      () => { _sessionStore.clear() },
  get length() { return _sessionStore.size },
  key:        (i: number) => [..._sessionStore.keys()][i] ?? null,
}

Object.defineProperty(globalThis, 'sessionStorage', {
  value:        sessionStorageShim,
  writable:     true,
  configurable: true,
})

// ── EventTarget shim for window / document ────────────────────────────────────

class FakeEventTarget {
  private _ee = new EventEmitter()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const fn = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
    this._ee.on(type, fn)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const fn = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
    this._ee.off(type, fn)
  }

  dispatchEvent(event: Event): boolean {
    this._ee.emit(event.type, event)
    return true
  }
}

export const fakeWindow = new FakeEventTarget()

Object.defineProperty(globalThis, 'window', {
  value:        fakeWindow,
  writable:     true,
  configurable: true,
})

// Patch window.location so the sync engine can build absolute URLs.
// engine.ts uses: new URL('/api/sync/pull', window.location.origin)
;(fakeWindow as unknown as Record<string, unknown>)['location'] = {
  origin:   'http://localhost:3000',
  href:     'http://localhost:3000/',
  hostname: 'localhost',
  pathname: '/',
  search:   '',
  hash:     '',
  protocol: 'http:',
  port:     '3000',
}

Object.defineProperty(globalThis, 'document', {
  value:        new FakeEventTarget(),
  writable:     true,
  configurable: true,
})

// Route globalThis.addEventListener → fakeWindow so tests can dispatch events
// via globalThis.dispatchEvent(new Event('online'))
Object.defineProperty(globalThis, 'addEventListener', {
  value:        (t: string, l: EventListenerOrEventListenerObject) => fakeWindow.addEventListener(t, l),
  writable:     true,
  configurable: true,
})
Object.defineProperty(globalThis, 'removeEventListener', {
  value:        (t: string, l: EventListenerOrEventListenerObject) => fakeWindow.removeEventListener(t, l),
  writable:     true,
  configurable: true,
})
Object.defineProperty(globalThis, 'dispatchEvent', {
  value:        (e: Event) => fakeWindow.dispatchEvent(e),
  writable:     true,
  configurable: true,
})

// ── Event constructor shim ─────────────────────────────────────────────────────
if (typeof (globalThis as Record<string, unknown>)['Event'] === 'undefined') {
  class SimpleEvent {
    type: string
    constructor(type: string) { this.type = type }
  }
  Object.defineProperty(globalThis, 'Event', {
    value:        SimpleEvent,
    writable:     true,
    configurable: true,
  })
}

// ── Reset between tests ────────────────────────────────────────────────────────

beforeEach(async () => {
  _sessionStore.clear()

  // Tear down any lingering sync engine from a previous test
  try {
    const { teardownSyncEngine } = await import('@/lib/sync/engine')
    teardownSyncEngine()
  } catch { /* not yet imported */ }

  // Reset the Dexie singleton reference. The next call to getOfflineDB() will
  // create a new LifeFlowOfflineDB instance that reopens the same fake-indexeddb
  // store. This is intentional: fake-indexeddb keeps data across multiple
  // Dexie instances pointing to the same store name, which is exactly what
  // F1/F2 "simulate reload" tests rely on.
  //
  // We do NOT call db.close() here — see the file header comment.
  try {
    const offlineModule = await import('@/lib/db/offline')
    // @ts-expect-error — resetting private module singleton
    offlineModule['_db'] = null
  } catch { /* first import */ }
})

afterEach(async () => {
  // Tear down sync engine
  try {
    const { teardownSyncEngine } = await import('@/lib/sync/engine')
    teardownSyncEngine()
  } catch { /* not yet imported */ }

  // Clear all IndexedDB tables — do NOT close the database.
  // Keeping the connection open avoids the fake-indexeddb limitation of
  // not being able to reopen after close(). The next test's beforeEach will
  // reset the singleton to get a logically-fresh handle.
  try {
    const offlineModule = await import('@/lib/db/offline')
    const db = offlineModule.getOfflineDB()
    await Promise.all([
      db.notes.clear(),
      db.tasks.clear(),
      db.habits.clear(),
      db.habitLogs.clear(),
      db.expenses.clear(),
      db.subscriptions.clear(),
      db.projects.clear(),
      db.outbox.clear(),
      db.cursors.clear(),
      db.conflicts.clear(),
    ])
    // Reset singleton so the next test's beforeEach gets a fresh instance
    // @ts-expect-error
    offlineModule['_db'] = null
  } catch { /* DB not yet opened or already nulled */ }
})
