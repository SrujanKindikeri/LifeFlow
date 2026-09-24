// Serialized versions of the Mongoose models (safe to pass to client components)

export type AppTheme = 'light' | 'dark' | 'system'

export interface AppearancePreferences {
  theme: AppTheme
  nightShiftEnabled: boolean
  nightShiftStart: string  // "HH:MM" 24-hour format
  nightShiftEnd: string    // "HH:MM" 24-hour format
  turnToneEnabled: boolean
  turnToneVolume: number   // 0–1
}

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  theme: 'light',
  nightShiftEnabled: false,
  nightShiftStart: '22:00',
  nightShiftEnd: '07:00',
  turnToneEnabled: true,
  turnToneVolume: 0.5,
}

export interface User {
  _id: string
  publicId: string // LF-XXXXXXXX
  name: string
  email: string
  avatar?: string
  currency: string
  timezone: string
  notificationPreferences: {
    habitReminders: boolean
    taskReminders: boolean
    spendingAlerts: boolean
    dailySummary: boolean
  }
  /**
   * Per-category email notification preferences.
   * emailNotifications.enabled is the master toggle.
   * Category flags are only evaluated when enabled is true.
   */
  emailNotifications: {
    enabled: boolean
    taskReminders: boolean
    habitReminders: boolean
    spendingAlerts: boolean
    dailySummary: boolean
    weeklySummary: boolean
  }
  /**
   * True once the user has successfully received a test notification email.
   * The scheduler only sends regular Gmail notifications to users where this
   * is true AND emailNotifications.enabled is true.
   */
  notificationsTested: boolean
  /** UTC ISO string when notificationsTested was set to true, or null. */
  notificationsTestedAt: string | null
  /** Appearance & experience preferences — always present with safe defaults. */
  appearancePreferences: AppearancePreferences
  // ── Account lifecycle (soft-delete) ─────────────────────────────────────
  /** "active" = normal; "deleted" = within 30-day recovery window. */
  accountStatus: 'active' | 'deleted'
  /** ISO string of soft-deletion timestamp, or null for active accounts. */
  deletedAt: string | null
  /** ISO string of scheduled permanent-deletion date, or null. */
  scheduledPermanentDeletionAt: string | null
  // ── Email OTP Two-Factor Authentication ──────────────────────────────────
  /** Whether Email OTP 2FA is active for this account. */
  emailOtpEnabled: boolean
  /** ISO string of when Email 2FA was enabled, or null. */
  twoFactorEnabledAt: string | null
  /**
   * UPI ID for payment identification.
   * Displayed in Group Bill reminder emails as the payment destination.
   * Not a secret — safe to display. Only the account owner can edit it.
   * null means not configured; always present in the API response (never undefined).
   */
  upiId: string | null
  createdAt: string
  updatedAt: string
}

export interface Note {
  _id: string
  userId: string
  title: string
  content: string
  tags: string[]
  pinned: boolean
  archived: boolean
  createdAt: string
  updatedAt: string
}

export interface Task {
  _id: string
  userId: string
  title: string
  description?: string
  completed: boolean
  priority: 'low' | 'medium' | 'high'
  dueDate?: string
  dueTime?: string
  recurring: 'none' | 'daily' | 'weekly' | 'monthly'
  createdAt: string
  updatedAt: string
}

export interface Habit {
  _id: string
  userId: string
  name: string
  icon: string
  description?: string
  frequency: 'daily' | 'weekly'
  target: number
  createdAt: string
  updatedAt: string
}

