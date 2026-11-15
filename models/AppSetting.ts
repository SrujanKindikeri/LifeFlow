/**
 * models/AppSetting.ts — Application-level configuration store.
 *
 * Stores safe, non-secret configuration that administrators can adjust at
 * runtime without a deployment.  This is NOT a secret store — secrets must
 * always live in environment variables, never in this collection.
 *
 * The collection is keyed by a string `key` field (unique).  Each entry has
 * a typed value and a description for display in the Settings UI.
 *
 * SAFE SETTINGS ONLY
 * ──────────────────
 * Never store: passwords, API keys, SMTP credentials, session secrets,
 * VAPID keys, or any value that would harm the application if exposed.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'

export type SettingValueType = 'string' | 'number' | 'boolean' | 'json'

export interface IAppSetting extends Document {
  _id: mongoose.Types.ObjectId
  /** Machine-readable key, e.g. 'maintenance_mode', 'signup_enabled' */
  key: string
  /** Human-readable label for the Settings UI */
  label: string
  /** Description shown below the field in the Settings UI */
  description: string
  /** The current value — always stored as string, cast by valueType */
  value: string
  /** How to interpret and validate the value field */
  valueType: SettingValueType
  /** If true, the setting is read-only in the UI (managed elsewhere) */
  readOnly: boolean
  /** Last admin ID that changed this setting */
  lastChangedBy: string | null
  createdAt: Date
  updatedAt: Date
}

const AppSettingSchema = new Schema<IAppSetting>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 100,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      default: '',
      maxlength: 500,
    },
    value: {
      type: String,
      required: true,
      maxlength: 5000,
    },
    valueType: {
      type: String,
      enum: ['string', 'number', 'boolean', 'json'],
      default: 'string',
    },
    readOnly: {
      type: Boolean,
      default: false,
    },
    lastChangedBy: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'appsettings',
  }
)

const AppSetting: Model<IAppSetting> =
  mongoose.models.AppSetting ||
  mongoose.model<IAppSetting>('AppSetting', AppSettingSchema)

export default AppSetting

// ── Default settings seeded at bootstrap ─────────────────────────────────────
export const DEFAULT_SETTINGS: Omit<IAppSetting, '_id' | 'createdAt' | 'updatedAt' | keyof Document>[] = [
  {
    key: 'maintenance_mode',
    label: 'Maintenance Mode',
    description: 'When enabled, all non-admin users see a maintenance page instead of the app. Administrators can still sign in and manage settings.',
    value: 'false',
    valueType: 'boolean',
    readOnly: false,
    lastChangedBy: null,
  },
  {
    key: 'signup_enabled',
    label: 'User Sign-up Enabled',
    description: 'When disabled, new user registrations are blocked server-side. Existing users can still sign in, reset passwords, and use the app normally.',
    value: 'true',
    valueType: 'boolean',
    readOnly: false,
    lastChangedBy: null,
  },
  {
    key: 'max_users',
    label: 'Maximum Users',
    description: 'Maximum number of registered (non-deleted) user accounts allowed. Set to 0 for unlimited registrations. Must be a non-negative integer.',
    value: '0',
    valueType: 'number',
    readOnly: false,
    lastChangedBy: null,
  },
  {
    key: 'notification_scheduler_enabled',
    label: 'Notification Scheduler',
    description: 'Master switch for the scheduled notification worker. When disabled, no new scheduled notifications are enqueued or processed. Pending records are preserved and delivery resumes when re-enabled.',
    value: 'true',
    valueType: 'boolean',
    readOnly: false,
    lastChangedBy: null,
  },
  {
    key: 'app_version',
    label: 'Application Version',
    description: 'The currently running application version, derived from package.json at build time. This is read-only and cannot be changed through the settings form.',
    value: process.env.npm_package_version ?? '0.1.0',
    valueType: 'string',
    readOnly: true,
    lastChangedBy: null,
  },
]

// ── Server-side value validators ──────────────────────────────────────────────

/**
 * Validate a raw string value for a given setting key and valueType.
 * Returns null on success, or an error message string on failure.
 *
 * Called by the PATCH handler before any DB write.
 */
export function validateSettingValue(
  key: string,
  value: string,
  valueType: SettingValueType,
): string | null {
  if (valueType === 'boolean') {
    if (value !== 'true' && value !== 'false') {
      return `Setting '${key}' must be "true" or "false".`
    }
    return null
  }

  if (valueType === 'number') {
    // max_users: must be a non-negative integer (no decimals, no negatives)
    if (key === 'max_users') {
      // Reject anything that isn't a plain non-negative integer string
      if (!/^\d+$/.test(value.trim())) {
        return 'max_users must be a non-negative integer (e.g. 0 for unlimited, 100 to cap at 100 users).'
      }
      const n = parseInt(value.trim(), 10)
      if (n < 0) {
        return 'max_users cannot be negative.'
      }
      // Guard against absurdly large values that could overflow counters
      if (n > 10_000_000) {
        return 'max_users cannot exceed 10,000,000.'
      }
      return null
    }
    // Generic number setting
    if (isNaN(Number(value))) {
      return `Setting '${key}' must be a valid number.`
    }
    return null
  }

  if (valueType === 'json') {
    try {
      JSON.parse(value)
      return null
    } catch {
      return `Setting '${key}' must be valid JSON.`
    }
  }

  // 'string' — no additional constraints beyond the schema maxlength
  return null
}
