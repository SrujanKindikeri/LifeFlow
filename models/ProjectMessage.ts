import mongoose, { Document, Model, Schema } from 'mongoose'

export interface IProjectMessage extends Document {
  _id: mongoose.Types.ObjectId
  projectId: mongoose.Types.ObjectId
  senderId:  mongoose.Types.ObjectId
  /** Denormalised sender name for fast display (snapshot at send time) */
  senderName: string
  /** Denormalised sender LifeFlow ID for fast serialisation */
  senderLifeFlowId: string
  text: string
  /**
   * Client-generated idempotency key (UUID v4) — prevents duplicate messages
   * on network retries. Enforced via sparse unique index.
   */
  idempotencyKey: string
  /**
   * Whether the message has been soft-deleted.
   * Deleted messages show a "(message deleted)" placeholder but are not
   * removed from the collection so the chat timeline stays coherent.
   */
  deleted: boolean
  createdAt: Date
  updatedAt: Date
}

const ProjectMessageSchema = new Schema<IProjectMessage>(
  {
    projectId:        { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    senderId:         { type: Schema.Types.ObjectId, ref: 'User',    required: true, index: true },
    senderName:       { type: String, required: true, trim: true, maxlength: 50 },
    senderLifeFlowId: { type: String, required: true },
    text:             { type: String, required: true, trim: true, maxlength: 4000 },
    idempotencyKey: {
      type:    String,
      required: true,
      index:   true,
    },
    deleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
)

// Unique idempotency key per (project, sender) — prevents replayed messages
ProjectMessageSchema.index(
  { projectId: 1, idempotencyKey: 1 },
  { unique: true, name: 'unique_message_idempotency' }
)
// Pagination: newest-first within a project
ProjectMessageSchema.index({ projectId: 1, createdAt: -1 })
// Sender lookup
ProjectMessageSchema.index({ senderId: 1, createdAt: -1 })

const ProjectMessage: Model<IProjectMessage> =
  mongoose.models.ProjectMessage ||
  mongoose.model<IProjectMessage>('ProjectMessage', ProjectMessageSchema)

export default ProjectMessage
