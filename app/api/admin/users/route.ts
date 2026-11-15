/**
 * GET /api/admin/users
 * Search and paginate users. Safe projection — never returns secrets.
 *
 * Query params:
 *   q       - search term (name or email prefix, case-insensitive)
 *   status  - 'active' | 'deleted' | 'all'  (default: 'all')
 *   page    - 1-indexed  (default: 1)
 *   limit   - 1–100     (default: 25)
 */
import { NextRequest, NextResponse }          from 'next/server'
import { requireAdmin, handleAdminAuthError } from '@/lib/admin-auth'
import { connectDB }                          from '@/lib/db'
import User                                   from '@/models/User'

export const dynamic = 'force-dynamic'

// Safe projection — NEVER return passwordHash, tokens, OTPs, or hashes
const SAFE_PROJECTION = {
  publicId: 1, name: 1, email: 1, avatar: 1,
  currency: 1, timezone: 1, accountStatus: 1,
  emailVerified: 1, notificationsTested: 1,
  twoFactorEnabled: 1, emailOtpEnabled: 1,
  deletedAt: 1, scheduledPermanentDeletionAt: 1,
  createdAt: 1, updatedAt: 1,
  'emailNotifications.enabled': 1,
  'notificationPreferences': 1,
} as const

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin()
    await connectDB()

    const { searchParams } = req.nextUrl
    const q       = searchParams.get('q')?.trim() ?? ''
    const status  = searchParams.get('status') ?? 'all'
    const page    = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
    const limit   = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '25', 10)))
    const skip    = (page - 1) * limit

    // Build filter
    const filter: Record<string, unknown> = {}
    if (status === 'active')  filter.accountStatus = 'active'
    if (status === 'deleted') filter.accountStatus = 'deleted'

    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      filter.$or = [
        { name:  { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
        { publicId: { $regex: escaped, $options: 'i' } },
      ]
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select(SAFE_PROJECTION)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ])

    // Normalize accountStatus: lean() docs that predate the field default
    // arrive as undefined. Coerce to 'active' only when the document has no
    // explicit deletion markers — never assume active when deletedAt is set.
    const normalizedUsers = users.map((u) => {
      const doc = u as unknown as Record<string, unknown>
      if (doc.accountStatus == null) {
        doc.accountStatus = doc.deletedAt ? 'deleted' : 'active'
      }
      return doc
    })

    return NextResponse.json({
      users: normalizedUsers,
      total,
      page,
      limit,
      hasMore: skip + users.length < total,
    })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
