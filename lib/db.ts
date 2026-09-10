import mongoose from 'mongoose'

const MONGODB_URI = process.env.MONGODB_URI!

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI environment variable is not defined')
}

interface MongooseCache {
  conn: typeof mongoose | null
  promise: Promise<typeof mongoose> | null
}

// Use a module-level cache to reuse connections across hot-reloads in dev
const globalWithMongoose = global as typeof globalThis & {
  mongooseCache?: MongooseCache
}

if (!globalWithMongoose.mongooseCache) {
  globalWithMongoose.mongooseCache = { conn: null, promise: null }
}

const cached = globalWithMongoose.mongooseCache

export async function connectDB(): Promise<typeof mongoose> {
  if (cached.conn) {
    return cached.conn
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 10000, // fail fast instead of the 30s default
      socketTimeoutMS: 20000,
    })
  }

  try {
    cached.conn = await cached.promise
  } catch (err) {
    // Reset the cached promise so the next request gets a fresh attempt
    // instead of immediately re-throwing from a permanently rejected promise.
    cached.promise = null
    // Re-throw as a plain Error so Next.js serialization never touches the
    // Mongoose class instance (which causes the secondary "Only plain objects"
    // crash in the App Router).
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Database connection failed: ${message}`)
  }

  return cached.conn
}
