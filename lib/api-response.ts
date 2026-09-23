/**
 * lib/api-response.ts — Consistent API response helpers for LifeFlow.
 *
 * All API routes should use these helpers to ensure:
 *   - Uniform error envelope: { error: { code, message } }
 *   - No stack traces in production responses
 *   - Correct HTTP status codes
 *   - Type-safe success responses
 *
 * Usage:
 *   return apiError('UNAUTHORIZED', 'Please log in', 401)
 *   return apiSuccess({ user }, 201)
 *   return handleRouteError(err)
 */

import { NextResponse } from 'next/server'
import logger from '@/lib/logger'

// ─── Error codes ──────────────────────────────────────────────────────────────

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'BAD_REQUEST'
  | 'METHOD_NOT_ALLOWED'

// ─── Error envelope ───────────────────────────────────────────────────────────

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode
    message: string
  }
}

export interface ApiSuccessBody<T> {
  data?: T
  [key: string]: unknown
}

// ─── Response builders ────────────────────────────────────────────────────────

/**
 * Return a structured JSON error response.
 *
 * @example
 *   return apiError('VALIDATION_ERROR', 'Invalid amount', 400)
 *   // { "error": { "code": "VALIDATION_ERROR", "message": "Invalid amount" } }
 */
export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message } }, { status })
}

/**
 * Return a structured JSON success response.
 *
 * @example
 *   return apiSuccess({ user }, 201)
 */
export function apiSuccess<T extends Record<string, unknown>>(
  body: T,
  status = 200,
): NextResponse<T> {
  return NextResponse.json(body, { status })
}

// ─── Standard error shortcuts ─────────────────────────────────────────────────

export const unauthorized = (message = 'Authentication required') =>
  apiError('UNAUTHORIZED', message, 401)

export const forbidden = (message = 'Access denied') =>
  apiError('FORBIDDEN', message, 403)

export const notFound = (message = 'Resource not found') =>
  apiError('NOT_FOUND', message, 404)

export const badRequest = (message: string) =>
  apiError('BAD_REQUEST', message, 400)

export const validationError = (message: string) =>
  apiError('VALIDATION_ERROR', message, 400)

export const conflict = (message: string) =>
  apiError('CONFLICT', message, 409)

export const tooLarge = (message = 'Payload too large') =>
  apiError('PAYLOAD_TOO_LARGE', message, 413)

export const unsupportedMedia = (message = 'Unsupported media type') =>
  apiError('UNSUPPORTED_MEDIA_TYPE', message, 415)

export const internalError = (message = 'An unexpected error occurred') =>
  apiError('INTERNAL_ERROR', message, 500)

export const serviceUnavailable = (message = 'Service temporarily unavailable') =>
  apiError('SERVICE_UNAVAILABLE', message, 503)

// ─── Centralized error handler ────────────────────────────────────────────────

/**
 * Translate any thrown error into a consistent API response.
 *
 * Handles:
 *   - 'Unauthorized' — iron-session requireAuth() throws this
 *   - Generic Error   — logged server-side, safe message returned to client
 *
 * Stack traces are NEVER included in production responses.
 *
 * @param err   — the caught error
 * @param route — the route label for logging (e.g. '[expenses GET]')
 */
export function handleRouteError(
  err: unknown,
  route = '[API]',
): NextResponse<ApiErrorBody> {
  if (err instanceof Error) {
    if (err.message === 'Unauthorized') {
      return unauthorized()
    }

    if (err.message === 'SessionExpired') {
      return unauthorized('Your session expired due to inactivity. Please log in again.')
    }

    // Log the real error server-side (never expose to client)
    logger.error(`${route} Unhandled error`, {
      route,
      errorType: err.constructor?.name ?? 'Error',
      errorMessage: err.message,
      // Stack only in development
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    })
  } else {
    logger.error(`${route} Unknown error`, {
      route,
      error: String(err),
    })
  }

  return internalError()
}

// ─── Zod validation helper ────────────────────────────────────────────────────

import type { ZodError } from 'zod'

/**
 * Extract the first Zod error message and return a validation error response.
 */
export function zodError(err: ZodError): NextResponse<ApiErrorBody> {
  const firstMessage = err.issues[0]?.message ?? 'Validation failed'
  return validationError(firstMessage)
}
