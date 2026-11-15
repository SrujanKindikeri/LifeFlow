/**
 * lib/admin-auth.ts — Server-side authentication guard for the admin control panel.
 *
 * DESIGN PRINCIPLES
 * ─────────────────
 * 1. Every /admin/* page and /api/admin/* route handler calls requireAdmin()
 *    or requireRole() — never only the proxy.  Defense in depth.
 * 2. The admin session cookie is SEPARATE from the user session cookie, so
 *    a regular user session can never elevate to admin.
 * 3. adminId is resolved from the database on every request — never trusted
 *    from cookie-cached values alone.  The DB lookup is cheap (single indexed find).
 * 4. AuditLog writes happen server-side only — never from client code.
 *
 * USAGE
 * ─────
 * In a page.tsx (Server Component):
 *   const admin = await requireAdmin({ skipActivityUpdate: true })
 *
 * In a route.ts (Route Handler):
 *   const admin = await requireAdmin()
 *
 * For super_admin only:
 *   const admin = await requireRole('super_admin')
 *
 * For support or above:
 *   const admin = await requireRole(['support', 'admin', 'super_admin'])
 */

import { getIronSession, IronSession, SessionOptions } from 'iron-session'
import { cookies }                                     from 'next/headers'
import { connectDB }                                   from '@/lib/db'
import logger                                          from '@/lib/logger'
import type { AdminRole }                              from '@/models/AdminUser'
import type { AuditAction, AuditResult }               from '@/models/AuditLog'

// ── Admin session shape ───────────────────────────────────────────────────────

export interface AdminSessionData {
  adminId:     string
  adminName:   string
  adminEmail:  string
  adminRole:   AdminRole
  isAdminLoggedIn: boolean
  loginAt:     number   // ms timestamp — absolute expiry
  lastActiveAt: number  // ms timestamp — idle expiry
}

// Resolved admin identity returned by requireAdmin()
export interface AdminUser {
  adminId:    string
  name:       string
  email:      string
  role:       AdminRole
}

// ── Session options ───────────────────────────────────────────────────────────

const ADMIN_COOKIE_NAME       = 'lifeflow_admin_session'
const ADMIN_ABSOLUTE_HOURS    = 8    // 8-hour hard deadline for admin sessions
const ADMIN_IDLE_MINUTES      = 30   // 30-minute inactivity timeout

