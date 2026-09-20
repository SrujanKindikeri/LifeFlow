import { z } from 'zod'

export const signupSchema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name is too long'),
    email: z.string().email('Invalid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

// ─── Password reset ───────────────────────────────────────────────────────────

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
})

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, 'Reset token is required'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput  = z.infer<typeof resetPasswordSchema>

export const noteSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100, 'Title is too long'),
  content: z.string().max(10000, 'Content is too long'),
  tags: z.array(z.string()).optional().default([]),
  pinned: z.boolean().optional().default(false),
  archived: z.boolean().optional().default(false),
})

export const taskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title is too long'),
  description: z.string().max(1000, 'Description is too long').optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  dueDate: z.string().optional(),
  dueTime: z.string().optional(),
  recurring: z.enum(['none', 'daily', 'weekly', 'monthly']).default('none'),
})

export const habitSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long'),
  icon: z.string().max(10, 'Icon is too long').optional().default('⭐'),
  description: z.string().max(500, 'Description is too long').optional(),
  frequency: z.enum(['daily', 'weekly']).default('daily'),
  target: z.number().int().min(1).max(100).default(1),
})

// ─── Transaction Capture sub-schemas ─────────────────────────────────────────

export const transactionReferenceSchema = z.object({
  value: z.string().min(1).max(100),
  type: z.enum(['UPI_REF', 'UPI_TRANSACTION_ID', 'UTR', 'TRANSACTION_ID', 'REFERENCE_NUMBER', 'OTHER']),
})

export const transactionProofSchema = z.object({
  fileId:     z.string().min(1),
  filename:   z.string().max(255),
  mimeType:   z.string().max(100),
  sizeBytes:  z.number().int().min(0),
  uploadedAt: z.string(),   // ISO date string from client
})

export const transactionCaptureSchema = z.object({
  amountMinor:      z.number().int().nonnegative().optional(),
  currency:         z.string().max(5).default('INR'),
  direction:        z.enum(['sent', 'received', 'unknown']).optional(),
  status:           z.enum(['successful', 'completed', 'paid', 'received', 'failed', 'pending', 'declined', 'unknown']).optional(),
  paidTo:           z.string().max(200).optional(),
  receivedFrom:     z.string().max(200).optional(),
  upiId:            z.string().max(200).optional(),
  phoneNumber:      z.string().max(20).optional(),
  bank:             z.string().max(200).optional(),
  provider:         z.string().max(100).optional(),
  references:       z.array(transactionReferenceSchema).default([]),
  transactionDate:  z.string().optional(),
  transactionTime:  z.string().optional(),
  extractedAt:      z.string(),   // ISO string
  extractionMethod: z.enum(['ocr_text', 'manual']).default('ocr_text'),
  multipleDetected: z.boolean().default(false),
  lowConfidence:    z.boolean().default(false),
  proofs:           z.array(transactionProofSchema).default([]),
})

export const expenseSchema = z.object({
  amount: z.number().positive('Amount must be positive').max(1000000, 'Amount is too large'),
  category: z.enum([
    'food',
    'transport',
    'shopping',
    'bills',
    'entertainment',
    'education',
    'health',
    'subscriptions',
    'other',
  ]),
  description: z.string().max(200, 'Description is too long').optional(),
  date: z.string().min(1, 'Date is required'),
  paymentMethod: z.enum(['upi', 'cash', 'card', 'net_banking', 'wallet', 'other']).optional(),
  transactionCapture: transactionCaptureSchema.optional(),
})

export const profileUpdateSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(50, 'Name is too long'),
  currency: z.string().max(5).default('INR'),
  timezone: z.string().max(50).default('Asia/Kolkata'),
})

// ─── Appearance preferences ───────────────────────────────────────────────────

export const appearancePreferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('light'),
  nightShiftEnabled: z.boolean().default(false),
  /** "HH:MM" 24-hour format */
  nightShiftStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format')
    .default('22:00'),
  /** "HH:MM" 24-hour format */
  nightShiftEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format')
    .default('07:00'),
  turnToneEnabled: z.boolean().default(true),
  /** Volume 0.0 – 1.0 */
  turnToneVolume: z.number().min(0).max(1).default(0.5),
})

export type AppearancePreferencesInput = z.infer<typeof appearancePreferencesSchema>

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    confirmNewPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: 'Passwords do not match',
    path: ['confirmNewPassword'],
  })

// ─── Group Bill ──────────────────────────────────────────────────────────────

const billPersonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Person name is required').max(100),
  paidAmount: z.number().min(0).default(0),
})

const billItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1, 'Item name is required').max(200),
  price: z.number().min(0, 'Price must be non-negative'),
  quantity: z.number().int().min(1).default(1),
  assignedPeople: z.array(z.string()).default([]),
})

const customSplitSchema = z.object({
  personId: z.string().min(1),
  value: z.number().min(0),
  type: z.enum(['amount', 'percent']),
})

