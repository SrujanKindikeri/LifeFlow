/**
 * lib/db.ts — MongoDB connection singleton for Next.js / serverless environments.
 *
 * Uses a module-level global cache so the same connection is reused across:
 *   - Hot-reloads in Next.js dev mode
 *   - Multiple requests in the same serverless function instance
 *   - Long-running Node.js processes (AWS App Runner, Azure App Service)
 *
 * Handles:
 *   - Connection failures with clear error messages
 *   - Automatic retry on the next request after a failed connection attempt
 *   - Serverless / cold-start efficiency (no persistent socket assumption)
 *   - Validated environment variables via @/lib/env
 *
 * All other server-side modules should call connectDB() before any DB query.
 */

import mongoose from 'mongoose'

// Import env validation — validates MONGODB_URI at module load
import { serverEnv } from '@/lib/env'

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
 * In production this is also useful for serverless platforms that reuse
 * function instances (Vercel, AWS Lambda, Azure Functions).
 */
const globalWithMongoose = global as typeof globalThis & {
  _mongooseCache?: MongooseCache
}

if (!globalWithMongoose._mongooseCache) {
  globalWithMongoose._mongooseCache = { conn: null, promise: null }
}

const cached = globalWithMongoose._mongooseCache

// ─── Connection options ───────────────────────────────────────────────────────

const CONNECTION_OPTIONS: mongoose.ConnectOptions = {
  // Don't buffer model commands while connection is establishing.
  // Fail fast so the caller sees the error immediately.
  bufferCommands: false,

  // Fail after 10 seconds rather than the default 30-second wait.
  // Keeps request latency predictable in serverless cold-starts.
  serverSelectionTimeoutMS: 10_000,

  // Close idle sockets after 45 seconds to avoid stale connection errors
  // on platforms that enforce TCP idle timeouts (AWS, Azure load balancers).
  socketTimeoutMS: 45_000,

  // Max connection pool size. Adjust based on Atlas tier:
  //   Free (M0):   max 500 connections total across all clients → keep low
  //   Shared (M2/M5): 500 connections
  //   Dedicated: higher limits
  maxPoolSize: 10,
  minPoolSize: 1,

  // Heartbeat to detect stale connections (default is 10 000 ms)
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
    const uri = serverEnv.MONGODB_URI

    cached.promise = mongoose
      .connect(uri, CONNECTION_OPTIONS)
      .then((mongooseInstance) => {
        // Register event handlers on the default connection
        const conn = mongooseInstance.connection

        conn.on('error', (err: Error) => {
          console.error('[MongoDB] Connection error:', err.message)
          // Clear cache so the next request triggers a fresh connection attempt
          cached.conn = null
          cached.promise = null
        })

        conn.on('disconnected', () => {
          console.warn('[MongoDB] Disconnected — will reconnect on next request')
          cached.conn = null
          cached.promise = null
        })

        conn.on('reconnected', () => {
          console.info('[MongoDB] Reconnected successfully')
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
    const pingPromise = db.admin().ping()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('ping timeout')), timeoutMs)
    )

    await Promise.race([pingPromise, timeoutPromise])
    return true
  } catch {
    return false
  }
}
