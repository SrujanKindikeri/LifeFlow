import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { DailyIntelligencePage } from '@/components/daily-intelligence/DailyIntelligencePage'
import logger from '@/lib/logger'

export const metadata = { title: 'Daily Intelligence — LifeFlow' }

export default async function DailyIntelligenceRoute() {
  let session
  try {
    session = await requireAuth({ skipActivityUpdate: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (msg.includes('Dynamic server usage')) throw err

    if (msg === 'UserNotFound' || msg === 'AccountDeleted' || msg === 'SessionExpired') {
      redirect('/api/auth/clear-session?reason=session_expired')
    }
    if (msg === 'Unauthorized') redirect('/login')

    logger.error('[daily-intelligence page]', { errorMessage: msg })
    throw new Error(msg)
  }

  return <DailyIntelligencePage userName={session.name} />
}
