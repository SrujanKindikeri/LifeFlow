import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/db'
import { getSession } from '@/lib/session'
import { loginSchema } from '@/lib/validations'
import User from '@/models/User'

export async function POST(req: NextRequest) {
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

    await connectDB()

    const user = await User.findOne({ email: email.toLowerCase() })
    if (!user) {
      return NextResponse.json(
        { error: 'No account found with that email.', code: 'ACCOUNT_NOT_FOUND' },
        { status: 404 }
      )
    }

    const isValid = await bcrypt.compare(password, user.passwordHash)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Save session
    const session = await getSession()
    session.userId = user._id.toString()
    session.name = user.name
    session.email = user.email
    session.isLoggedIn = true
    await session.save()

    return NextResponse.json({
      message: 'Logged in successfully',
      user: { name: user.name, email: user.email },
    })
  } catch (error) {
    console.error('[login]', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
