import mongoose, { Document, Model, Schema } from 'mongoose'

// ─── Sub-document interfaces ───────────────────────────────────────────────

export interface IBillPerson {
  id: string
  name: string
  paidAmount: number // how much this person actually paid toward the bill
}

export interface IBillItem {
  id: string
  name: string
  price: number
  quantity: number
  assignedPeople: string[] // person ids
}

export interface ICustomSplit {
  personId: string
  value: number // fixed amount if splitMode=custom, percentage if customType=percent
  type: 'amount' | 'percent'
}

export interface ISettlement {
  fromPerson: string // person id
  toPerson: string // person id
  amount: number
  settled: boolean
}

export type SplitMode = 'item' | 'equal' | 'custom'

// ─── Main document interface ───────────────────────────────────────────────

export interface IGroupBill extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId // owner / creator (the "You" person)
  /** Owner's LifeFlow ID (LF-XXXXXXXX). Sourced from User.publicId at creation. */
  lifeFlowId: string
  name: string
  date: string // YYYY-MM-DD
  currency: string

  people: IBillPerson[]
  items: IBillItem[]

  splitMode: SplitMode
  customSplits: ICustomSplit[]

  // Additional charges (all optional, stored as numbers; 0 = disabled)
  discountType: 'amount' | 'percent'
  discountValue: number
  taxType: 'amount' | 'percent'
  taxValue: number
  serviceChargeType: 'amount' | 'percent'
  serviceChargeValue: number
  tipType: 'amount' | 'percent'
  tipValue: number

  // Computed totals (stored for history display)
  subtotal: number
  discountAmount: number
  taxAmount: number
  serviceChargeAmount: number
  tipAmount: number
  total: number

  settlements: ISettlement[]

  // Expense integration
  savedAsExpense: boolean
  expenseId?: mongoose.Types.ObjectId

  createdAt: Date
  updatedAt: Date
}

// ─── Schema ───────────────────────────────────────────────────────────────

const BillPersonSchema = new Schema<IBillPerson>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    paidAmount: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
)

const BillItemSchema = new Schema<IBillItem>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    assignedPeople: [{ type: String }],
  },
  { _id: false }
)

const CustomSplitSchema = new Schema<ICustomSplit>(
  {
    personId: { type: String, required: true },
    value: { type: Number, required: true, min: 0 },
    type: { type: String, enum: ['amount', 'percent'], default: 'amount' },
  },
  { _id: false }
)

const SettlementSchema = new Schema<ISettlement>(
  {
    fromPerson: { type: String, required: true },
    toPerson: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    settled: { type: Boolean, default: false },
  },
  { _id: false }
)

const GroupBillSchema = new Schema<IGroupBill>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    /** Owner's LifeFlow ID (LF-XXXXXXXX). Server-derived from authenticated session. */
    lifeFlowId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    date: { type: String, required: true },
    currency: { type: String, default: 'INR', maxlength: 5 },

    people: [BillPersonSchema],
    items: [BillItemSchema],

    splitMode: { type: String, enum: ['item', 'equal', 'custom'], default: 'equal' },
    customSplits: [CustomSplitSchema],

    discountType: { type: String, enum: ['amount', 'percent'], default: 'amount' },
    discountValue: { type: Number, default: 0, min: 0 },
    taxType: { type: String, enum: ['amount', 'percent'], default: 'percent' },
    taxValue: { type: Number, default: 0, min: 0 },
    serviceChargeType: { type: String, enum: ['amount', 'percent'], default: 'percent' },
    serviceChargeValue: { type: Number, default: 0, min: 0 },
    tipType: { type: String, enum: ['amount', 'percent'], default: 'amount' },
    tipValue: { type: Number, default: 0, min: 0 },

    subtotal: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    serviceChargeAmount: { type: Number, default: 0, min: 0 },
    tipAmount: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },

    settlements: [SettlementSchema],

    savedAsExpense: { type: Boolean, default: false },
    expenseId: { type: Schema.Types.ObjectId, ref: 'Expense' },
  },
  { timestamps: true }
)

GroupBillSchema.index({ userId: 1, date: -1 })

const GroupBill: Model<IGroupBill> =
  mongoose.models.GroupBill || mongoose.model<IGroupBill>('GroupBill', GroupBillSchema)

export default GroupBill
