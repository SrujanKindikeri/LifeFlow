/**
 * Test script to confirm whether findByIdAndUpdate + .select() chain works in Mongoose 9.9.5
 * Run with: node scripts/test-findbyid.mjs
 */
import mongoose from '../node_modules/mongoose/index.js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Load .env.local manually
const __dir = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dir, '..', '.env.local')
try {
  const envText = readFileSync(envPath, 'utf8')
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* ok */ }

const MONGODB_URI = process.env.MONGODB_URI
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'lifeflow'

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set — cannot run test')
  process.exit(1)
}

await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB_NAME, family: 4 })
console.log('Connected to MongoDB')

// Reproduce the exact real User schema fields relevant to OTP
const UserSchema = new mongoose.Schema({
  // include more real fields to ensure no interference
  name:         { type: String, default: 'Test User', trim: true },
  email:        { type: String, unique: true, lowercase: true, default: () => `test-${Date.now()}@example.com` },
  passwordHash: { type: String, default: 'hash' },
  emailOtpEnabled:     { type: Boolean, default: false },
  emailOtpHash:        { type: String, default: null },
  emailOtpExpiresAt:   { type: Date,   default: null },
  emailOtpAttempts:    { type: Number, default: 0 },
  emailOtpMaxAttempts: { type: Number, default: 5 },
  emailOtpSentAt:      { type: Date,   default: null },
  emailOtpPurpose:     { type: String, enum: ['2fa_enable', '2fa_login', '2fa_disable', null], default: null },
  accountStatus:       { type: String, enum: ['active', 'deleted'], default: 'active' },
  twoFactorEnabled:    { type: Boolean, default: false },
  emailVerified:       { type: Boolean, default: true },
  testFlag:            { type: Boolean, default: false },
}, { timestamps: true })

const TestUser = mongoose.models.TestUser2fa || mongoose.model('TestUser2fa', UserSchema, 'test_2fa_temp')

// Create a test doc
const doc = await TestUser.create({ testFlag: true })
console.log('Created test doc, _id:', doc._id.toString())

const otpHash = 'sha256testhashabcdef1234567890'
const expiresAt = new Date(Date.now() + 600000)
const now = new Date()

// === TEST 1: findByIdAndUpdate + .select() chain (current code pattern) ===
console.log('\n=== TEST 1: findByIdAndUpdate with returnDocument: after + .select() chain ===')
const updated1 = await TestUser.findByIdAndUpdate(
  doc._id,
  {
    $set: {
      emailOtpHash:        otpHash,
      emailOtpExpiresAt:   expiresAt,
      emailOtpAttempts:    0,
      emailOtpMaxAttempts: 5,
      emailOtpSentAt:      now,
      emailOtpPurpose:     '2fa_enable',
    },
  },
  { returnDocument: 'after' },
).select('emailOtpHash emailOtpPurpose emailOtpExpiresAt')

console.log('updated1:', {
  emailOtpHash:    updated1?.emailOtpHash,
  emailOtpPurpose: updated1?.emailOtpPurpose,
  hashMatch:       updated1?.emailOtpHash === otpHash,
  purposeMatch:    updated1?.emailOtpPurpose === '2fa_enable',
})

// === TEST 2: findByIdAndUpdate WITHOUT .select() ===
console.log('\n=== TEST 2: findByIdAndUpdate WITHOUT .select() ===')
const otpHash2 = 'sha256testhashabcdef999999999'
const updated2 = await TestUser.findByIdAndUpdate(
  doc._id,
  {
    $set: {
      emailOtpHash:    otpHash2,
      emailOtpPurpose: '2fa_enable',
    },
  },
  { returnDocument: 'after' },
)

console.log('updated2:', {
  emailOtpHash:    updated2?.emailOtpHash,
  emailOtpPurpose: updated2?.emailOtpPurpose,
  hashMatch:       updated2?.emailOtpHash === otpHash2,
  purposeMatch:    updated2?.emailOtpPurpose === '2fa_enable',
})

// === TEST 3: Verify by re-reading ===
console.log('\n=== TEST 3: Re-read from DB ===')
const reread = await TestUser.findById(doc._id).lean()
console.log('reread:', {
  emailOtpHash:    reread?.emailOtpHash,
  emailOtpPurpose: reread?.emailOtpPurpose,
  hashMatchOtp2:   reread?.emailOtpHash === otpHash2,
})

// Cleanup
await TestUser.deleteOne({ _id: doc._id })
console.log('\nCleaned up test doc')

await mongoose.disconnect()
console.log('\nDone.')
