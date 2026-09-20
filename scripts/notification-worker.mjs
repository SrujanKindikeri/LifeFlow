#!/usr/bin/env node
/**
 * scripts/notification-worker.mjs
 *
 * LifeFlow Notification Worker — Production Background Process
 * ─────────────────────────────────────────────────────────────
 * Runs as a long-lived standalone Node.js process alongside the Next.js app.
 * Polls the /api/jobs/process-notifications-precise endpoint every ~5 seconds
 * so notifications fire within seconds of their scheduled UTC time.
 *
 * WHY HTTP POLLING (not direct module import)
 * ───────────────────────────────────────────
 * The Next.js scheduler runs inside the Next.js runtime (with Mongoose
 * connection pooling, singleton providers, etc.).  Calling the HTTP endpoint
 * keeps the worker simple — no TypeScript compilation required, no module
 * alias resolution, no duplicate DB connections — the app handles all of that.
 *
 * OPERATION
 * ─────────
 * • Polls APP_URL/api/jobs/process-notifications-precise every POLL_INTERVAL_MS
 * • Uses SCHEDULER_SECRET or CRON_SECRET for the Authorization header
 * • Retries with exponential back-off on connection failure (app not yet ready)
 * • Survives: Docker restart, EC2 reboot, temporary MongoDB outage, Gmail outage
 * • Logs to stdout in structured JSON (picked up by Docker/CloudWatch)
 * • Exits with code 1 if SCHEDULER_SECRET is not set (misconfiguration)
 *
 * ENVIRONMENT VARIABLES
 * ─────────────────────
 *   APP_URL            Internal URL of the Next.js app (default: http://app:3000)
 *   SCHEDULER_SECRET   Secret for the scheduler endpoint (required)
 *   CRON_SECRET        Alternative secret name (checked if SCHEDULER_SECRET absent)
 *   POLL_INTERVAL_MS   Milliseconds between polls (default: 5000)
 *   WORKER_LOG_LEVEL   "debug" | "info" | "warn" | "error"  (default: "info")
 *
 * SECURITY
 * ────────
 * • SCHEDULER_SECRET is passed in an Authorization header — never logged.
 * • No database credentials or SMTP passwords are used by this process.
 * • The worker only reads the scheduler's JSON response.
 */

import { setTimeout as sleep } from 'timers/promises'

// ── Configuration ─────────────────────────────────────────────────────────────

const APP_URL           = (process.env.APP_URL ?? 'http://app:3000').replace(/\/$/, '')
const POLL_INTERVAL_MS  = Math.max(1000, parseInt(process.env.POLL_INTERVAL_MS ?? '5000', 10))
const LOG_LEVEL         = (process.env.WORKER_LOG_LEVEL ?? 'info').toLowerCase()
const ENDPOINT          = `${APP_URL}/api/jobs/process-notifications-precise`

// Secret resolution — prefer SCHEDULER_SECRET, fall back to CRON_SECRET
const SECRET = process.env.SCHEDULER_SECRET || process.env.CRON_SECRET || ''

// ── Logger ────────────────────────────────────────────────────────────────────

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const currentLevel = LEVELS[LOG_LEVEL] ?? 1

function log(level, msg, extra = {}) {
  if ((LEVELS[level] ?? 99) < currentLevel) return
  const entry = {
    ts:     new Date().toISOString(),
    level,
    worker: 'notification-worker',
    msg,
    ...extra,
  }
  // Stdout only — Docker/CloudWatch collects this
  process.stdout.write(JSON.stringify(entry) + '\n')
}

// ── Startup guard ──────────────────────────────────────────────────────────────

if (!SECRET) {
  log('error', 'SCHEDULER_SECRET (or CRON_SECRET) is not set — worker cannot authenticate', {
    hint: 'Set SCHEDULER_SECRET in your environment / docker-compose.yml',
  })
  process.exit(1)
}

// ── Startup banner ─────────────────────────────────────────────────────────────

log('info', 'LifeFlow Notification Worker starting', {
  endpoint:       ENDPOINT,
  pollIntervalMs: POLL_INTERVAL_MS,
  logLevel:       LOG_LEVEL,
})

// ── App readiness wait ─────────────────────────────────────────────────────────
// The app container may still be booting when this worker starts.
// Poll /api/health until it responds 200, with exponential back-off.

