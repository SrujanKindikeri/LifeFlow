import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/db'
import { getSession } from '@/lib/session'
import { signupSchema } from '@/lib/validations'
import User, { generatePublicId } from '@/models/User'

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

    await connectDB()

    // Check for duplicate email
    const existing = await User.findOne({ email: email.toLowerCase() })
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

    // Create user
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      passwordHash,
      publicId,
    })

    // Start session
    const session = await getSession()
    session.userId = user._id.toString()
    session.name = user.name
    session.email = user.email
    session.isLoggedIn = true
    await session.save()

    return NextResponse.json(
      {
        message: 'Account created successfully',
        user: { name: user.name, email: user.email, publicId: user.publicId },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('[signup]', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
