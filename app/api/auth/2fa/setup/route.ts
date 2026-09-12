/**
 * POST /api/auth/2fa/setup
 *
 * Generates a new TOTP secret for the authenticated user, returns the
 * otpauth:// URI and a QR code data-URL for display in the UI.
 *
 * The secret is NOT stored/enabled yet — that happens in /api/auth/2fa/enable
 * after the user proves the generated secret works.
 *
 * Response:
 *   { otpauthUrl, qrCodeDataUrl, manualKey }
 *
 * Protected: requires a fully authenticated session (isLoggedIn=true).
 */

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { encryptTotpSecret } from '@/lib/auth/crypto'
import logger from '@/lib/logger'

const ISSUER = 'LifeFlow'

export async function POST() {
  try {
    const { userId, email } = await requireAuth()

    await connectDB()

    const user = await User.findById(userId)
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (user.twoFactorEnabled) {
      return NextResponse.json(
        { error: 'Two-factor authentication is already enabled.' },
        { status: 400 }
      )
    }

    // ── Generate TOTP secret ──────────────────────────────────────────────
    const { authenticator } = await import('@otplib/preset-default')
    const secret = authenticator.generateSecret()

    // Build the otpauth URI (used for QR code and manual entry)
    const otpauthUrl = authenticator.keyuri(email, ISSUER, secret)

    // ── Generate QR code data URL ─────────────────────────────────────────
    let qrCodeDataUrl = ''
    try {
      const QRCode = await import('qrcode')
      qrCodeDataUrl = await QRCode.default.toDataURL(otpauthUrl, {
        width: 256,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
    } catch (qrErr) {
      logger.warn('[2fa/setup] QR code generation failed', {
        userId,
        errorMessage: qrErr instanceof Error ? qrErr.message : String(qrErr),
      })
      // QR code failure is non-fatal — the user can still use the manual key
    }

    // ── Temporarily store the encrypted pending secret ────────────────────
    // We store it now so /enable can read it without the client ever sending
    // the secret back.  It is overwritten/cleared on enable/disable.
    const encryptedSecret = encryptTotpSecret(secret)
    user.twoFactorSecretEncrypted = encryptedSecret
    // twoFactorEnabled remains false until /enable confirms the first code
    await user.save()

    logger.info('[2fa/setup] TOTP setup initiated', { userId })

    return NextResponse.json({
      otpauthUrl,
      qrCodeDataUrl,
      // The manual key is the base32 secret — display once, never stored in plain
      manualKey: secret,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    logger.error('[2fa/setup]', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
