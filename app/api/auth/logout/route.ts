import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'

export async function POST() {
  try {
    const session = await getSession()
    session.destroy()
    return NextResponse.json({ message: 'Logged out successfully' })
  } catch (error) {
    console.error('[logout]', error)
    return NextResponse.json({ error: 'Failed to logout' }, { status: 500 })
  }
}
