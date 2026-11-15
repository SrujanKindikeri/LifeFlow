#!/usr/bin/env node
/**
 * scripts/create-admin.mjs
 *
 * Secure bootstrap script to create the initial super_admin account.
 * Must be run on the server, never via the web interface.
 *
 * Usage:
 *   node scripts/create-admin.mjs --name "Admin Name" --email admin@example.com --password "YourSecurePassword123!"
 *
 * Or with environment variables:
 *   ADMIN_NAME="Admin Name" ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD="pass" node scripts/create-admin.mjs
 *
 * Required env vars (in .env.local or environment):
 *   MONGODB_URI
 *   MONGODB_DB_NAME  (default: test)
 *
 * The script is idempotent: running it again with the same email updates the password
 * and reactivates the account rather than creating a duplicate.
 */

import { createRequire } from 'module'
import { parseArgs }     from 'util'
import readline          from 'readline'

const require = createRequire(import.meta.url)

// ── Load env from .env.local if dotenv is available ────────────────────────────
try {
  const dotenv = require('dotenv')
  dotenv.config({ path: '.env.local' })
  dotenv.config({ path: '.env' })
} catch {
  // dotenv not installed — rely on environment variables being set manually
}

const mongoose = require('mongoose')
const bcrypt   = require('bcryptjs')

// ── Arg parsing ────────────────────────────────────────────────────────────────
const { values } = parseArgs({
  options: {
    name:     { type: 'string' },
    email:    { type: 'string' },
    password: { type: 'string' },
    role:     { type: 'string', default: 'super_admin' },
    help:     { type: 'boolean', short: 'h' },
  },
  strict: false,
})

if (values.help) {
  console.log(`
LifeFlow Admin Bootstrap Script
Usage:
  node scripts/create-admin.mjs [options]

Options:
  --name      Full name of the administrator
  --email     Email address
  --password  Password (min 12 characters)
  --role      Role: super_admin | admin | support | auditor  (default: super_admin)
  --help      Show this help

Environment variables (fallback if flags not provided):
  ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD
  MONGODB_URI, MONGODB_DB_NAME
`)
  process.exit(0)
}

// ── Read from env if not provided as args ─────────────────────────────────────
const name     = values.name     || process.env.ADMIN_NAME
const email    = values.email    || process.env.ADMIN_EMAIL
const password = values.password || process.env.ADMIN_PASSWORD
const role     = values.role     || 'super_admin'

// ── Interactive prompts for missing values ────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q) => new Promise((res) => rl.question(q, res))

async function getValues() {
  let n = name, e = email, p = password

  if (!n) n = await ask('Administrator name: ')
  if (!e) e = await ask('Administrator email: ')
  if (!p) p = await ask('Password (min 12 chars): ')

  rl.close()
  return { n: n.trim(), e: e.toLowerCase().trim(), p }
}

async function main() {
  const { n, e, p } = await getValues()

  if (!n || !e || !p) {
    console.error('❌ Name, email, and password are all required.')
    process.exit(1)
  }

  if (p.length < 12) {
    console.error('❌ Password must be at least 12 characters.')
    process.exit(1)
  }

  const allowedRoles = ['super_admin', 'admin', 'support', 'auditor']
  if (!allowedRoles.includes(role)) {
    console.error(`❌ Invalid role. Must be one of: ${allowedRoles.join(', ')}`)
    process.exit(1)
  }

  const uri    = process.env.MONGODB_URI
  const dbName = process.env.MONGODB_DB_NAME ?? 'test'

  if (!uri) {
    console.error('❌ MONGODB_URI is not set. Add it to .env.local or the environment.')
    process.exit(1)
  }

  console.log('\n🔗 Connecting to MongoDB…')

  try {
    await mongoose.connect(uri, { dbName, family: 4, serverSelectionTimeoutMS: 15000 })
    console.log(`✓ Connected to database: ${mongoose.connection.db?.databaseName}`)
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message)
    process.exit(1)
  }

  // Define AdminUser inline (avoids TypeScript compilation requirement)
  const AdminUserSchema = new mongoose.Schema({
    name:                { type: String, required: true, trim: true },
    email:               { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash:        { type: String, required: true },
    role:                { type: String, enum: ['super_admin','admin','support','auditor'], default: 'admin' },
    isActive:            { type: Boolean, default: true },
    lastLoginAt:         { type: Date, default: null },
    lastFailedLoginAt:   { type: Date, default: null },
    createdBy:           { type: String, default: 'bootstrap' },
  }, { timestamps: true, collection: 'adminusers' })

  const AdminUser = mongoose.models.AdminUser ||
    mongoose.model('AdminUser', AdminUserSchema)

  console.log('🔒 Hashing password…')
  const passwordHash = await bcrypt.hash(p, 12)

  // Check for existing account
  const existing = await AdminUser.findOne({ email: e })

  if (existing) {
    console.log(`⚠  An administrator with email '${e}' already exists.`)
    console.log('   Updating password and reactivating account…')
    existing.name         = n
    existing.passwordHash = passwordHash
    existing.role         = role
    existing.isActive     = true
    existing.createdBy    = 'bootstrap'
    await existing.save()
    console.log(`✅ Administrator '${n}' updated successfully.`)
  } else {
    await AdminUser.create({
      name: n, email: e, passwordHash,
      role, isActive: true, createdBy: 'bootstrap',
    })
    console.log(`✅ Administrator '${n}' created successfully.`)
  }

  console.log(`
  Email:  ${e}
  Role:   ${role}
  Login:  <your-app-url>/admin/login
`)

  await mongoose.connection.close()
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err.message)
  process.exit(1)
})
