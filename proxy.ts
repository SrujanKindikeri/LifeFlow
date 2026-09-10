/**
 * proxy.ts — Next.js 16 middleware for LifeFlow.
 *
 * Next.js 16 uses the file name "proxy.ts" (renamed from "middleware.ts").
 * The exported function must be named "proxy" or be a default export.
 *
 * Handles:
 *   - Redirecting authenticated users away from /login and /signup
 *   - Protecting all /app/* routes — unauthenticated users are sent to /login
 */

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { SessionData, getSessionOptions } from '@/lib/session'

const AUTH_PATHS = ['/login', '/signup']

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Read the encrypted session cookie from the incoming request
  const response = NextResponse.next()
  const session  = await getIronSession<SessionData>(req, response, getSessionOptions())
  const isLoggedIn = session.isLoggedIn === true && !!session.userId

  // Redirect logged-in users away from auth pages
  if (isLoggedIn && AUTH_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/app/dashboard', req.url))
  }

  // Protect /app/* routes — redirect unauthenticated users to login
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
