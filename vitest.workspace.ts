/**
 * vitest.workspace.ts — Vitest workspace for LifeFlow.
 *
 * PROJECT 1 — "node"
 *   All existing server-side and pure-logic tests.
 *   Environment: node (same as the original vitest.config.ts).
 *
 * PROJECT 2 — "browser-idb"
 *   Browser-environment tests for IndexedDB / Dexie / sync engine.
 *   Environment: jsdom + fake-indexeddb globals injected via setupFiles.
 *   Isolated from the node project so they never share state.
 */

import { defineWorkspace } from 'vitest/config'
import path from 'path'

export default defineWorkspace([
  // ── Project 1: server-side / node ─────────────────────────────────────────
  {
    extends: './vitest.config.ts',
    test: {
      name:        'node',
      include:     [
        'tests/**/*.test.ts',
        'lib/**/*.test.ts',
      ],
      exclude: [
        'tests/offline-idb.test.ts',  // browser project only
      ],
    },
  },

  // ── Project 2: browser / IndexedDB ────────────────────────────────────────
  {
    test: {
      name:        'browser-idb',
      environment: 'node',   // jsdom not needed — we inject fake-indexeddb globals
      globals:     true,
      testTimeout: 20_000,
      include:     ['tests/offline-idb.test.ts'],
      setupFiles:  ['tests/helpers/fake-idb-setup.ts'],
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, '.') },
    },
  },
])
