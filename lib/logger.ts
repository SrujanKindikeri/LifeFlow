/**
 * lib/logger.ts — Structured server-side logger for LifeFlow.
 *
 * Outputs JSON lines in production (easy to ingest by AWS CloudWatch,
 * Azure Monitor, Datadog, etc.) and human-readable colored lines in
 * development.
 *
 * SECURITY RULES — these fields are NEVER logged:
 *   - Passwords / password hashes
 *   - SESSION_SECRET, AUTH_SECRET
 *   - MONGODB_URI (contains credentials)
 *   - API keys (GOOGLE_VISION_API_KEY, OCR_API_KEY, EMAIL_API_KEY, etc.)
 *   - UPI IDs, bank account numbers
 *   - Transaction screenshot content / raw OCR text
 *   - Full user PII (partial is ok, e.g. userId)
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  /** ISO 8601 timestamp */
  timestamp: string
  /** Caller-supplied context (route, requestId, userId, etc.) */
  [key: string]: unknown
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === 'production'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
}

// Minimum level to emit. In production default to 'info'; override with
// LOG_LEVEL env var (useful for temporary debug logging in staging).
const MIN_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel | undefined) ??
  (isProd ? 'info' : 'debug')

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL]
}

/** Dev-mode color codes */
const DEV_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info:  '\x1b[32m', // green
  warn:  '\x1b[33m', // yellow
  error: '\x1b[31m', // red
}
const RESET = '\x1b[0m'

function emit(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return

  if (isProd) {
    // JSON lines — machine-readable, ingested by log aggregators
    process.stdout.write(JSON.stringify(entry) + '\n')
  } else {
    // Human-readable for local dev
    const color = DEV_COLORS[entry.level]
    const { level, message, timestamp, ...rest } = entry
    const suffix = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : ''
    process.stdout.write(
      `${color}[${level.toUpperCase()}]${RESET} ${timestamp.slice(11, 23)} ${message}${suffix}\n`
    )
  }
}

function buildEntry(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): LogEntry {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...sanitizeMeta(meta),
  }
}

// ─── Secret scrubbing ─────────────────────────────────────────────────────────

/** Field names that should NEVER appear in log output */
const BLOCKED_FIELDS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'sessionSecret',
  'session_secret',
  'SESSION_SECRET',
  'AUTH_SECRET',
  'MONGODB_URI',
  'mongodbUri',
  'apiKey',
  'api_key',
  'API_KEY',
  'GOOGLE_VISION_API_KEY',
  'OCR_API_KEY',
  'EMAIL_API_KEY',
  'SCHEDULER_SECRET',
  'CRON_SECRET',
  'accessKey',
  'access_key',
  'secretKey',
  'secret_key',
  'bearerToken',
  'bearer_token',
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'upiId',
  'upi_id',
  'accountNumber',
  'account_number',
  'cardNumber',
  'card_number',
  'cvv',
  'pin',
  'ocrText',
  'rawText',
  'data', // TransactionProof.data — base64 image
])

function sanitizeMeta(
  meta?: Record<string, unknown>,
): Record<string, unknown> {
  if (!meta) return {}
  const safe: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(meta)) {
    if (BLOCKED_FIELDS.has(key)) {
      safe[key] = '[REDACTED]'
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      safe[key] = sanitizeMeta(val as Record<string, unknown>)
    } else {
      safe[key] = val
    }
  }
  return safe
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    emit(buildEntry('debug', message, meta))
  },

  info(message: string, meta?: Record<string, unknown>): void {
    emit(buildEntry('info', message, meta))
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    emit(buildEntry('warn', message, meta))
  },

  error(message: string, meta?: Record<string, unknown>): void {
    emit(buildEntry('error', message, meta))
  },

  /**
   * Log an HTTP request completion.
   * Suitable for API route handlers.
   */
  request(
    method: string,
    route: string,
    status: number,
    durationMs: number,
    meta?: Record<string, unknown>,
  ): void {
    const level: LogLevel =
      status >= 500 ? 'error' :
      status >= 400 ? 'warn'  :
      'info'

    emit(buildEntry(level, `${method} ${route} ${status}`, {
      method,
      route,
      status,
      durationMs,
      ...meta,
    }))
  },
} as const

export default logger
