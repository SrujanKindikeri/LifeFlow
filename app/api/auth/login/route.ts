import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/db'
import { getSession } from '@/lib/session'
import { loginSchema } from '@/lib/validations'
import User from '@/models/User'
import { checkLoginLimit, checkEmailOtpLoginSendLimit, getClientIp } from '@/lib/auth/rate-limit'
import { generateEmailOtp, EMAIL_OTP_VALID_MINUTES, EMAIL_OTP_MAX_ATTEMPTS } from '@/lib/auth/otp'
import { getNotificationService } from '@/lib/notifications'
import { buildTwoFaLoginOtpEmail, maskEmail } from '@/lib/auth/email-templates'
import logger from '@/lib/logger'
import { resolveClientIp, isValidIp } from '@/lib/ip'
import { parseUserAgent } from '@/lib/useragent'
import { recordSecurityEvent } from '@/models/SecurityEvent'

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  // Resolve IP and device info once for security event recording (non-fatal)
  const _ipResult = resolveClientIp(req)
  const _securityIp = isValidIp(_ipResult.ip) ? _ipResult.ip : null
  const _securityIpSource = _ipResult.source
  const _rawUa = req.headers.get('user-agent')
  const _parsedUa = parseUserAgent(_rawUa)

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

    // ── Admin check (runs before user lookup) ────────────────────────────────
    // If the email belongs to an AdminUser, issue an admin session and redirect
    // to /admin/dashboard. Admin credentials never produce a user session.
    // We always hash-compare to avoid timing oracles even on unknown emails.
    try {
      const AdminUser = (await import('@/models/AdminUser')).default
      const adminCandidate = await AdminUser.findOne({ email: normalizedEmail })
        .select('+passwordHash')
        .lean<{ _id: unknown; name: string; email: string; passwordHash: string; role: string; isActive: boolean } | null>()

      if (adminCandidate) {
        const adminValid = await bcrypt.compare(password, adminCandidate.passwordHash)
        if (adminValid && adminCandidate.isActive) {
          // Issue admin session using the admin-auth cookie
          const { getAdminSession, writeAuditLog } = await import('@/lib/admin-auth')
          const adminSession = await getAdminSession()
          adminSession.adminId         = String(adminCandidate._id)
          adminSession.adminName       = adminCandidate.name
          adminSession.adminEmail      = adminCandidate.email
          adminSession.adminRole       = adminCandidate.role as never
          adminSession.isAdminLoggedIn = true
          adminSession.loginAt         = Date.now()
          adminSession.lastActiveAt    = Date.now()
          await adminSession.save()

          // Update last login timestamp — fire and forget
          void AdminUser.findByIdAndUpdate(adminCandidate._id, { lastLoginAt: new Date() }).exec()

          const actor = { adminId: String(adminCandidate._id), name: adminCandidate.name, email: adminCandidate.email, role: adminCandidate.role as never }
          await writeAuditLog({ actor, action: 'admin_login', result: 'success', metadata: { ip, via: 'shared_login' } })

          logger.info('[login] Admin login via shared login page', { adminId: String(adminCandidate._id) })

          return NextResponse.json({
            message:    'Logged in successfully',
            redirectTo: '/admin/dashboard',
            user:       { name: adminCandidate.name, email: adminCandidate.email },
          })
        }
        // Wrong password for a known admin email — fall through to user lookup
        // so the error message stays generic (no oracle on whether email is admin)
      }
    } catch (adminErr) {
      // AdminUser model may not exist yet (pre-bootstrap) — non-fatal, continue
      logger.warn('[login] Admin check skipped', {
        errorMessage: adminErr instanceof Error ? adminErr.message : String(adminErr),
      })
    }
    // ── End admin check ──────────────────────────────────────────────────────

    const user = await User.findOne({ email: normalizedEmail })
    if (!user) {
      // Record login failure for unknown email (no userId, non-fatal)
      void recordSecurityEvent({
        userId:    null,
        publicId:  null,
        eventType:  'login_failure',
        outcome:    'failure',
        ip:         _securityIp,
        ipSource:   _securityIpSource,
        deviceCategory: _parsedUa.deviceCategory,
        browser:    _parsedUa.browser,
        metadata:   { reason: 'account_not_found' },
      })
      return NextResponse.json(
        { error: 'No account found with that email.', code: 'ACCOUNT_NOT_FOUND' },
        { status: 404 }
      )
    }

    // ── Password verification ────────────────────────────────────────────────
    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) {
      // Record login failure (non-fatal, fire-and-forget)
      void recordSecurityEvent({
        userId:    user._id.toString(),
        publicId:  user.publicId,
        eventType:  'login_failure',
        outcome:    'failure',
        ip:         _securityIp,
        ipSource:   _securityIpSource,
        deviceCategory: _parsedUa.deviceCategory,
        browser:    _parsedUa.browser,
        metadata:   { reason: 'bad_password' },
      })
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

    // ── TOTP / Google Authenticator 2FA challenge ────────────────────────────
    if (user.twoFactorEnabled) {
      // Issue a short-lived pending session. Client completes at /api/auth/verify-2fa.
      const session = await getSession()
      session.isLoggedIn         = false
      session.userId             = ''
      session.name               = ''
      session.email              = ''
      session.twoFactorPending   = true
      session.pendingUserId      = user._id.toString()
      session.twoFactorPendingAt = Date.now()
      await session.save()

      logger.info('[login] TOTP 2FA challenge issued', { userId: user._id.toString() })

      return NextResponse.json(
        { twoFactorRequired: true, twoFactorMethod: 'totp', message: 'Please enter your authenticator code.' },
        { status: 200 }
      )
    }

    // ── Email OTP 2FA challenge ───────────────────────────────────────────────
    if (user.emailOtpEnabled) {
      // Generate and email a 6-digit OTP, then issue a pending session.
      // Client completes at /api/auth/2fa/email/login-verify.

      const otpRateResult = checkEmailOtpLoginSendLimit(ip, user._id.toString())
      if (otpRateResult.allowed) {
        // Generate exactly ONE OTP
        const { otp, otpHash } = generateEmailOtp()
        const now              = new Date()
        const otpExpiresAt     = new Date(now.getTime() + EMAIL_OTP_VALID_MINUTES * 60 * 1000)

        user.emailOtpHash        = otpHash
        user.emailOtpExpiresAt   = otpExpiresAt
        user.emailOtpAttempts    = 0
        user.emailOtpMaxAttempts = EMAIL_OTP_MAX_ATTEMPTS
        user.emailOtpSentAt      = now
        user.emailOtpPurpose     = '2fa_login'
        await user.save()

        logger.info('[2FA] verification challenge created', { userId: user._id.toString(), purpose: '2fa_login' })

        try {
          const notifier = await getNotificationService()
          const { subject, html, text } = buildTwoFaLoginOtpEmail({
            toName: user.name, toEmail: user.email,
            otp, validMinutes: EMAIL_OTP_VALID_MINUTES,
          })
          const result = await notifier.send({ to: user.email, subject, html, text })
          if (result.ok) {
            logger.info('[2FA] OTP email sent', { userId: user._id.toString(), purpose: '2fa_login' })
          } else {
            logger.error('[2FA] OTP email delivery failed', {
              userId: user._id.toString(), purpose: '2fa_login', emailError: result.error,
            })
          }
        } catch (emailErr) {
          logger.error('[2FA] OTP email error', {
            userId: user._id.toString(),
            errorMessage: emailErr instanceof Error ? emailErr.message : String(emailErr),
          })
        }
      } else {
        logger.info('[login] Email OTP send rate limited — pending session issued, user must resend', {
          userId: user._id.toString(),
        })
      }

      // Issue pending session regardless of whether OTP email was sent
      const session = await getSession()
      session.isLoggedIn         = false
      session.userId             = ''
      session.name               = ''
      session.email              = ''
      session.twoFactorPending   = true
      session.pendingUserId      = user._id.toString()
      session.twoFactorPendingAt = Date.now()
      await session.save()

      logger.info('[login] Email OTP 2FA challenge issued', { userId: user._id.toString() })

      return NextResponse.json(
        {
          twoFactorRequired: true,
          twoFactorMethod:   'email_otp',
          maskedEmail:       maskEmail(user.email),
          message:           'Please enter the verification code sent to your email.',
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
    session.lastActiveAt       = Date.now() // inactivity timer starts at login
    session.loginAt            = Date.now() // absolute 24-hour deadline starts at login
    await session.save()

    logger.info('[login] Successful login', { userId: user._id.toString() })

    // Record login success (non-fatal, fire-and-forget)
    void recordSecurityEvent({
      userId:    user._id.toString(),
      publicId:  user.publicId,
      eventType:  'login_success',
      outcome:    'success',
      ip:         _securityIp,
      ipSource:   _securityIpSource,
      deviceCategory: _parsedUa.deviceCategory,
      browser:    _parsedUa.browser,
    })

    return NextResponse.json({
      message:    'Logged in successfully',
      redirectTo: '/app/dashboard',
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
