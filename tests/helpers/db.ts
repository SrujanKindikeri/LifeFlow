/**
 * tests/helpers/db.ts
 * Shared in-memory MongoDB setup/teardown for all tests.
 * Uses mongodb-memory-server so no real Atlas connection is needed.
 */

import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'

let mongod: MongoMemoryServer | null = null

export async function startDb(): Promise<void> {
  mongod = await MongoMemoryServer.create()
  await mongoose.connect(mongod.getUri(), { dbName: 'lifeflow_test' })
}

export async function stopDb(): Promise<void> {
  await mongoose.disconnect()
  await mongod?.stop()
  mongod = null
}

export async function clearDb(): Promise<void> {
  const collections = mongoose.connection.collections
  for (const key in collections) {
    await collections[key].deleteMany({})
  }
}