const settlementSchema = z.object({
  fromPerson: z.string().min(1),
  toPerson: z.string().min(1),
  amount: z.number().min(0),
  settled: z.boolean().default(false),
})

export const groupBillSchema = z.object({
  name: z.string().min(1, 'Bill name is required').max(200),
  date: z.string().min(1, 'Date is required'),
  currency: z.string().max(5).default('INR'),

  people: z.array(billPersonSchema).min(1, 'At least one person is required').max(50),
  items: z.array(billItemSchema).default([]),

  splitMode: z.enum(['item', 'equal', 'custom']).default('equal'),
  customSplits: z.array(customSplitSchema).default([]),

  discountType: z.enum(['amount', 'percent']).default('amount'),
  discountValue: z.number().min(0).default(0),
  taxType: z.enum(['amount', 'percent']).default('percent'),
  taxValue: z.number().min(0).default(0),
  serviceChargeType: z.enum(['amount', 'percent']).default('percent'),
  serviceChargeValue: z.number().min(0).default(0),
  tipType: z.enum(['amount', 'percent']).default('amount'),
  tipValue: z.number().min(0).default(0),

  // Computed (optional on create, always stored)
  subtotal: z.number().min(0).default(0),
  discountAmount: z.number().min(0).default(0),
  taxAmount: z.number().min(0).default(0),
  serviceChargeAmount: z.number().min(0).default(0),
  tipAmount: z.number().min(0).default(0),
  total: z.number().min(0).default(0),

  settlements: z.array(settlementSchema).default([]),
})

export const groupBillUpdateSchema = groupBillSchema.partial().extend({
  savedAsExpense: z.boolean().optional(),
  expenseId: z.string().optional(),
})

export const markSettledSchema = z.object({
  fromPerson: z.string().min(1),
  toPerson: z.string().min(1),
})

export type GroupBillInput = z.infer<typeof groupBillSchema>
export type GroupBillUpdateInput = z.infer<typeof groupBillUpdateSchema>

// ─── Money Tracker ────────────────────────────────────────────────────────────

const moneyPersonSchema = z.object({
  name:             z.string().min(1, 'Person name is required').max(100),
  phone:            z.string().max(20).optional(),
  email:            z.string().email().max(200).optional().or(z.literal('')),
  /** The linked contact's LifeFlow account ID — optional, not the document owner. */
  linkedLifeFlowId: z.string().max(20).optional(),
})

export const moneyRecordSchema = z.object({
  person:    moneyPersonSchema,
  direction: z.enum(['given', 'borrowed']),
  /** Amount in rupees (display unit). Converted to paise server-side. */
  amount:    z.number().positive('Amount must be positive').max(10_000_000, 'Amount too large'),
  currency:  z.string().max(5).default('INR'),
  reason:    z.string().min(1, 'Reason is required').max(500),
  category:  z.string().max(100).optional(),
  givenDate: z.string().min(1, 'Date is required'),
  dueDate:   z.string().optional(),
  note:      z.string().max(1000).optional(),
})

export const moneyPaymentSchema = z.object({
  /** Amount in rupees (display unit). Converted to paise server-side. */
  amount:         z.number().positive('Payment amount must be positive').max(10_000_000),
  paymentDate:    z.string().min(1, 'Payment date is required'),
  note:           z.string().max(500).optional(),
  idempotencyKey: z.string().max(128).optional(),
})

export const moneyPaymentUpdateSchema = z.object({
  amount:      z.number().positive().max(10_000_000).optional(),
  paymentDate: z.string().optional(),
  note:        z.string().max(500).optional(),
})

export const moneyRecordUpdateSchema = moneyRecordSchema.partial()

/**
 * Validates the body of POST /api/money-records/[id]/add-amount.
 * `amount` is in rupees (display unit) — converted to paise server-side.
 */
export const moneyAddAmountSchema = z.object({
  /** Amount in rupees (display unit). Converted to paise server-side. */
  amount:  z.number().positive('Amount must be positive').max(10_000_000, 'Amount too large'),
  reason:  z.string().min(1, 'Reason is required').max(500),
  date:    z.string().min(1, 'Date is required'),
  note:    z.string().max(1000).optional(),
  /**
   * Idempotency key from the client (generated per submit attempt).
   * Prevents double-adds on network retry or accidental double-click.
   */
  idempotencyKey: z.string().max(128).optional(),
})

export type MoneyRecordInput      = z.infer<typeof moneyRecordSchema>
export type MoneyPaymentInput     = z.infer<typeof moneyPaymentSchema>
export type MoneyAddAmountInput   = z.infer<typeof moneyAddAmountSchema>

// ─── Legacy type exports ──────────────────────────────────────────────────────

export type SignupInput = z.infer<typeof signupSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type NoteInput = z.infer<typeof noteSchema>
export type TaskInput = z.infer<typeof taskSchema>
export type HabitInput = z.infer<typeof habitSchema>
export type ExpenseInput = z.infer<typeof expenseSchema>
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
