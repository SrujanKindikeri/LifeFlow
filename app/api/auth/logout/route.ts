import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import logger from '@/lib/logger'

export async function POST() {
  try {
    const session = await getSession()
    session.destroy()
    return NextResponse.json({ message: 'Logged out successfully' })
  } catch (error) {
    logger.error('[logout]', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to logout' }, { status: 500 })
  }
}
