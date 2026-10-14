import mongoose, { Document, Model, Schema } from 'mongoose'

export interface INote extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  /** Owner's LifeFlow ID (LF-XXXXXXXX). Sourced from User.publicId at creation. */
  lifeFlowId: string
  title: string
  content: string
  tags: string[]
  pinned: boolean
  archived: boolean
  /** Optional project association */
  projectId?: mongoose.Types.ObjectId
  /**
   * Optional reminder datetime (UTC). When set, the notification scheduler
   * sends a reminder at this exact UTC instant (within the grace window).
   * Set to null or omit to disable reminders for this note.
   * Example: user sets a reminder for "2026-10-15 at 09:00 IST"
   *   → stored as 2026-10-15T03:30:00.000Z
   */
  reminderAt?: Date | null
  /**
   * True once the reminder for this note has been delivered.
   * Prevents re-delivery if the scheduler runs again after the reminder fires.
   * Reset to false if the user updates reminderAt to a future time.
   */
  reminderSent: boolean
  /** Monotonically-increasing revision counter — incremented on every sync write. */
  serverRevision: number
  /** MutationId of the last accepted sync mutation — used as an idempotency key. */
  lastMutationId?: string
  createdAt: Date
  updatedAt: Date
}

const NoteSchema = new Schema<INote>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Owner's LifeFlow ID (LF-XXXXXXXX). Server-derived from authenticated session. */
    lifeFlowId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    content: { type: String, default: '', maxlength: 10000 },
    tags: [{ type: String, trim: true, maxlength: 30 }],
    pinned: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    reminderAt:   { type: Date, default: null },
    reminderSent: { type: Boolean, default: false },
    serverRevision: { type: Number, default: 0, index: false },
    lastMutationId: { type: String, index: true, sparse: true },
  },
  { timestamps: true }
)

NoteSchema.index({ userId: 1, createdAt: -1 })
NoteSchema.index({ userId: 1, pinned: -1 })
NoteSchema.index({ userId: 1, projectId: 1 })
// Sparse index to efficiently find notes with pending reminders
NoteSchema.index(
  { userId: 1, reminderAt: 1 },
  { sparse: true, name: 'note_reminder_pending' }
)

const Note: Model<INote> =
  mongoose.models.Note || mongoose.model<INote>('Note', NoteSchema)

export default Note
