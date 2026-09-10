import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { SessionData, sessionOptions } from '@/lib/session'

const AUTH_PATHS = ['/login', '/signup']

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Get session from request
  const response = NextResponse.next()
  const session = await getIronSession<SessionData>(req, response, sessionOptions)
  const isLoggedIn = session.isLoggedIn === true && !!session.userId

  // Redirect logged-in users away from auth pages
  if (isLoggedIn && AUTH_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/app/dashboard', req.url))
  }

  // Protect /app routes
  if (pathname.startsWith('/app')) {
    if (!isLoggedIn) {
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  return response
}

export const config = {
  matcher: [
    '/app/:path*',
    '/login',
    '/signup',
  ],
}
