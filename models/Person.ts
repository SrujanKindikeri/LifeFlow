/**
 * People Directory — manually created person entries.
 *
 * A Person can be referenced by Money Tracker and Group Bills.
 * People in MoneyRecord.person are NOT automatically synced here;
 * the directory is an opt-in curated list.
 * The People Directory page aggregates data from MoneyRecord and
 * GroupBill to show relationships without duplication.
 */

import mongoose, { Document, Model, Schema } from 'mongoose'

export interface IPerson extends Document {
  _id: mongoose.Types.ObjectId
  /** MongoDB ObjectId of the LifeFlow user who owns this person entry. */
  userId: mongoose.Types.ObjectId
  /** Owner's LifeFlow ID (LF-XXXXXXXX). Sourced from User.publicId at creation. */
  lifeFlowId: string
  name: string
  phone?: string
  email?: string
  /**
   * The LifeFlow ID of the *contact* — the other person's registered LifeFlow
   * account, if they have one (e.g. "LF-7K29X4P1").
   * Renamed from `lifeFlowId` (the old optional field) to `linkedLifeFlowId`
   * to avoid collision with the document-owner `lifeFlowId` field above.
   */
  linkedLifeFlowId?: string
  notes?: string
  createdAt: Date
  updatedAt: Date
}

const PersonSchema = new Schema<IPerson>(
  {
    userId:          { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Owner's LifeFlow ID (LF-XXXXXXXX). Server-derived from authenticated session. */
    lifeFlowId:      { type: String, required: true, index: true },
    name:            { type: String, required: true, trim: true, maxlength: 100 },
    phone:           { type: String, trim: true, maxlength: 20 },
    email:           { type: String, trim: true, lowercase: true, maxlength: 200 },
    /**
     * Stored in MongoDB as `linkedLifeFlowId`.
     * This is the LifeFlow account of the contact, not the document owner.
     */
    linkedLifeFlowId: { type: String, trim: true, maxlength: 20 },
    notes:           { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
)

PersonSchema.index({ userId: 1, name: 1 })
PersonSchema.index({ userId: 1, createdAt: -1 })

const Person: Model<IPerson> =
  mongoose.models.Person || mongoose.model<IPerson>('Person', PersonSchema)

export default Person
