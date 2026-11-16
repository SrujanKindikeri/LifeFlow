/**
 * POST /api/auth/signup
 *
 * User registration endpoint.
 *
 * GATE ORDER (fail fast — each check runs before any side effects)
 * ───────────────────────────────────────────────────────────────
 * 1. signup_enabled setting check  — reject early, no DB side effects
 * 2. Input validation (Zod)
 * 3. Duplicate email check
 * 4. max_users capacity check      — atomic increment + rollback on failure
 * 5. User.create() + verification email
 *
 * CONCURRENCY SAFETY (max_users)
 * ──────────────────────────────
 * We use an atomic MongoDB $inc on a singleton RegistrationCounter document
 * instead of countDocuments() → create() (which has a TOCTOU race).
 *
 * Flow:
 *   a) Atomically increment counter → get new value N
 *   b) If max_users > 0 and N > max_users → decrement (release slot) → 409
 *   c) If User.create() fails → decrement (release slot) → 500
 *   d) If User.create() succeeds → slot stays claimed → 201
 *
 * Two simultaneous requests at capacity N=max_users will increment to
 * N+1 and N+2 respectively.  Both exceed the limit, both decrement, neither
 * user is created.  The counter returns to max_users.
 *
 * FAILURE POLICY
 * ──────────────
 * If the RegistrationCounter is unavailable (DB outage) the route falls back
 * to a direct User.countDocuments() check — less concurrency-safe but
 * prevents a complete outage when max_users=0 (unlimited) would not need
 * enforcement anyway.
 *
 * If signup_enabled cannot be read (DB outage) the route returns 503 with a
 * clear message — it does NOT silently allow registration when the setting
 * state is unknown.  This is the documented fail-closed policy for signup_enabled.
 *
 * ATOMIC COUNTER vs TRANSACTIONS
 * ───────────────────────────────
 * MongoDB Atlas is a managed replica set and supports multi-document
 * transactions.  However, the $inc approach used here is:
 *   • Simpler — single-document atomicity is always guaranteed in MongoDB
 *   • Faster  — no multi-document transaction overhead
 *   • Compatible with any Atlas tier (including free M0)
 * A full transaction would be needed only if we needed to atomically update
 * both the User document and the counter in a single all-or-nothing operation.
 * The rollback-on-failure pattern achieves the same correctness guarantee.
 */

import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/db'
import { publicEnv } from '@/lib/env'
import { signupSchema } from '@/lib/validations'
import User, { generatePublicId } from '@/models/User'
import { generateVerificationToken } from '@/lib/auth/crypto'
import { buildVerificationEmail } from '@/lib/auth/email-templates'
import { getNotificationService } from '@/lib/notifications'
import {
  incrementCounter,
  decrementCounter,
} from '@/models/RegistrationCounter'
import logger from '@/lib/logger'
// Settings helpers — read-through cache, never throw on DB outage
import { isSignupEnabled, getMaxUsers } from '@/lib/settings'

const VERIFICATION_TOKEN_EXPIRY_MINUTES =
  parseInt(process.env.VERIFICATION_TOKEN_EXPIRY_MINUTES ?? '8', 10) || 8

