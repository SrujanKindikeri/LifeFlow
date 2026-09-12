/**
 * tests/helpers/factories.ts
 * Minimal test-data factories — create real Mongoose documents in memory.
 */

import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import User, { generatePublicId } from '@/models/User'
import type { IUser } from '@/models/User'
import Note from '@/models/Note'
import Task from '@/models/Task'
import Expense from '@/models/Expense'
import Bill from '@/models/GroupBill'
import Subscription from '@/models/Subscription'
import SavingsGoal from '@/models/SavingsGoal'

export async function createUser(overrides: Partial<{
  name: string
  email: string
  password: string
  publicId: string
}> = {}): Promise<IUser> {
  const publicId = overrides.publicId ?? generatePublicId()
  const passwordHash = await bcrypt.hash(overrides.password ?? 'Test1234!', 10)
  return User.create({
    name: overrides.name ?? 'Test User',
    email: overrides.email ?? `user-${publicId}@example.com`,
    passwordHash,
    publicId,
    emailVerified: true,
    emailVerificationTokenHash: null,
    emailVerificationExpiresAt: null,
    twoFactorEnabled: false,
    twoFactorSecretEncrypted: null,
    twoFactorVerifiedAt: null,
    twoFactorRecoveryCodeHashes: [],
  })
}

export async function createNote(userId: mongoose.Types.ObjectId, lifeFlowId: string) {
  return Note.create({ userId, lifeFlowId, title: 'Test Note', content: 'Hello' })
}

export async function createTask(userId: mongoose.Types.ObjectId, lifeFlowId: string) {
  return Task.create({ userId, lifeFlowId, title: 'Test Task', priority: 'medium', recurring: 'none' })
}

export async function createExpense(userId: mongoose.Types.ObjectId, lifeFlowId: string) {
  return Expense.create({
    userId, lifeFlowId,
    amount: 100,
    category: 'food',
    date: '2026-01-01',
    source: 'personal',
  })
}

export async function createBill(userId: mongoose.Types.ObjectId, lifeFlowId: string) {
  return Bill.create({
    userId, lifeFlowId,
    name: 'Test Bill', date: '2026-01-01', currency: 'INR',
    people: [], items: [], splitMode: 'equal', customSplits: [],
    discountType: 'amount', discountValue: 0,
    taxType: 'percent', taxValue: 0,
    serviceChargeType: 'percent', serviceChargeValue: 0,
    tipType: 'amount', tipValue: 0,
    subtotal: 0, discountAmount: 0, taxAmount: 0,
    serviceChargeAmount: 0, tipAmount: 0, total: 0,
    settlements: [], savedAsExpense: false,
  })
}

export async function createSubscription(userId: mongoose.Types.ObjectId, lifeFlowId: string) {
  return Subscription.create({
    userId, lifeFlowId,
    serviceName: 'Netflix', amountMinor: 49900, currency: 'INR',
    billingCycle: 'monthly', nextBillingDate: '2026-12-01',
    category: 'streaming', status: 'active', autoCreateExpense: false,
  })
}

export async function createSavingsGoal(userId: mongoose.Types.ObjectId, lifeFlowId: string) {
  return SavingsGoal.create({
    userId, lifeFlowId,
    title: 'Emergency Fund', targetAmountMinor: 500000, currency: 'INR',
  })
}
