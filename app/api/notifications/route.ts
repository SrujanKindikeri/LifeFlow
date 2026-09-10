import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Notification from '@/models/Notification'

function serialize(n: {
  _id: { toString(): string }
  userId: { toString(): string }
  title: string
  message: string
  type: string
  read: boolean
  createdAt: Date
}) {
  return {
    _id: n._id.toString(),
    userId: n.userId.toString(),
    title: n.title,
    message: n.message,
    type: n.type,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  }
}

// GET /api/notifications
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    await connectDB()

    const { searchParams } = new URL(req.url)
    const unreadOnly = searchParams.get('unread') === 'true'
    const type = searchParams.get('type')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100)

    const query: Record<string, unknown> = { userId }
    if (unreadOnly) query.read = false
    if (type) query.type = type

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()

    const unreadCount = await Notification.countDocuments({ userId, read: false })

    return NextResponse.json({
      notifications: notifications.map(serialize),
      unreadCount,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[notifications GET]', error)
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
  }
}

// POST /api/notifications — internal use (create a notification)
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const body = await req.json()
    const { title, message, type = 'general' } = body

    if (!title || !message) {
      return NextResponse.json({ error: 'title and message are required' }, { status: 400 })
    }

    await connectDB()
    const notification = await Notification.create({ userId, title, message, type })

    return NextResponse.json({ notification: serialize(notification) }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[notifications POST]', error)
    return NextResponse.json({ error: 'Failed to create notification' }, { status: 500 })
  }
}

// PATCH /api/notifications — mark all as read
export async function PATCH(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const body = await req.json()
    await connectDB()

    if (body.action === 'markAllRead') {
      await Notification.updateMany({ userId, read: false }, { $set: { read: true } })
      return NextResponse.json({ message: 'All notifications marked as read' })
    }

    if (body.id) {
      const notification = await Notification.findOneAndUpdate(
        { _id: body.id, userId },
        { $set: { read: body.read ?? true } },
        { new: true }
      )
      if (!notification) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      return NextResponse.json({ notification: serialize(notification) })
    }

    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[notifications PATCH]', error)
    return NextResponse.json({ error: 'Failed to update notification' }, { status: 500 })
  }
}

// DELETE /api/notifications — delete one or all
export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    const all = searchParams.get('all') === 'true'
    await connectDB()

    if (all) {
      await Notification.deleteMany({ userId })
      return NextResponse.json({ message: 'All notifications deleted' })
    }

    if (id) {
      const notification = await Notification.findOneAndDelete({ _id: id, userId })
      if (!notification) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      return NextResponse.json({ message: 'Notification deleted' })
    }

    return NextResponse.json({ error: 'id or all=true required' }, { status: 400 })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[notifications DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete notification' }, { status: 500 })
  }
}
