import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/db'
import { signupSchema } from '@/lib/validations'
import User, { generatePublicId } from '@/models/User'
import { generateVerificationToken } from '@/lib/auth/crypto'
import { buildVerificationEmail } from '@/lib/auth/email-templates'
import { getNotificationService } from '@/lib/notifications'
import logger from '@/lib/logger'

const VERIFICATION_TOKEN_EXPIRY_MINUTES =
  parseInt(process.env.VERIFICATION_TOKEN_EXPIRY_MINUTES ?? '8', 10) || 8

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Validate input
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

    // Check for duplicate email
    const existing = await User.findOne({ email: normalizedEmail })
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }

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

    // Build verification URL from NEXT_PUBLIC_APP_URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const verificationUrl = `${appUrl}/verify-email?token=${verificationToken}`

    // Send verification email — fire-and-forget.
    // A failed delivery does NOT roll back the signup; the user can request a
    // resend from the check-email page.  SMTP diagnostics (host, port, etc.)
    // are already logged inside SmtpProvider.send(); we only add userId here
    // for correlation.  The verification URL (containing the raw token) is
    // never written to logs.
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
        // result.error is the sanitised string from SmtpProvider — no raw SMTP
        // errors, no passwords, no tokens reach this log line.
        logger.warn('[signup] Verification email delivery failed', {
          userId:        user._id.toString(),
          providerError: result.error,
        })
      }
    } catch (emailErr) {
      // Never fail the signup if email sending throws unexpectedly
      logger.error('[signup] Unexpected error from notification service', {
        userId:       user._id.toString(),
        errorMessage: emailErr instanceof Error ? emailErr.message : String(emailErr),
      })
    }

    // Return 201 — do NOT start a session; user must verify first
    return NextResponse.json(
      {
        message: 'Account created. Please check your email to verify your account.',
        // Only safe, non-sensitive fields returned to the client
        user: { name: user.name, email: user.email, publicId: user.publicId },
      },
      { status: 201 }
    )
  } catch (error) {
    logger.error('[signup]', { errorMessage: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