const HEALTH_URL = `${APP_URL}/api/health`
const MAX_READY_WAIT_MS = 120_000 // 2 minutes
const INITIAL_BACKOFF_MS = 2_000

async function waitForApp() {
  const deadline = Date.now() + MAX_READY_WAIT_MS
  let backoff = INITIAL_BACKOFF_MS

  log('info', 'Waiting for app to become ready', { healthUrl: HEALTH_URL })

  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5000) })
      if (res.status < 500) {
        log('info', 'App is ready', { statusCode: res.status })
        return true
      }
      log('debug', 'App health check returned non-2xx', { statusCode: res.status })
    } catch (err) {
      log('debug', 'App not yet reachable', { error: err.message })
    }

    await sleep(backoff)
    backoff = Math.min(backoff * 1.5, 15_000) // cap at 15 s
  }

  log('warn', 'App did not become ready within timeout — proceeding anyway', {
    maxWaitMs: MAX_READY_WAIT_MS,
  })
  return false
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

let consecutiveErrors = 0
const MAX_CONSECUTIVE_ERRORS = 10  // after this, log a more prominent warning

async function pollOnce() {
  const t0 = Date.now()

  try {
    const res = await fetch(ENDPOINT, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${SECRET}`,
        'Content-Type':  'application/json',
        'User-Agent':    'lifeflow-notification-worker/1.0',
      },
      signal: AbortSignal.timeout(30_000), // 30-second timeout per request
    })

    const durationMs = Date.now() - t0

    if (res.status === 401) {
      log('error', 'Scheduler auth rejected — SCHEDULER_SECRET mismatch', { statusCode: 401 })
      // Don't exit — secret might be updated; keep trying
      consecutiveErrors++
      return
    }

    if (res.status === 503) {
      log('warn', 'Scheduler not configured (503) — app may still be starting', { statusCode: 503 })
      consecutiveErrors++
      return
    }

    if (!res.ok) {
      log('warn', 'Scheduler returned non-OK', { statusCode: res.status, durationMs })
      consecutiveErrors++
      return
    }

    const body = await res.json().catch(() => null)

    consecutiveErrors = 0 // reset on success

    log('debug', 'Poll complete', {
      statusCode:     res.status,
      durationMs,
      usersProcessed: body?.result?.usersProcessed ?? '?',
      totalSent:      body?.result?.totalSent      ?? '?',
      errorCount:     body?.result?.errorCount     ?? '?',
    })

    // Log at info level only when something was actually sent
    if (body?.result?.totalSent > 0) {
      log('info', 'Notifications sent in this cycle', {
        totalSent:      body.result.totalSent,
        usersProcessed: body.result.usersProcessed,
        durationMs,
      })
    }

    // Surface scheduler errors at warn level
    if (Array.isArray(body?.result?.errors) && body.result.errors.length > 0) {
      log('warn', 'Scheduler reported errors', {
        errors: body.result.errors.slice(0, 5),
      })
    }
  } catch (err) {
    const durationMs = Date.now() - t0
    consecutiveErrors++

    // Timeout or network error — app may be temporarily unavailable
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError'
    log(consecutiveErrors >= MAX_CONSECUTIVE_ERRORS ? 'warn' : 'debug',
      isTimeout ? 'Poll timed out' : 'Poll failed',
      {
        error:            err.message,
        consecutiveErrors,
        durationMs,
      }
    )
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  // Wait for the Next.js app to be ready before starting the poll loop
  await waitForApp()

  log('info', 'Starting poll loop', { pollIntervalMs: POLL_INTERVAL_MS })

  // Graceful shutdown
  let running = true
  process.once('SIGTERM', () => {
    log('info', 'SIGTERM received — stopping worker gracefully')
    running = false
  })
  process.once('SIGINT', () => {
    log('info', 'SIGINT received — stopping worker')
    running = false
    process.exit(0)
  })

  // Run first poll immediately
  await pollOnce()

  while (running) {
    await sleep(POLL_INTERVAL_MS)
    if (!running) break
    await pollOnce()
  }

  log('info', 'Worker stopped')
  process.exit(0)
}

main().catch((err) => {
  log('error', 'Worker crashed with unhandled error', { error: err.message, stack: err.stack })
  process.exit(1)
})
