import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getSession, requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import { profileUpdateSchema, changePasswordSchema } from '@/lib/validations'
import User from '@/models/User'

// GET /api/auth/me — return the current user
export async function GET() {
  try {
    const session = await getSession()
    if (!session.isLoggedIn || !session.userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    await connectDB()
    const user = await User.findById(session.userId).select('-passwordHash').lean()
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      user: {
        _id: user._id.toString(),
        publicId: user.publicId,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        currency: user.currency,
        timezone: user.timezone,
        notificationPreferences: user.notificationPreferences,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
    })
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
      const user = await User.findByIdAndUpdate(
        userId,
        { $set: { notificationPreferences: body.notificationPreferences } },
        { new: true }
      ).select('-passwordHash')
      if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

      return NextResponse.json({
        user: {
          _id: user._id.toString(),
          publicId: user.publicId,
          name: user.name,
          email: user.email,
          avatar: user.avatar,
          currency: user.currency,
          timezone: user.timezone,
          notificationPreferences: user.notificationPreferences,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        },
      })
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

    return NextResponse.json({
      user: {
        _id: user._id.toString(),
        publicId: user.publicId,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        currency: user.currency,
        timezone: user.timezone,
        notificationPreferences: user.notificationPreferences,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[me PATCH]', error)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}

// DELETE /api/auth/me — delete account
export async function DELETE() {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    // Import all models to cascade-delete user data
    const { default: Task } = await import('@/models/Task')
    const { default: Note } = await import('@/models/Note')
    const { default: Habit } = await import('@/models/Habit')
    const { default: HabitLog } = await import('@/models/HabitLog')
    const { default: Expense } = await import('@/models/Expense')
    const { default: GroupBill } = await import('@/models/GroupBill')
    const { default: Notification } = await import('@/models/Notification')

    await Promise.all([
      Task.deleteMany({ userId }),
      Note.deleteMany({ userId }),
      Habit.deleteMany({ userId }),
      HabitLog.deleteMany({ userId }),
      Expense.deleteMany({ userId }),
      GroupBill.deleteMany({ userId }),
      Notification.deleteMany({ userId }),
      User.findByIdAndDelete(userId),
    ])

    // Clear session
    const session = await getSession()
    session.destroy()

    return NextResponse.json({ message: 'Account deleted' })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[me DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
  }
}
