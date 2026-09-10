import mongoose, { Document, Model, Schema } from 'mongoose'

export interface IMoneyPayment extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  moneyRecordId: mongoose.Types.ObjectId

  /** Payment amount in minor currency units (paise for INR). */
  amountMinor: number

  paymentDate: string  // YYYY-MM-DD
  note?: string

  /**
   * Idempotency key supplied by the client to prevent duplicate payments on
   * network retry. Unique per userId.
   */
  idempotencyKey?: string

  createdAt: Date
  updatedAt: Date
}

const MoneyPaymentSchema = new Schema<IMoneyPayment>(
  {
    userId:        { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    moneyRecordId: { type: Schema.Types.ObjectId, ref: 'MoneyRecord', required: true, index: true },
    amountMinor:   {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'Must be integer paise' },
    },
    paymentDate:     { type: String, required: true },
    note:            { type: String, trim: true, maxlength: 500 },
    idempotencyKey:  { type: String, sparse: true, maxlength: 128 },
  },
  { timestamps: true }
)

// Prevent duplicate idempotency keys per user
MoneyPaymentSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true })
MoneyPaymentSchema.index({ moneyRecordId: 1, paymentDate: -1 })

const MoneyPayment: Model<IMoneyPayment> =
  mongoose.models.MoneyPayment || mongoose.model<IMoneyPayment>('MoneyPayment', MoneyPaymentSchema)

export default MoneyPayment
