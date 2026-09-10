/**
 * GET /api/ready
 *
 * Lightweight readiness probe — checks that the process is alive and
 * environment variables are configured, WITHOUT opening a DB connection.
 *
 * Use this for:
 *   - Kubernetes readiness probes (before the pod accepts traffic)
 *   - Fast load balancer checks where DB latency is not acceptable
 *   - CI/CD pipeline "is the server up?" checks
 *
 * Use /api/health for full liveness checks including DB connectivity.
 *
 * SECURITY: Returns no secrets or internal details.
 */

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface ReadyResponse {
  status: 'ready' | 'not_ready'
  timestamp: string
  checks: {
    env: 'ok' | 'error'
    envMessage?: string
  }
}

export async function GET(): Promise<NextResponse<ReadyResponse>> {
  // Check that required env vars are present (no DB call)
  let envOk = true
  let envMessage: string | undefined

  const required = ['MONGODB_URI', 'SESSION_SECRET']
  const missing  = required.filter((k) => !process.env[k])

  if (missing.length > 0) {
    envOk      = false
    envMessage = `Missing: ${missing.join(', ')}`
  }

  const ready = envOk

  const body: ReadyResponse = {
    status:    ready ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    checks: {
      env:        envOk ? 'ok' : 'error',
      ...(envMessage && { envMessage }),
    },
  }

  return NextResponse.json(body, {
    status: ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  })
}
