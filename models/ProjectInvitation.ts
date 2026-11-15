import mongoose, { Document, Model, Schema } from 'mongoose'

export type InvitationStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'expired'

/** Valid forward state transitions for an invitation. */
export const VALID_TRANSITIONS: Record<InvitationStatus, InvitationStatus[]> = {
  pending:   ['accepted', 'declined', 'cancelled', 'expired'],
  accepted:  [],
  declined:  [],
  cancelled: [],
  expired:   [],
}

export interface IProjectInvitation extends Document {
  _id: mongoose.Types.ObjectId
  /** The project being shared */
  projectId: mongoose.Types.ObjectId
  /** ObjectId of the user sending the invitation (must be project owner or admin) */
  inviterId: mongoose.Types.ObjectId
  /** ObjectId of the LifeFlow account being invited */
  inviteeId: mongoose.Types.ObjectId
  /** Current lifecycle status */
  status: InvitationStatus
  /**
   * SHA-256 hash of the raw invitation token embedded in the email link.
   * Raw token is NEVER stored. Token is single-use and expires at expiresAt.
   * Null after the invitation is accepted / declined / cancelled (token consumed).
   */
  tokenHash: string | null
  /** UTC timestamp after which the token (and invitation) is expired */
  expiresAt: Date
  /** UTC timestamp when the invitee responded (accepted or declined) */
  respondedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const ProjectInvitationSchema = new Schema<IProjectInvitation>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    inviterId: { type: Schema.Types.ObjectId, ref: 'User',    required: true, index: true },
    inviteeId: { type: Schema.Types.ObjectId, ref: 'User',    required: true, index: true },
    status: {
      type:    String,
      enum:    ['pending', 'accepted', 'declined', 'cancelled', 'expired'],
      default: 'pending',
      index:   true,
    },
    tokenHash: {
      type:   String,
      default: null,
      index:  true,
      sparse: true,   // fast lookup during email-link acceptance
    },
    expiresAt:   { type: Date, required: true },
    respondedAt: { type: Date, default: null  },
  },
  { timestamps: true }
)

// Unique pending invitation per (project, invitee) — prevents duplicate sends.
// Uses a partial/sparse-style index so it only enforces uniqueness when
// status = 'pending' (MongoDB unique indexes span all values; we enforce the
// duplicate check in the application layer instead and keep this as a
// lookup-efficiency index).
ProjectInvitationSchema.index({ projectId: 1, inviteeId: 1, status: 1 })
ProjectInvitationSchema.index({ inviteeId: 1, status: 1, createdAt: -1 })
// TTL-style sweep index for expired pending invitations (background job or
// application-level expiry check on read)
ProjectInvitationSchema.index({ expiresAt: 1, status: 1 })

const ProjectInvitation: Model<IProjectInvitation> =
  mongoose.models.ProjectInvitation ||
  mongoose.model<IProjectInvitation>('ProjectInvitation', ProjectInvitationSchema)

export default ProjectInvitation
