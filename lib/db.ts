/**
 * lib/db.ts — MongoDB connection singleton for Next.js / serverless environments.
 *
 * Uses a module-level global cache so the same connection is reused across:
 *   - Hot-reloads in Next.js dev mode
 *   - Multiple requests in the same serverless function instance
 *   - Long-running Node.js processes (AWS EC2, Azure VM)
 *
 * Handles:
 *   - Connection failures with clear error messages
 *   - Automatic retry on the next request after a failed connection attempt
 *   - Serverless / cold-start efficiency (no persistent socket assumption)
 *   - Graceful shutdown on SIGTERM / SIGINT (docker stop, systemd stop)
 *   - Validated environment variables via @/lib/env
 *
 * All other server-side modules should call connectDB() before any DB query.
 */

import dns from 'dns'
import mongoose from 'mongoose'
import logger from '@/lib/logger'

// getServerEnv() validates MONGODB_URI at runtime (inside connectDB), not at module load.
// This keeps `next build` working in Docker where secrets are absent during the build stage.
import { getServerEnv } from '@/lib/env'

// ─── Optional DNS server override ────────────────────────────────────────────
//
// Some environments (e.g. Windows with a home/mobile router as the DNS server)
// run a DNS resolver that returns a malformed/unexpected response for DNS SRV
// queries, which Node.js c-ares reports as EBADRESP.  The mongodb+srv://
// connection string relies entirely on DNS SRV resolution, so a broken local
// DNS server causes every connection attempt to fail before any TCP socket is
// even opened.
//
// Set DNS_SERVERS in .env.local (or the platform's environment) to a comma-
// separated list of reliable DNS server addresses (e.g. 8.8.8.8,8.8.4.4).
// When the variable is present, this module overrides Node.js's default
// resolver so that SRV lookups go to those servers instead of the system
// resolver.
//
// This is intentionally a no-op when DNS_SERVERS is absent, so production
// deployments on AWS EC2 / Azure VM (which use reliable VPC/platform DNS) are
// completely unaffected.
//
// Safe to call at module load: dns.setServers() is synchronous and affects
// only the c-ares resolver used by this Node.js process.
if (typeof process !== 'undefined' && process.env.DNS_SERVERS) {
  const servers = process.env.DNS_SERVERS
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (servers.length > 0) {
    try {
      dns.setServers(servers)
      // Log only server count/addresses — no secrets here.
      if (process.env.NODE_ENV === 'development') {
        logger.info('[MongoDB] DNS resolver overridden via DNS_SERVERS', { servers })
      }
    } catch (err) {
      // Non-fatal — log and continue with the system resolver.
      logger.warn('[MongoDB] Failed to override DNS servers', {
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// ─── Connection state cache ───────────────────────────────────────────────────

interface MongooseCache {
  conn: typeof mongoose | null
  promise: Promise<typeof mongoose> | null
}

/**
 * We attach the cache to `global` so that in Next.js development mode,
 * where modules are re-evaluated on every hot reload, we reuse the same
 * connection rather than opening a new one each time.
 *
 * In production this is also useful for long-running VM processes.
 */
const globalWithMongoose = global as typeof globalThis & {
  _mongooseCache?: MongooseCache
  _mongooseShutdownRegistered?: boolean
}

if (!globalWithMongoose._mongooseCache) {
  globalWithMongoose._mongooseCache = { conn: null, promise: null }
}

const cached = globalWithMongoose._mongooseCache

// ─── Graceful shutdown ────────────────────────────────────────────────────────

/**
 * Register SIGTERM / SIGINT handlers exactly once per process so that
 * `docker stop` (SIGTERM) and Ctrl-C (SIGINT) close the MongoDB connection
 * cleanly before the process exits.
 *
 * Unref'd signals prevent this from keeping the event loop alive.
 */
function registerShutdownHandlers(): void {
  if (globalWithMongoose._mongooseShutdownRegistered) return
  globalWithMongoose._mongooseShutdownRegistered = true

  async function shutdown(signal: string): Promise<void> {
    logger.info(`[MongoDB] Received ${signal} — closing connection gracefully`)
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close()
        logger.info('[MongoDB] Connection closed cleanly')
      }
    } catch (err) {
      logger.error('[MongoDB] Error during graceful shutdown', {
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    } finally {
      process.exit(0)
    }
  }

  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT',  () => void shutdown('SIGINT'))
}

// Register immediately when this module is first imported (server context only).
// Skip during `next build` — the build runs multiple worker processes that
// receive SIGINT/SIGTERM when the build completes; registering handlers there
// produces spurious "closing connection" log lines with no real DB to close.
if (
  typeof process !== 'undefined' &&
  typeof process.once === 'function' &&
  process.env.NODE_ENV !== 'test' &&
  !process.env.NEXT_PHASE?.includes('phase-production-build')
) {
  registerShutdownHandlers()
}

// ─── Connection options ───────────────────────────────────────────────────────

const CONNECTION_OPTIONS: mongoose.ConnectOptions = {
  // Don't buffer model commands while connection is establishing.
  // Fail fast so the caller sees the error immediately.
  bufferCommands: false,

  // ── IPv4 enforcement ──────────────────────────────────────────────────────
  //
  // Node.js v17+ (RFC 6724) prefers IPv6 addresses when a host returns both
  // an IPv6 and an IPv4 record.  MongoDB Atlas shard hostnames return:
  //   • A synthetic NAT64 IPv6 address (64:ff9b::/96 prefix)
  //   • A real IPv4 address
  //
  // Atlas does NOT accept connections on the NAT64 IPv6 address — the TCP
  // connection succeeds (the NAT64 gateway is reachable) but the TLS
  // handshake never completes, so the driver waits until
  // serverSelectionTimeoutMS fires and reports ETIMEDOUT.
  //
  // Setting family: 4 tells the Node.js DNS resolver to only return IPv4
  // addresses, so the driver connects directly to the real Atlas IP.
  // This is the correct fix for Node.js v17+ / v24 + MongoDB Atlas SRV.
  family: 4,

  // Abort TCP connect attempts after 10 seconds (belt-and-suspenders on top
  // of serverSelectionTimeoutMS).  Without this, a NAT64 or firewall that
  // accepts the TCP SYN but never completes the handshake can hold the
  // socket open silently for the OS default (minutes).
  connectTimeoutMS: 10_000,

  // Fail server selection after 30 seconds.  30 s is generous enough to
  // survive a transient Atlas primary failover (~15 s) without making the
  // app feel permanently broken.  The previous value of 10 s was too tight
  // for cold-starts and Atlas failover events.
  serverSelectionTimeoutMS: 30_000,

  // Close idle sockets after 45 seconds to avoid stale connection errors
  // on platforms that enforce TCP idle timeouts (AWS, Azure load balancers).
  socketTimeoutMS: 45_000,

  // Max connection pool size. Adjust based on Atlas tier:
  //   Free (M0):   max 500 connections total across all clients → keep low
  //   Shared (M2/M5): 500 connections
  //   Dedicated: higher limits
  maxPoolSize: 10,
  minPoolSize: 1,

  // Heartbeat to detect stale connections (default 10 000 ms)
  heartbeatFrequencyMS: 10_000,
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Connect to MongoDB and return the Mongoose instance.
 *
 * Calling this multiple times is safe — subsequent calls return the cached
 * connection without creating a new one.
 *
 * @throws {Error} with a descriptive message if the connection fails.
 */
export async function connectDB(): Promise<typeof mongoose> {
  // Return cached connection if available
  if (cached.conn) {
    return cached.conn
  }

  // Start a new connection attempt if none is in progress
  if (!cached.promise) {
    // Validate env at runtime (not at module load) so `next build` succeeds
    // in Docker environments where secrets are not available during the build stage.
    const env = getServerEnv()
    const uri    = env.MONGODB_URI
    const dbName = env.MONGODB_DB_NAME   // defaults to 'test' in getServerEnv()

    if (process.env.NODE_ENV === 'development') {
      // Extract ONLY the hostname from the URI — never log credentials.
      // mongodb+srv://user:pass@hostname/db?opts  →  hostname
      let safeHostname = '(unresolved)'
      try {
        // SRV URIs use the mongodb+srv:// scheme; URL() parses it fine.
        safeHostname = new URL(uri).hostname
      } catch {
        safeHostname = '(unparseable URI)'
      }
      logger.info('[DB DEBUG] connecting', {
        provider:               'mongodb',
        hostname:               safeHostname,
        database_name:          dbName,
        NODE_ENV:               process.env.NODE_ENV,
        MONGODB_URI_configured: !!uri,
        // Confirms the IPv4-enforcement fix is active at runtime
        dns_family:             (CONNECTION_OPTIONS as Record<string, unknown>).family ?? 'default',
      })
    }

    cached.promise = mongoose
      .connect(uri, { ...CONNECTION_OPTIONS, dbName })
      .then((mongooseInstance) => {
        // Register event handlers on the default connection
        const conn = mongooseInstance.connection

        conn.on('connect', () => {
          if (process.env.NODE_ENV === 'development') {
            logger.info('[DB DEBUG] connected', {
              database_name:    conn.db?.databaseName ?? '(unknown)',
              connection_state: 'connected',
              // Confirms the correct Atlas cluster is in use
              host:             conn.host ?? '(unknown)',
              port:             conn.port ?? '(unknown)',
            })
          }
        })

        conn.on('error', (err: Error) => {
          logger.error('[MongoDB] Connection error', { errorMessage: err.message })
          // Clear cache so the next request triggers a fresh connection attempt
          cached.conn    = null
          cached.promise = null
        })

        conn.on('disconnected', () => {
          logger.warn('[MongoDB] Disconnected — will reconnect on next request')
          cached.conn    = null
          cached.promise = null
        })

        conn.on('reconnected', () => {
          logger.info('[MongoDB] Reconnected successfully')
        })

        return mongooseInstance
      })
  }

  try {
    cached.conn = await cached.promise
  } catch (err) {
    // Reset the cached promise so the next request gets a fresh attempt
    // instead of immediately re-throwing from a permanently rejected promise.
    cached.promise = null

    // Re-throw as a plain Error — avoids Next.js App Router's "Only plain
    // objects can be passed between Server and Client Components" crash when
    // a Mongoose-specific error class is thrown across the boundary.
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`[MongoDB] Connection failed: ${message}`)
  }

  return cached.conn
}

/**
 * Close the MongoDB connection explicitly.
 * Called by graceful-shutdown code and integration tests.
 */
export async function closeDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close()
    cached.conn    = null
    cached.promise = null
  }
}

/**
 * Check whether MongoDB is currently connected.
 * Used by the health check endpoint.
 *
 * Returns:
 *   'connected'    — active, usable connection
 *   'connecting'   — connection attempt in progress
 *   'disconnected' — no active connection
 *   'error'        — in an error state
 */
export function getConnectionStatus(): 'connected' | 'connecting' | 'disconnected' | 'error' {
  const state = mongoose.connection.readyState
  switch (state) {
    case 1: return 'connected'
    case 2: return 'connecting'
    case 3: return 'disconnected' // disconnecting
    case 0: return 'disconnected'
    default: return 'error'
  }
}

/**
 * Attempt to ping MongoDB to verify the connection is alive.
 * Used by the health check endpoint to get a definitive liveness signal.
 *
 * @param timeoutMs — max ms to wait for the ping (default 5 000)
 */
export async function pingDB(timeoutMs = 5_000): Promise<boolean> {
  try {
    await connectDB()

    const db = mongoose.connection.db
    if (!db) return false

    // Race the admin ping against a timeout
    const pingPromise    = db.admin().ping()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('ping timeout')), timeoutMs)
    )

    await Promise.race([pingPromise, timeoutPromise])
    return true
  } catch {
    return false
  }
}
