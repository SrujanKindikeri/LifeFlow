import mongoose, { Document, Model, Schema } from 'mongoose'

export type MoneyDirection = 'given' | 'borrowed'
export type MoneyStatus = 'pending' | 'partially_paid' | 'paid' | 'overdue'

export interface IMoneyPerson {
  name: string
  phone?: string
  email?: string
  /**
   * The LifeFlow ID of the *contact* (the other party in the transaction),
   * if they have a registered LifeFlow account.
   * Renamed from `lifeFlowId` to avoid collision with the document-owner
   * `lifeFlowId` field on IMoneyRecord.
   */
  linkedLifeFlowId?: string
}

export interface IMoneyRecord extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  /** Owner's LifeFlow ID (LF-XXXXXXXX). Sourced from User.publicId at creation. */
  lifeFlowId: string

  person: IMoneyPerson
  direction: MoneyDirection

  /** Original amount in minor currency units (paise for INR). Never changes. */
  originalAmountMinor: number
  currency: string

  reason: string
  category?: string
  givenDate: string   // YYYY-MM-DD
  dueDate?: string    // YYYY-MM-DD — optional repayment deadline
  note?: string

  /** Computed & cached on every payment mutation. Source of truth is payments. */
  status: MoneyStatus

  createdAt: Date
  updatedAt: Date
}

const MoneyPersonSchema = new Schema<IMoneyPerson>(
  {
    name:             { type: String, required: true, trim: true, maxlength: 100 },
    phone:            { type: String, trim: true, maxlength: 20 },
    email:            { type: String, trim: true, maxlength: 200 },
    /**
     * Stored as `lifeFlowId` in MongoDB for backward compatibility with
     * existing documents. The TypeScript interface uses `linkedLifeFlowId`
     * to distinguish this contact-link field from the document-owner field.
     */
    linkedLifeFlowId: { type: String, trim: true, maxlength: 20 },
  },
  { _id: false }
)

const MoneyRecordSchema = new Schema<IMoneyRecord>(
  {
    userId:              { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Owner's LifeFlow ID (LF-XXXXXXXX). Server-derived from authenticated session. */
    lifeFlowId:          { type: String, required: true, index: true },
    person:              { type: MoneyPersonSchema, required: true },
    direction:           { type: String, enum: ['given', 'borrowed'], required: true },
    originalAmountMinor: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: 'Must be integer paise' } },
    currency:            { type: String, default: 'INR', maxlength: 5 },
    reason:              { type: String, required: true, trim: true, maxlength: 500 },
    category:            { type: String, trim: true, maxlength: 100 },
    givenDate:           { type: String, required: true },
    dueDate:             { type: String },
    note:                { type: String, trim: true, maxlength: 1000 },
    status:              { type: String, enum: ['pending', 'partially_paid', 'paid', 'overdue'], default: 'pending' },
  },
  { timestamps: true }
)

MoneyRecordSchema.index({ userId: 1, givenDate: -1 })
MoneyRecordSchema.index({ userId: 1, direction: 1, status: 1 })
MoneyRecordSchema.index({ userId: 1, 'person.name': 1 })

const MoneyRecord: Model<IMoneyRecord> =
  mongoose.models.MoneyRecord || mongoose.model<IMoneyRecord>('MoneyRecord', MoneyRecordSchema)

export default MoneyRecord
