/**
 * models/AdminUser.ts — Administrator account model.
 *
 * Stored in the same MongoDB database as regular User documents but in a
 * separate 'adminusers' collection so the two identity stores never mix.
 *
 * SECURITY INVARIANTS
 * ───────────────────
 * • passwordHash is NEVER returned to the client — use .select('-passwordHash').
 * • Only the bootstrap script (scripts/create-admin.mjs) may create the initial
 *   super_admin account.  All subsequent admins are created through the
 *   /api/admin/admins endpoint, which requires an authenticated super_admin.
 * • There must always be at least one active super_admin account.  The delete
 *   and deactivate endpoints enforce this invariant server-side.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'

// ── Role hierarchy ────────────────────────────────────────────────────────────
// super_admin  — full access including admin management and global settings
// admin        — full operational access, cannot manage other admins
// support      — read access to user data, can view tickets and audit logs
// auditor      — read-only access to audit logs and system health
export type AdminRole = 'super_admin' | 'admin' | 'support' | 'auditor'

export interface IAdminUser extends Document {
  _id: mongoose.Types.ObjectId
  name: string
  email: string
  /** bcryptjs hash — NEVER expose to clients */
  passwordHash: string
  role: AdminRole
  /** false = account is deactivated; cannot log in */
  isActive: boolean
  /** UTC timestamp of last successful login */
  lastLoginAt: Date | null
  /** UTC timestamp of last failed login attempt (for display only, no lockout here) */
  lastFailedLoginAt: Date | null
  /** ISO string of the creator's admin ID, or 'bootstrap' for the first account */
  createdBy: string
  /** Optional profile avatar URL. Null until the admin sets one. */
  avatar: string | null
  createdAt: Date
  updatedAt: Date
}

const AdminUserSchema = new Schema<IAdminUser>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 255,
    },
    passwordHash: {
      type: String,
      required: true,
      // NEVER expose this field — always project it away with .select('-passwordHash')
    },
    role: {
      type: String,
      enum: ['super_admin', 'admin', 'support', 'auditor'],
      default: 'admin',
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    lastFailedLoginAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: String,
      required: true,
      default: 'bootstrap',
    },
    avatar: {
      type: String,
      default: null,
      maxlength: 2048,
    },
  },
  {
    timestamps: true,
    collection: 'adminusers',  // explicit collection name — never collides with 'users'
  }
)

// Fast lookup by email during login is handled by the unique index
// automatically created by `unique: true` on the email schema field above.
// Do NOT add a separate AdminUserSchema.index({ email: 1 }) here — that would
// create a duplicate non-unique index alongside the unique one, which Mongoose
// warns about and MongoDB stores as redundant overhead.

const AdminUser: Model<IAdminUser> =
  mongoose.models.AdminUser ||
  mongoose.model<IAdminUser>('AdminUser', AdminUserSchema)

export default AdminUser
