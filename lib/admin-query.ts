/**
 * lib/admin-query.ts — Shared helpers for admin API route query parsing.
 *
 * Centralizes pagination, date-range, and filter validation so every admin
 * endpoint applies the same bounds and NoSQL-injection guards consistently.
 *
 * Security
 * ────────
 * All inputs from query strings are parsed with parseInt / whitelist
 * matching / regex escaping — never passed directly to Mongoose.  This
 * prevents NoSQL injection (e.g. { $gt: '' } in a query param) and
 * ensures bounded, predictable results.
 */

import type { NextRequest } from 'next/server'

// ── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationParams {
  page:  number
  limit: number
  skip:  number
}

export function parsePagination(req: NextRequest): PaginationParams {
  const page  = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10))
  const limit = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') ?? '25', 10)))
  return { page, limit, skip: (page - 1) * limit }
}

// ── Date range ────────────────────────────────────────────────────────────────

export interface DateRange {
  since: Date
  until: Date
}

const ALLOWED_LOOKBACK_DAYS = new Set([1, 7, 14, 30, 90, 180])

/**
 * Parse a `days` query param into a date range, bounded to allowed values.
 * Default: 30 days.  The `until` is always `now`.
 */
export function parseDateRange(req: NextRequest): DateRange {
  const rawDays = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10)
  const days = ALLOWED_LOOKBACK_DAYS.has(rawDays) ? rawDays : 30
  const now = new Date()
  return {
    since: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    until: now,
  }
}

// ── Text search (regex-escaped) ───────────────────────────────────────────────

/**
 * Escape a search string for safe use in a MongoDB $regex.
 * Prevents regex injection (e.g. ".*" matching everything) by escaping
 * all special regex characters.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Build a safe case-insensitive regex filter for a text search field.
 * Returns an empty object if the search string is empty.
 */
export function buildSearchFilter(
  field: string,
  search: string | undefined,
): Record<string, unknown> {
  const trimmed = search?.trim()
  if (!trimmed) return {}
  return { [field]: { $regex: escapeRegex(trimmed), $options: 'i' } }
}

// ── Whitelist validation ──────────────────────────────────────────────────────

/**
 * Validate a query param against a whitelist of allowed values.
 * Returns the value if allowed, otherwise undefined.
 */
export function whitelisted<T extends string>(
  req: NextRequest,
  param: string,
  allowed: readonly T[],
): T | undefined {
  const raw = req.nextUrl.searchParams.get(param)
  if (!raw) return undefined
  return allowed.includes(raw as T) ? (raw as T) : undefined
}

// ── Standard response helpers ─────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items:    T[]
  total:    number
  page:     number
  limit:    number
  hasMore:  boolean
}

export function buildPaginatedResponse<T>(
  items: T[],
  total: number,
  pagination: PaginationParams,
): PaginatedResponse<T> {
  return {
    items,
    total,
    page:     pagination.page,
    limit:     pagination.limit,
    hasMore:   pagination.skip + items.length < total,
  }
}
