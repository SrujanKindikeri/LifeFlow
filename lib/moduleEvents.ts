/**
 * lib/moduleEvents.ts — Server-side helper for recording ModuleEvent documents.
 *
 * USAGE IN API ROUTE HANDLERS
 * ───────────────────────────
 * import { recordModuleEvent } from '@/lib/moduleEvents'
 *
 * // On success:
 * await recordModuleEvent({
 *   userId,
 *   publicId,
 *   module:    'notes',
 *   operation: 'create',
 *   outcome:   'success',
 *   httpStatus: 201,
 *   source:    'api',
 *   durationMs,
 * })
 *
 * // On failure:
 * await recordModuleEvent({
 *   userId,
 *   publicId,
 *   module:        'tasks',
 *   operation:     'save_failed',
 *   outcome:       'failure',
 *   httpStatus:    500,
 *   errorCategory: 'database',
 *   errorMessage:  sanitize(err),
 *   source:        'api',
 * })
 *
 * GUARANTEES
 * ──────────
 * • Non-fatal: a recording failure never propagates to the caller.
 * • Deduplication: if correlationId is supplied, a second call with the same
 *   correlationId within the retention window is silently dropped (E11000).
 * • No private content is accepted: errorMessage is capped at 200 chars and
 *   the sanitizer strips common secret patterns.
 * • connectDB() is called before every write so callers don't need to ensure
 *   connection state.
 */

import { connectDB }        from '@/lib/db'
import logger               from '@/lib/logger'
import type { ModuleName, ModuleOperation, EventOutcome, ErrorCategory, EventSource }
  from '@/models/ModuleEvent'

// ── Public param type ─────────────────────────────────────────────────────────

export interface RecordModuleEventParams {
  /** MongoDB ObjectId string of the authenticated user */
  userId:    string
  /** LifeFlow public ID (LF-XXXXXXXX), from the verified session */
  publicId:  string
  module:    ModuleName
  operation: ModuleOperation
  outcome:   EventOutcome
  /** HTTP status returned by the route handler, when applicable */
  httpStatus?: number
  /** Stable category for error grouping */
  errorCategory?: ErrorCategory
  /**
   * Short, sanitized message. Must NOT contain raw stack traces, file paths,
   * secrets, user content (note text, task titles, amounts), or PII.
   * Will be truncated to 200 chars.
   */
  errorMessage?: string
  /**
   * Caller-supplied UUID for deduplication. When provided, a second call
   * with the same correlationId is silently discarded.
   */
  correlationId?: string
  source?: EventSource
  /** Wall-clock time from start of the operation to end, in ms */
  durationMs?: number
  /** Number of retries already attempted by the caller */
  retryCount?: number
}

// ── Secret / content scrubber ─────────────────────────────────────────────────

// Patterns that should never appear in a logged error message
const SCRUB_PATTERNS: RegExp[] = [
  /mongodb(\+srv)?:\/\/[^\s]+/gi,            // connection strings
  /password[=:\s]+\S+/gi,                    // password=xxx
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,       // bearer tokens
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+/g, // JWT fragments
  /\b[A-Z0-9]{20,}\b/g,                      // long uppercase keys (API keys)
  /LF-[A-Z0-9]{8}/g,                         // LifeFlow user IDs from content
]

function sanitizeErrorMessage(raw: string): string {
  let msg = raw.slice(0, 400) // generous pre-clip before regex work
  for (const pattern of SCRUB_PATTERNS) {
    msg = msg.replace(pattern, '[REDACTED]')
  }
  return msg.slice(0, 200).trim()
}

// ── Categorise common error patterns ─────────────────────────────────────────

export function categoriseError(err: unknown, httpStatus?: number): ErrorCategory {
  if (httpStatus !== undefined) {
    if (httpStatus === 400 || httpStatus === 422) return 'validation'
    if (httpStatus === 401)                        return 'unauthorized'
    if (httpStatus === 403)                        return 'forbidden'
    if (httpStatus === 404)                        return 'not_found'
    if (httpStatus === 409)                        return 'conflict'
    if (httpStatus === 429)                        return 'rate_limit'
    if (httpStatus === 504 || httpStatus === 408)  return 'timeout'
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (msg.includes('validation') || msg.includes('cast to') || msg.includes('required'))
    return 'validation'
  if (msg.includes('duplicate key') || msg.includes('e11000'))
    return 'conflict'
  if (msg.includes('timeout') || msg.includes('timed out'))
    return 'timeout'
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('enotfound'))
    return 'network'
  if (msg.includes('unauthorized') || msg.includes('unauthenticated'))
    return 'unauthorized'
  if (msg.includes('forbidden') || msg.includes('not allowed'))
    return 'forbidden'
  if (msg.includes('not found') || msg.includes('does not exist'))
    return 'not_found'
  if (msg.includes('mongo') || msg.includes('buffertimeout') || msg.includes('writeconcern'))
    return 'database'
  return 'unknown'
}

// ── Core writer ───────────────────────────────────────────────────────────────

export async function recordModuleEvent(params: RecordModuleEventParams): Promise<void> {
  // Import lazily so this module can be tree-shaken from the client bundle
  const [{ default: ModuleEvent }, mongoose] = await Promise.all([
    import('@/models/ModuleEvent'),
    import('mongoose'),
  ])

  try {
    // Skip env validation when mongoose is already connected (e.g. test environments)
    if (mongoose.default.connection.readyState !== 1) {
      await connectDB()
    }

    await ModuleEvent.create({
      userId:        new mongoose.default.Types.ObjectId(params.userId),
      publicId:      params.publicId,
      module:        params.module,
      operation:     params.operation,
      outcome:       params.outcome,
      httpStatus:    params.httpStatus,
      errorCategory: params.errorCategory,
      errorMessage:  params.errorMessage
        ? sanitizeErrorMessage(params.errorMessage)
        : undefined,
      correlationId: params.correlationId,
      source:        params.source ?? 'api',
      durationMs:    params.durationMs,
      retryCount:    params.retryCount,
    })
  } catch (err) {
    // E11000 duplicate correlationId — expected, silently discard
    const code = (err as NodeJS.ErrnoException).code
    if (code === '11000') return

    // Any other error must never propagate — analytics are non-fatal
    logger.warn('[moduleEvents] Failed to record module event', {
      module:    params.module,
      operation: params.operation,
      outcome:   params.outcome,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/**
 * Record a successful operation. Fire-and-forget: do not await unless you
 * specifically need confirmation. Errors are swallowed.
 */
export function trackSuccess(
  base: Pick<RecordModuleEventParams, 'userId' | 'publicId' | 'module' | 'operation'> &
    Partial<RecordModuleEventParams>,
): void {
  void recordModuleEvent({ source: 'api', ...base, outcome: 'success' })
}

/**
 * Record a failed operation, automatically categorising and sanitizing the error.
 * Fire-and-forget: do not await unless you need confirmation.
 */
export function trackFailure(
  base: Pick<RecordModuleEventParams, 'userId' | 'publicId' | 'module' | 'operation'> &
    Partial<RecordModuleEventParams>,
  err: unknown,
  httpStatus?: number,
): void {
  const errorCategory = base.errorCategory ?? categoriseError(err, httpStatus)
  const rawMessage    = err instanceof Error ? err.message : String(err)
  void recordModuleEvent({
    source: 'api',
    ...base,
    outcome:       'failure',
    httpStatus:    httpStatus ?? base.httpStatus,
    errorCategory,
    errorMessage:  sanitizeErrorMessage(rawMessage),
  })
}
