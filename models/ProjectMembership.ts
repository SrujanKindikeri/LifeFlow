import mongoose, { Document, Model, Schema } from 'mongoose'

export type MemberRole = 'owner' | 'member'

export interface IProjectMembership extends Document {
  _id: mongoose.Types.ObjectId
  projectId: mongoose.Types.ObjectId
  userId:    mongoose.Types.ObjectId
  /** Denormalised public ID for fast serialisation */
  lifeFlowId: string
  role:       MemberRole
  /** Invitation that resulted in this membership (null for owner record) */
  invitationId: mongoose.Types.ObjectId | null
  /** UTC timestamp when access was granted */
  joinedAt: Date
  createdAt: Date
  updatedAt: Date
}

const ProjectMembershipSchema = new Schema<IProjectMembership>(
  {
    projectId:    { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    userId:       { type: Schema.Types.ObjectId, ref: 'User',    required: true, index: true },
    lifeFlowId:   { type: String, required: true, index: true },
    role: {
      type:    String,
      enum:    ['owner', 'member'],
      default: 'member',
      index:   true,
    },
    invitationId: { type: Schema.Types.ObjectId, ref: 'ProjectInvitation', default: null },
    joinedAt:     { type: Date, default: () => new Date() },
  },
  { timestamps: true }
)

// Enforce: one membership record per (project, user)
ProjectMembershipSchema.index(
  { projectId: 1, userId: 1 },
  { unique: true, name: 'unique_project_member' }
)
ProjectMembershipSchema.index({ userId: 1, projectId: 1 })
ProjectMembershipSchema.index({ projectId: 1, role: 1 })

const ProjectMembership: Model<IProjectMembership> =
  mongoose.models.ProjectMembership ||
  mongoose.model<IProjectMembership>('ProjectMembership', ProjectMembershipSchema)

export default ProjectMembership