export interface HabitLog {
  _id: string
  userId: string
  habitId: string
  date: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

export type ExpenseCategory =
  | 'food'
  | 'transport'
  | 'shopping'
  | 'bills'
  | 'entertainment'
  | 'education'
  | 'health'
  | 'subscriptions'
  | 'other'

export type ExpenseSource = 'personal' | 'group_bill' | 'subscription'

export type PaymentMethod = 'upi' | 'cash' | 'card' | 'net_banking' | 'wallet' | 'other'

export type TransactionDirection = 'sent' | 'received' | 'unknown'

export type TransactionStatus =
  | 'successful'
  | 'completed'
  | 'paid'
  | 'received'
  | 'failed'
  | 'pending'
  | 'declined'
  | 'unknown'

export type TransactionReferenceType =
  | 'UPI_REF'
  | 'UPI_TRANSACTION_ID'
  | 'UTR'
  | 'TRANSACTION_ID'
  | 'REFERENCE_NUMBER'
  | 'OTHER'

export interface TransactionReference {
  value: string
  type: TransactionReferenceType
}

export interface TransactionProofMeta {
  fileId: string
  filename: string
  mimeType: string
  sizeBytes: number
  uploadedAt: string
}

export interface TransactionCapture {
  amountMinor?: number
  currency: string
  direction?: TransactionDirection
  status?: TransactionStatus
  paidTo?: string
  receivedFrom?: string
  upiId?: string
  phoneNumber?: string
  bank?: string
  /** Payment provider app/wallet name (e.g. 'PhonePe', 'Paytm'). Distinct from paymentMethod='upi'. */
  provider?: string
  references: TransactionReference[]
  transactionDate?: string
  transactionTime?: string
  extractedAt: string
  extractionMethod: 'ocr_text' | 'manual'
  multipleDetected: boolean
  lowConfidence: boolean
  proofs: TransactionProofMeta[]
}

export interface Expense {
  _id: string
  userId: string
  amount: number
  category: ExpenseCategory
  description?: string
  date: string
  paymentMethod?: PaymentMethod
  /** Always 'personal' for manually added expenses. 'group_bill' when created via "Add my share to Personal Spending". 'subscription' when auto-generated by the subscription scheduler. */
  source: ExpenseSource
  /** Populated only when source === 'group_bill'. Points to the originating GroupBill. */
  sourceGroupBillId?: string
  /** Populated only when source === 'subscription'. Points to the originating Subscription. */
  sourceSubscriptionId?: string
  /** The billing date this expense was generated for (YYYY-MM-DD). Only set when source === 'subscription'. */
  subscriptionBillingDate?: string
  /** Smart Transaction Capture data — only present when added via screenshot. */
  transactionCapture?: TransactionCapture
  createdAt: string
  updatedAt: string
}

export interface Notification {
  _id: string
  userId: string
  title: string
  message: string
  type: 'habit' | 'task' | 'expense' | 'general' | 'reminder'
  read: boolean
  createdAt: string
}

export type NotificationDeliveryStatus = 'pending' | 'processing' | 'sent_to_smtp' | 'failed'

export type ScheduledNotificationType =
  | 'TASK_TOMORROW'
  | 'TASK_INCOMPLETE_TODAY'
  | 'TASK_DUE_SOON'
  | 'HABIT_TOMORROW'
  | 'HABIT_REMINDER'
  | 'SPENDING_ALERT'
  | 'DAILY_SUMMARY'
  | 'WEEKLY_SUMMARY'
  | 'MORNING_BRIEF'

/**
 * A serialised NotificationLog entry returned by GET /api/notifications/history.
 * Contains the full delivery lifecycle plus a snapshot of what was actually sent.
 * Excludes errorMessage (too sensitive for normal users) and all server secrets.
 */
export interface NotificationHistoryEntry {
  _id: string
  type: ScheduledNotificationType
  /** Human-readable label, e.g. "Morning Daily Brief" */
  typeLabel: string
  /** ISO string of when this notification was scheduled to fire (user's local time → UTC) */
  scheduledAt: string
  /** ISO string of when it was handed to SMTP. Null if not yet sent. */
  sentAt: string | null
  status: NotificationDeliveryStatus
  /** Short preview text, ≤200 chars */
  contentPreview: string
  /** The email subject that was sent. Null for pre-history records. */
  emailSubject: string | null
  /**
   * Plain-text snapshot of the email body at send time (≤2000 chars).
   * Used to display "what was sent" in the detail view without re-generating.
   * Null for pre-history records or non-email notifications.
   */
  emailBodySnapshot: string | null
  /** Logical calendar date this notification applies to (YYYY-MM-DD) */
  forDate: string
  /** ISO string of when the log record was created */
  createdAt: string
}

export interface NotificationHistoryPage {
  history: NotificationHistoryEntry[]
  /** Total matching records across all pages */
  total: number
  /** Current page (1-indexed) */
  page: number
  /** Records per page */
  limit: number
  /** Whether there are more pages */
  hasMore: boolean
}

// ─── Group Bill types ─────────────────────────────────────────────────────────

export interface BillPerson {
  id: string
  name: string
  paidAmount: number
}

export interface BillItem {
  id: string
  name: string
  price: number
  quantity: number
  assignedPeople: string[]
}

export interface CustomSplit {
  personId: string
  value: number
  type: 'amount' | 'percent'
}

export interface Settlement {
  fromPerson: string
  toPerson: string
  amount: number
  settled: boolean
}

export interface GroupBill {
  _id: string
  userId: string
  name: string
  date: string
  currency: string
  people: BillPerson[]
  items: BillItem[]
  splitMode: 'item' | 'equal' | 'custom'
  customSplits: CustomSplit[]
  discountType: 'amount' | 'percent'
  discountValue: number
  taxType: 'amount' | 'percent'
  taxValue: number
  serviceChargeType: 'amount' | 'percent'
  serviceChargeValue: number
  tipType: 'amount' | 'percent'
  tipValue: number
  subtotal: number
  discountAmount: number
  taxAmount: number
  serviceChargeAmount: number
  tipAmount: number
  total: number
  settlements: Settlement[]
  savedAsExpense: boolean
  expenseId?: string
  createdAt: string
  updatedAt: string
}

// ─── Money Tracker ────────────────────────────────────────────────────────────

export type MoneyDirection = 'given' | 'borrowed'
export type MoneyStatus = 'pending' | 'partially_paid' | 'paid' | 'overdue'

export interface MoneyPerson {
  name: string
  phone?: string
  email?: string
  lifeFlowId?: string
}

export interface MoneyRecord {
  _id: string
  userId: string
  person: MoneyPerson
  direction: MoneyDirection
  /** Original amount in minor currency units (paise). Never mutated after creation. */
  originalAmountMinor: number
  currency: string
  reason: string
  category?: string
  givenDate: string   // YYYY-MM-DD
  dueDate?: string    // YYYY-MM-DD
  note?: string
  status: MoneyStatus
  createdAt: string
  updatedAt: string
}

export interface MoneyPayment {
  _id: string
  userId: string
  moneyRecordId: string
  /** Payment amount in minor currency units (paise). */
  amountMinor: number
  paymentDate: string  // YYYY-MM-DD
  note?: string
  createdAt: string
  updatedAt: string
}

/** A MoneyRecord enriched with computed payment totals — returned by the API. */
export interface MoneyRecordWithBalance extends MoneyRecord {
  paidMinor: number
  remainingMinor: number
  payments: MoneyPayment[]
}

// ─── Session / Dashboard ──────────────────────────────────────────────────────

export interface SessionUser {
  userId: string
  name: string
  email: string
  isLoggedIn: boolean
}

export interface DashboardStats {
  tasksTotal: number
  tasksCompleted: number
  habitsTotal: number
  habitsCompleted: number
  todaySpending: number
  currentStreak: number
  bestStreak: number
  topExpenseCategory: string
}

