import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/db'
import { getSession } from '@/lib/session'
import { loginSchema } from '@/lib/validations'
import User from '@/models/User'
import { checkLoginLimit, getClientIp } from '@/lib/auth/rate-limit'
import logger from '@/lib/logger'

// Max age for the 2FA pending window (5 minutes)
const TWO_FA_PENDING_TTL_MS = 5 * 60 * 1000

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  try {
    const body = await req.json()

    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { email, password } = parsed.data
    const normalizedEmail = email.toLowerCase()

    // ── Rate limiting ────────────────────────────────────────────────────────
    const rateResult = checkLoginLimit(ip, normalizedEmail)
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429 }
      )
    }

    await connectDB()

    const user = await User.findOne({ email: normalizedEmail })
    if (!user) {
      return NextResponse.json(
        { error: 'No account found with that email.', code: 'ACCOUNT_NOT_FOUND' },
        { status: 404 }
      )
    }

    // ── Password verification ────────────────────────────────────────────────
    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // ── Soft-deleted account gate ────────────────────────────────────────────
    // IMPORTANT: We check this AFTER password verification so we do NOT leak
    // whether a given email has a deleted account to unauthenticated callers.
    // An attacker who doesn't know the password gets a generic 401 and never
    // reaches this branch.  Only the real account owner (who knows the correct
    // password) sees the recovery screen.
    if ((user.accountStatus ?? 'active') === 'deleted') {
      const now = new Date()
      const scheduledDeletion = user.scheduledPermanentDeletionAt

      // If somehow the cleanup job hasn't run yet and we're past the window,
      // treat the account as gone (avoids showing a "restore" option that would
      // immediately fail on the restore endpoint).
      if (!scheduledDeletion || now >= scheduledDeletion) {
        return NextResponse.json(
          { error: 'No account found with that email.', code: 'ACCOUNT_NOT_FOUND' },
          { status: 404 }
        )
      }

      logger.info('[login] Deleted account login attempt — showing recovery screen', {
        userId: user._id.toString(),
      })

      return NextResponse.json(
        {
          code: 'ACCOUNT_DELETED',
          deletedAt:                    user.deletedAt?.toISOString() ?? null,
          scheduledPermanentDeletionAt: scheduledDeletion.toISOString(),
        },
        { status: 403 }
      )
    }

    // ── Email verification gate ──────────────────────────────────────────────
    // Existing users created before this feature was added will have
    // emailVerified=false (the Mongoose default). We treat any user whose
    // emailVerified field is explicitly false as unverified.
    // Users whose field is undefined/null (legacy) are treated as verified
    // to preserve access for accounts created before this feature shipped.
    if (user.emailVerified === false) {
      return NextResponse.json(
        {
          error: 'Please verify your email before logging in.',
          code: 'EMAIL_NOT_VERIFIED',
        },
        { status: 403 }
      )
    }

    // ── 2FA challenge ────────────────────────────────────────────────────────
    if (user.twoFactorEnabled) {
      // Issue a short-lived pending session instead of a full session.
      // The client must complete the TOTP step at /api/auth/verify-2fa.
      const session = await getSession()

      // Clear any previous pending state and never carry over a real session
      session.isLoggedIn         = false
      session.userId             = ''
      session.name               = ''
      session.email              = ''
      session.twoFactorPending   = true
      session.pendingUserId      = user._id.toString()
      session.twoFactorPendingAt = Date.now()
      await session.save()

      logger.info('[login] 2FA challenge issued', { userId: user._id.toString() })

      return NextResponse.json(
        {
          twoFactorRequired: true,
          message: 'Please enter your authenticator code.',
        },
        { status: 200 }
      )
    }

    // ── Full login (no 2FA) ──────────────────────────────────────────────────
    const session = await getSession()
    session.userId             = user._id.toString()
    session.name               = user.name
    session.email              = user.email
    session.isLoggedIn         = true
    session.emailVerified      = true   // only verified users reach this point
    session.twoFactorPending   = false
    session.pendingUserId      = undefined
    session.twoFactorPendingAt = undefined
    await session.save()

    logger.info('[login] Successful login', { userId: user._id.toString() })

    return NextResponse.json({
      message: 'Logged in successfully',
      user: { name: user.name, email: user.email },
    })
  } catch (error) {
    logger.error('[login]', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}

// Export TTL so verify-2fa route can reuse the same constant
export { TWO_FA_PENDING_TTL_MS }