export function getAdminSessionOptions(): SessionOptions {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET
  if (!secret || secret.trim().length < 32) {
    throw new Error('[Admin] ADMIN_SESSION_SECRET (or SESSION_SECRET) must be at least 32 characters.')
  }
  return {
    password:    secret,
    cookieName:  ADMIN_COOKIE_NAME,
    cookieOptions: {
      secure:
        process.env.NODE_ENV === 'production' &&
        (process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://') ?? false),
      httpOnly:  true,
      sameSite:  'lax',
      maxAge:    ADMIN_ABSOLUTE_HOURS * 60 * 60,
    },
  }
}

export async function getAdminSession(): Promise<IronSession<AdminSessionData>> {
  const cookieStore = await cookies()
  return getIronSession<AdminSessionData>(cookieStore, getAdminSessionOptions())
}

// ── Activity throttle ─────────────────────────────────────────────────────────

const ACTIVITY_THRESHOLD_MS = 2 * 60 * 1000  // 2 minutes

async function refreshAdminActivity(session: IronSession<AdminSessionData>): Promise<void> {
  const now = Date.now()
  if (!session.lastActiveAt || now - session.lastActiveAt >= ACTIVITY_THRESHOLD_MS) {
    session.lastActiveAt = now
    await session.save()
  }
}

// ── Main auth guard ───────────────────────────────────────────────────────────

/**
 * Verify an active admin session and return the authenticated admin.
 *
 * Throws:
 *   Error('AdminUnauthorized')  — no valid session
 *   Error('AdminSessionExpired') — session timed out (idle or absolute)
 *   Error('AdminNotFound')       — session valid but admin account deleted/deactivated
 *   Error('AdminForbidden')      — role insufficient for the requested action
 *
 * @param options.skipActivityUpdate  Pass true for Server Component page renders.
 * @param options.requiredRole        If set, throws AdminForbidden when the role
 *                                   doesn't match.
 */
export async function requireAdmin(options?: {
  skipActivityUpdate?: boolean
  requiredRole?: AdminRole | AdminRole[]
}): Promise<AdminUser> {
  const session = await getAdminSession()

  if (!session.isAdminLoggedIn || !session.adminId) {
    throw new Error('AdminUnauthorized')
  }

  const now = Date.now()

  // Idle timeout (30 minutes)
  if (session.lastActiveAt) {
    const idleMs = now - session.lastActiveAt
    if (idleMs > ADMIN_IDLE_MINUTES * 60 * 1000) {
      logger.info('[admin-auth] session expired — idle timeout', {
        adminId: session.adminId,
        idleMinutes: Math.round(idleMs / 60_000),
      })
      throw new Error('AdminSessionExpired')
    }
  }

  // Absolute timeout (8 hours)
  if (session.loginAt) {
    const ageMs = now - session.loginAt
    if (ageMs > ADMIN_ABSOLUTE_HOURS * 60 * 60 * 1000) {
      logger.info('[admin-auth] session expired — absolute timeout', {
        adminId: session.adminId,
        ageHours: (ageMs / 3_600_000).toFixed(2),
      })
      throw new Error('AdminSessionExpired')
    }
  }

  // DB lookup — verify account still exists and is active
  const { default: AdminUserModel } = await import('@/models/AdminUser')
  await connectDB()

  const admin = await AdminUserModel.findById(session.adminId)
    .select('name email role isActive')
    .lean<{ name: string; email: string; role: AdminRole; isActive: boolean } | null>()

  if (!admin) {
    throw new Error('AdminNotFound')
  }

  if (!admin.isActive) {
    throw new Error('AdminNotFound')   // treat deactivated same as not found
  }

  // Role check
  if (options?.requiredRole) {
    const allowed = Array.isArray(options.requiredRole)
      ? options.requiredRole
      : [options.requiredRole]
    if (!allowed.includes(admin.role)) {
      throw new Error('AdminForbidden')
    }
  }

  // Activity update (Route Handlers only — not during RSC renders)
  if (!options?.skipActivityUpdate) {
    await refreshAdminActivity(session)
  }

  return {
    adminId: session.adminId,
    name:    admin.name,
    email:   admin.email,
    role:    admin.role,
  }
}

// ── Role hierarchy helpers ────────────────────────────────────────────────────

const ROLE_LEVEL: Record<AdminRole, number> = {
  auditor:     1,
  support:     2,
  admin:       3,
  super_admin: 4,
}

/**
 * Returns true if `role` meets or exceeds `minimum`.
 * super_admin > admin > support > auditor
 */
export function hasRole(role: AdminRole, minimum: AdminRole): boolean {
  return ROLE_LEVEL[role] >= ROLE_LEVEL[minimum]
}

/**
 * Require at least the given minimum role level.
 * Throws Error('AdminForbidden') if the admin's role is insufficient.
 */
export async function requireRole(minimum: AdminRole, options?: { skipActivityUpdate?: boolean }): Promise<AdminUser> {
  const admin = await requireAdmin({ ...options })
  if (!hasRole(admin.role, minimum)) {
    throw new Error('AdminForbidden')
  }
  return admin
}

// ── Audit log writer ─────────────────────────────────────────────────────────

/**
 * Write an audit log entry.  Server-side only — never called from client code.
 * Non-fatal: errors are logged but never propagate to the caller.
 */
export async function writeAuditLog(params: {
  actor:    AdminUser
  action:   AuditAction
  result:   AuditResult
  target?:  { type: string; id: string }
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    const { default: AuditLog } = await import('@/models/AuditLog')
    await connectDB()
    await AuditLog.create({
      actorId:   params.actor.adminId,
      actorName: params.actor.name,
      actorRole: params.actor.role,
      action:    params.action,
      result:    params.result,
      target:    params.target ?? null,
      metadata:  params.metadata ?? {},
    })
  } catch (err) {
    // Audit log failure is non-fatal — never block the primary operation
    logger.error('[admin-auth] Failed to write audit log', {
      action: params.action,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
}

// ── Standard admin error handler ─────────────────────────────────────────────

import { NextResponse } from 'next/server'
import { redirect }     from 'next/navigation'

/**
 * Convert admin auth errors to appropriate HTTP responses (for Route Handlers).
 */
export function handleAdminAuthError(err: unknown): NextResponse {
  const msg = err instanceof Error ? err.message : ''
  if (msg === 'AdminUnauthorized' || msg === 'AdminNotFound' || msg === 'AdminSessionExpired') {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Admin authentication required.' } },
      { status: 401 }
    )
  }
  if (msg === 'AdminForbidden') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } },
      { status: 403 }
    )
  }
  logger.error('[admin] Unhandled error', {
    errorMessage: err instanceof Error ? err.message : String(err),
  })
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
    { status: 500 }
  )
}

/**
 * Redirect admin page errors to /admin/login (for Server Components / pages).
 * Call inside a try/catch around requireAdmin() in page.tsx files.
 */
export function handleAdminPageAuthError(err: unknown): never {
  const msg = err instanceof Error ? err.message : ''
  if (
    msg === 'AdminUnauthorized' ||
    msg === 'AdminNotFound' ||
    msg === 'AdminSessionExpired'
  ) {
    redirect('/admin/login')
  }
  if (msg === 'AdminForbidden') {
    redirect('/admin/dashboard')
  }
  // Infrastructure error — re-throw so error.tsx handles it
  throw err
}
