/**
 * POST /api/admin/auth/login
 *
 * Authenticates an administrator against the AdminUser collection.
 * Issues a separate 'lifeflow_admin_session' iron-session cookie on success.
 *
 * SECURITY
 * ────────
 * • Admin credentials NEVER touch the regular user login path.
 * • Brute-force protection via in-memory rate limiter (5 attempts / 15 min per IP).
 * • Password compared with bcrypt — timing-safe.
 * • Session cookie is httpOnly, SameSite=lax, Secure in production.
 * • Audit log written on success and failure.
 * • Never reveals whether an email exists (always generic error message).
 */

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/db'
import { getAdminSession, writeAuditLog } from '@/lib/admin-auth'
import AdminUser from '@/models/AdminUser'
import logger from '@/lib/logger'

export const dynamic = 'force-dynamic'

// ── Simple in-memory rate limiter ─────────────────────────────────────────────
// Max 5 login attempts per IP per 15 minutes.
const attempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 5
const WINDOW_MS    = 15 * 60 * 1000

function checkRateLimit(ip: string): boolean {
  const now  = Date.now()
  const entry = attempts.get(ip)

  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_ATTEMPTS) return false
  entry.count++
  return true
}

function resetRateLimit(ip: string): void {
  attempts.delete(ip)
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ip = getClientIp(req)

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again in 15 minutes.' } },
      { status: 429 }
    )
  }

  let email = '', password = ''
  try {
    const body = await req.json()
    email    = (body.email    ?? '').toLowerCase().trim()
    password = (body.password ?? '')
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid request body.' } },
      { status: 400 }
    )
  }

  if (!email || !password) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Email and password are required.' } },
      { status: 400 }
    )
  }

  try {
    await connectDB()

    // Always fetch + compare — avoids timing oracle on unknown email
    const admin = await AdminUser.findOne({ email }).select('+passwordHash').lean<{
      _id: unknown; name: string; email: string; passwordHash: string; role: string; isActive: boolean
    } | null>()

    const hashToCompare = admin?.passwordHash ?? '$2b$12$invalidhashfortimingnormalization000000000000000000'
    const isValid = await bcrypt.compare(password, hashToCompare)

    if (!admin || !isValid || !admin.isActive) {
      logger.warn('[admin/login] Failed login attempt', { email, ip, reason: !admin ? 'not_found' : !isValid ? 'bad_password' : 'inactive' })

      // Still write audit log for known accounts
      if (admin) {
        const fakeActor = { adminId: String(admin._id), name: admin.name, email: admin.email, role: admin.role as never }
        await writeAuditLog({ actor: fakeActor, action: 'admin_login_failed', result: 'failure', metadata: { ip } })
      }

      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Invalid email or password.' } },
        { status: 401 }
      )
    }

    // ── Issue admin session ────────────────────────────────────────────────
    const session = await getAdminSession()
    session.adminId          = String(admin._id)
    session.adminName        = admin.name
    session.adminEmail       = admin.email
    session.adminRole        = admin.role as never
    session.isAdminLoggedIn  = true
    session.loginAt          = Date.now()
    session.lastActiveAt     = Date.now()
    await session.save()

    // Update lastLoginAt — fire and forget, non-fatal
    void AdminUser.findByIdAndUpdate(admin._id, { lastLoginAt: new Date() }).exec()

    resetRateLimit(ip)

    const actor = { adminId: String(admin._id), name: admin.name, email: admin.email, role: admin.role as never }
    await writeAuditLog({ actor, action: 'admin_login', result: 'success', metadata: { ip } })

    logger.info('[admin/login] Successful login', { adminId: String(admin._id), role: admin.role })

    return NextResponse.json({
      ok: true,
      admin: {
        adminId: String(admin._id),
        name:    admin.name,
        email:   admin.email,
        role:    admin.role,
      },
    })
  } catch (err) {
    logger.error('[admin/login] Error', { errorMessage: err instanceof Error ? err.message : String(err) })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
      { status: 500 }
    )
  }
}
