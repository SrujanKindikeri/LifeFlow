import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 60_000,   // mongo-memory-server startup can be slow
    hookTimeout: 60_000,
    // Run test files serially so the in-process MongoDB port doesn't conflict
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    env: {
      SESSION_SECRET: 'test-session-secret-at-least-32-chars-long-for-tests!!',
      MONGODB_DB_NAME: 'test',
    },
    coverage: {
      provider: 'v8',
      include: ['models/**', 'lib/**', 'scripts/**'],
      exclude: ['node_modules/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
