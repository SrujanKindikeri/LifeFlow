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
  },
  { timestamps: true }
)

NoteSchema.index({ userId: 1, createdAt: -1 })
NoteSchema.index({ userId: 1, pinned: -1 })
NoteSchema.index({ userId: 1, projectId: 1 })

const Note: Model<INote> =
  mongoose.models.Note || mongoose.model<INote>('Note', NoteSchema)

export default Note
