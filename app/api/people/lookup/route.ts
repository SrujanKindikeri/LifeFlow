import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import User from '@/models/User'
import Person from '@/models/Person'

/**
 * GET /api/people/lookup?lifeflowId=LF-XXXXXXXX
 *
 * Authenticated endpoint — looks up a LifeFlow user by their public ID and
 * returns the minimum profile info needed to confirm the person before adding.
 *
 * Security properties:
 *  - Requires a valid session (requireAuth throws 'Unauthorized' otherwise).
 *  - Performs an indexed lookup on User.publicId (unique index).
 *  - Returns ONLY: name, publicId (LifeFlow ID), and a masked email.
 *  - Never returns: passwordHash, session secrets, 2FA secrets, recovery codes,
 *    or any other private account fields.
 *  - Tells the client whether the found user is already in the caller's People.
 *  - Does NOT allow searching by name or email — only exact LifeFlow ID lookup,
 *    preventing user-enumeration via fuzzy search.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()

    const { searchParams } = req.nextUrl
    const lifeflowId = searchParams.get('lifeflowId')?.trim().toUpperCase()

    if (!lifeflowId) {
      return NextResponse.json({ error: 'Please enter a LifeFlow ID.' }, { status: 400 })
    }

    // Validate format before hitting the database
    if (!/^LF-[A-Z2-9]{8}$/.test(lifeflowId)) {
      return NextResponse.json({ error: 'Please enter a valid LifeFlow ID.' }, { status: 400 })
    }

    await connectDB()

    // Indexed lookup on User.publicId (unique index — no collection scan).
    // Select only the minimum fields; never expose sensitive columns.
    const targetUser = await User.findOne({ publicId: lifeflowId })
      .select('_id publicId name email')
      .lean()

    if (!targetUser) {
      return NextResponse.json({ error: 'LifeFlow ID not found.' }, { status: 404 })
    }

    // Prevent looking yourself up (edge case, but keep the UX clean)
    if (targetUser._id.toString() === userId) {
      return NextResponse.json({ error: 'That is your own LifeFlow ID.' }, { status: 400 })
    }

    // Check if already added
    const alreadyAdded = !!(await Person.findOne({
      userId,
      linkedUserId: targetUser._id,
    }).lean())

    // Mask the email: show only first char + domain, e.g. s***@gmail.com
    const [localPart, domain] = targetUser.email.split('@')
    const maskedEmail = localPart.length > 0
      ? `${localPart[0]}***@${domain ?? ''}`
      : `***@${domain ?? ''}`

    return NextResponse.json({
      person: {
        name:         targetUser.name,
        lifeFlowId:   targetUser.publicId,
        maskedEmail,
        alreadyAdded,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[people lookup GET]', error)
    return NextResponse.json({ error: 'Lookup failed. Please try again.' }, { status: 500 })
  }
}