export async function POST(req: NextRequest) {
  // ── 1. signup_enabled gate ──────────────────────────────────────────────────
  // Check before parsing the body so we never touch user input when disabled.
  // isSignupEnabled() uses the 30-second settings cache.  On DB outage it
  // returns the SAFE_DEFAULT of false (fail-closed) and we return 503.
  let signupAllowed: boolean
  try {
    signupAllowed = await isSignupEnabled()
  } catch {
    // isSignupEnabled() itself does not throw (it catches internally), but
    // guard defensively in case the module import itself fails.
    return NextResponse.json(
      {
        error: 'Registration is temporarily unavailable. Please try again shortly.',
      },
      { status: 503 }
    )
  }

  if (!signupAllowed) {
    return NextResponse.json(
      {
        error:
          'New account registration is currently disabled. ' +
          'Please check back later or contact support.',
      },
      { status: 403 }
    )
  }

  // ── 2. Input validation ─────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const parsed = signupSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    )
  }

  const { name, email, password } = parsed.data
  const normalizedEmail = email.toLowerCase()

  await connectDB()

  // ── 3. Duplicate email check ────────────────────────────────────────────────
  const existing = await User.findOne({ email: normalizedEmail })
  if (existing) {
    return NextResponse.json(
      { error: 'An account with this email already exists' },
      { status: 409 }
    )
  }

  // ── 4. max_users capacity check (atomic) ────────────────────────────────────
  const maxUsers = await getMaxUsers()

  let slotReserved = false   // tracks whether we incremented the counter

  if (maxUsers > 0) {
    // Atomically claim a slot
    let newCount: number
    try {
      newCount      = await incrementCounter()
      slotReserved  = true
    } catch (counterErr) {
      // Counter unavailable — fall back to a non-atomic count check.
      // This is less safe for concurrent signups but prevents a complete
      // outage when the counter collection is temporarily unavailable.
      logger.warn('[signup] RegistrationCounter unavailable, falling back to countDocuments', {
        errorMessage: counterErr instanceof Error ? counterErr.message : String(counterErr),
      })

      const fallbackCount = await User.countDocuments({
        $or: [
          { accountStatus: 'active' },
          { accountStatus: { $exists: false } },
        ],
      })
      if (fallbackCount >= maxUsers) {
        return NextResponse.json(
          {
            error:
              'Registration is currently full. ' +
              'No more accounts can be created at this time.',
          },
          { status: 409 }
        )
      }
      // Proceed without a reserved slot — acceptable fallback
      newCount = fallbackCount + 1
    }

    if (newCount > maxUsers) {
      // Limit exceeded — release the slot we just reserved
      if (slotReserved) await decrementCounter()

      return NextResponse.json(
        {
          error:
            'Registration is currently full. ' +
            'No more accounts can be created at this time.',
        },
        { status: 409 }
      )
    }
  }

  // ── 5. Create the user ──────────────────────────────────────────────────────
  try {
    // Hash password
    const passwordHash = await bcrypt.hash(password, 12)

    // Generate a unique publicId — retry on the rare collision
    let publicId = generatePublicId()
    let attempts = 0
    while (attempts < 5) {
      const collision = await User.findOne({ publicId })
      if (!collision) break
      publicId = generatePublicId()
      attempts++
    }

    // Generate email verification token (raw token → URL, hash → DB)
    const { token: verificationToken, tokenHash } = generateVerificationToken()
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MINUTES * 60 * 1000)

    // Create user — NOT verified yet, no session started
    const user = await User.create({
      name,
      email: normalizedEmail,
      passwordHash,
      publicId,
      emailVerified: false,
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: expiresAt,
    })

    // Build verification URL — always reads NEXT_PUBLIC_APP_URL from env
    const verificationUrl = `${publicEnv.APP_URL}/verify-email?token=${verificationToken}`

    // Send verification email — fire-and-forget.
    // A failed delivery does NOT roll back the signup; the user can request a
    // resend from the check-email page.
    try {
      const notifier = await getNotificationService()
      const { subject, html, text } = buildVerificationEmail({
        toName: user.name,
        verificationUrl,
        expiresInMinutes: VERIFICATION_TOKEN_EXPIRY_MINUTES,
      })
      const result = await notifier.send({
        to: user.email,
        subject,
        html,
        text,
      })
      if (result.ok) {
        logger.info('[signup] Verification email accepted by provider', {
          userId: user._id.toString(),
        })
      } else {
        logger.warn('[signup] Verification email delivery failed', {
          userId:        user._id.toString(),
          providerError: result.error,
        })
      }
    } catch (emailErr) {
      logger.error('[signup] Unexpected error from notification service', {
        userId:       user._id.toString(),
        errorMessage: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }

    // Return 201 — do NOT start a session; user must verify first
    return NextResponse.json(
      {
        message: 'Account created. Please check your email to verify your account.',
        user: { name: user.name, email: user.email, publicId: user.publicId },
      },
      { status: 201 }
    )
  } catch (createErr) {
    // User.create() failed — release the reserved slot so the limit is not
    // incorrectly decremented permanently.
    if (slotReserved) {
      await decrementCounter()
    }

    logger.error('[signup] User creation failed', {
      errorMessage: createErr instanceof Error ? createErr.message : String(createErr),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
