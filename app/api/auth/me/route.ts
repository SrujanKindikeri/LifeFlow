import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getSession, requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import { profileUpdateSchema, changePasswordSchema, appearancePreferencesSchema } from '@/lib/validations'
import User from '@/models/User'
import type { IUser } from '@/models/User'
import type { AppearancePreferences } from '@/types'

// ── Serialise a user doc into the safe client shape ───────────────────────────

const DEFAULT_APPEARANCE: AppearancePreferences = {
  theme:             'light',
  nightShiftEnabled: false,
  nightShiftStart:   '22:00',
  nightShiftEnd:     '07:00',
  turnToneEnabled:   true,
  turnToneVolume:    0.5,
}

// Accept either a lean plain object or a full Mongoose Document — both satisfy
// Partial<IUser> which is all we need for serialisation.
function serializeUser(user: Partial<IUser> & { _id: { toString(): string }; createdAt: Date; updatedAt: Date }) {
  return {
    _id:                          user._id.toString(),
    publicId:                     user.publicId,
    name:                         user.name,
    email:                        user.email,
    avatar:                       user.avatar,
    currency:                     user.currency,
    timezone:                     user.timezone,
    notificationPreferences:      user.notificationPreferences,
    emailNotifications:           user.emailNotifications,
    notificationsTested:          user.notificationsTested ?? false,
    notificationsTestedAt:        user.notificationsTestedAt?.toISOString() ?? null,
    appearancePreferences:        user.appearancePreferences ?? DEFAULT_APPEARANCE,
    accountStatus:                user.accountStatus ?? 'active',
    deletedAt:                    user.deletedAt?.toISOString() ?? null,
    scheduledPermanentDeletionAt: user.scheduledPermanentDeletionAt?.toISOString() ?? null,
    emailOtpEnabled:              user.emailOtpEnabled ?? false,
    twoFactorEnabledAt:           user.twoFactorEnabledAt?.toISOString() ?? null,
    createdAt:                    user.createdAt.toISOString(),
    updatedAt:                    user.updatedAt.toISOString(),
  }
}

// Fields fetched for the profile page GET.
// Excludes security token fields (emailVerification*, passwordReset*,
// accountRestore*, twoFactor*) that ProfileClient never reads — omitting
// them reduces the response payload noticeably for typical user documents.
// The avatar (potentially a large base64 data URL) is intentionally kept so
// the profile photo renders without a second round-trip.
// emailOtpEnabled is included so the Security section can show correct 2FA status.
const PROFILE_GET_PROJECTION = [
  'publicId',
  'name',
  'email',
  'avatar',
  'currency',
  'timezone',
  'notificationPreferences',
  'emailNotifications',
  'notificationsTested',
  'notificationsTestedAt',
  'appearancePreferences',
  'accountStatus',
  'deletedAt',
  'scheduledPermanentDeletionAt',
  'emailOtpEnabled',
  'twoFactorEnabledAt',
  'createdAt',
  'updatedAt',
].join(' ')

// GET /api/auth/me — return the current user
export async function GET() {
  try {
    const session = await getSession()
    if (!session.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    await connectDB()
    const userDoc = await User.findById(session.userId)
      .select(PROFILE_GET_PROJECTION)
      .lean<IUser>()
    if (!userDoc) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Soft-deleted accounts must not be served through this endpoint
    if ((userDoc.accountStatus ?? 'active') !== 'active') {
      return NextResponse.json({ error: 'Account is not active' }, { status: 403 })
    }

    return NextResponse.json({ user: serializeUser(userDoc) })
  } catch (error) {
    console.error('[me GET]', error)
    return NextResponse.json({ error: 'Failed to get user' }, { status: 500 })
  }
}

// PATCH /api/auth/me — update profile or change password
export async function PATCH(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const body = await req.json()
    await connectDB()

    // ── Change password action ──
    if (body.action === 'changePassword') {
      const parsed = changePasswordSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
      }

      const user = await User.findById(userId)
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

      const isValid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash)
      if (!isValid) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
      }

      const newHash = await bcrypt.hash(parsed.data.newPassword, 12)
      user.passwordHash = newHash
      await user.save()

      return NextResponse.json({ message: 'Password changed successfully' })
    }

    // ── Update notification preferences ──
    if (body.action === 'updateNotifications') {
      // Build the $set payload — only include keys that are present in the body
      // so a client that only sends notificationPreferences doesn't wipe emailNotifications
      // and vice versa.
      const setPayload: Record<string, unknown> = {}
      if (body.notificationPreferences !== undefined) {
        setPayload['notificationPreferences'] = body.notificationPreferences
      }
      if (body.emailNotifications !== undefined) {
        setPayload['emailNotifications'] = body.emailNotifications
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { $set: setPayload },
        { new: true }
      ).select('-passwordHash')
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

      return NextResponse.json({ user: serializeUser(user) })
    }

    // ── Update appearance preferences ──
    if (body.action === 'updateAppearance') {
      const parsed = appearancePreferencesSchema.safeParse(body.appearancePreferences)
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { $set: { appearancePreferences: parsed.data } },
        { new: true, upsert: false }
      ).select('-passwordHash')
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

      return NextResponse.json({ user: serializeUser(user) })
    }

    // ── Profile update (name, currency, timezone) ──
    const parsed = profileUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: parsed.data },
      { new: true }
    ).select('-passwordHash')

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Update session name if it changed
    const session = await getSession()
    if (parsed.data.name && session.name !== parsed.data.name) {
      session.name = parsed.data.name
      await session.save()
    }

    return NextResponse.json({ user: serializeUser(user) })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[me PATCH]', error)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}

// DELETE /api/auth/me — soft-delete account (30-day recovery window)
// This endpoint is kept for backward compatibility with any existing client
// code that calls DELETE /api/auth/me.  It delegates to the same logic as
// POST /api/auth/delete-account.
export async function DELETE(req: NextRequest) {
  // Forward to the delete-account handler by re-using its route module.
  // We import lazily so there is no circular dependency at module load time.
  const { POST: deleteAccountHandler } = await import('@/app/api/auth/delete-account/route')
  return deleteAccountHandler(req)
}
