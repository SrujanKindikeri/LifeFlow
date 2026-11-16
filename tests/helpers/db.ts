/**
 * tests/helpers/db.ts
 * Shared in-memory MongoDB setup/teardown for all tests.
 * Uses mongodb-memory-server so no real Atlas connection is needed.
 */

import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

let mongod: MongoMemoryServer | null = null

export async function startDb(): Promise<void> {
  mongod = await MongoMemoryServer.create({
    instance: {
      launchTimeout: 30000,
    },
  })
  const uri = mongod.getUri()
  process.env.MONGODB_URI = uri
  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = 'test-session-secret-at-least-32-chars-long-for-tests!!'
  }
  await mongoose.connect(uri, { dbName: 'lifeflow_test' })
}

export async function stopDb(): Promise<void> {
  await mongoose.disconnect()
  await mongod?.stop()
  mongod = null
  delete process.env.MONGODB_URI
}

export async function clearDb(): Promise<void> {
  const collections = mongoose.connection.collections
  for (const key in collections) {
    await collections[key].deleteMany({})
  }
}
