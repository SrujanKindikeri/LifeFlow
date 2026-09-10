/**
 * GET /api/health
 *
 * Liveness + readiness health check endpoint.
 *
 * Returns 200 when the application and database are healthy.
 * Returns 503 when the database is unreachable.
 *
 * Used by:
 *   - AWS App Runner / ECS / Elastic Beanstalk health checks
 *   - Azure App Service / Container Apps health probes
 *   - Docker HEALTHCHECK instruction
 *   - Kubernetes liveness + readiness probes
 *   - Load balancer health checks
 *   - Uptime monitoring services
 *
 * SECURITY: Never exposes secrets, credentials, or internal stack traces.
 * The response is intentionally minimal.
 */

import { NextResponse } from 'next/server'
import { pingDB, getConnectionStatus } from '@/lib/db'
import { runStartup } from '@/lib/startup'

// Always dynamic — never cache health check responses
export const dynamic = 'force-dynamic'

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error'
  database: 'connected' | 'connecting' | 'disconnected' | 'error'
  timestamp: string
  version: string
  uptime: number
}

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const startedAt = Date.now()

  // Run one-time startup tasks (indexes, env validation) — idempotent
  try {
    await runStartup()
  } catch {
    // Startup failure is non-fatal for the health check itself —
    // the DB ping below will catch connectivity issues
  }

  // Check database connectivity
  const dbPing   = await pingDB(5_000)
  const dbStatus = getConnectionStatus()

  const healthy = dbPing && dbStatus === 'connected'

  const body: HealthResponse = {
    status:    healthy ? 'ok' : 'error',
    database:  dbStatus,
    timestamp: new Date().toISOString(),
    version:   process.env.npm_package_version ?? '0.1.0',
    uptime:    Math.floor(process.uptime()),
  }

  // Return 503 if DB is unhealthy — signals the load balancer to stop
  // routing traffic to this instance
  const httpStatus = healthy ? 200 : 503

  void startedAt // suppress lint warning — timing not needed here

  return NextResponse.json(body, {
    status: httpStatus,
    headers: {
      // Prevent caching of health check responses
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Type':  'application/json',
    },
  })
}
