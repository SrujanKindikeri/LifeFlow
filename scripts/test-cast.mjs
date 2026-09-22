// Temporary test script — delete after investigation
import mongoose from '../node_modules/mongoose/index.js'

const schema = new mongoose.Schema({
  emailOtpHash: { type: String, default: null },
  emailOtpPurpose: {
    type: String,
    enum: ['2fa_enable', '2fa_login', '2fa_disable', null],
    default: null,
  },
  emailOtpAttempts: { type: Number, default: 0 },
  emailOtpMaxAttempts: { type: Number, default: 5 },
  emailOtpExpiresAt: { type: Date, default: null },
  emailOtpSentAt: { type: Date, default: null },
})

// Use a temp name to avoid model-already-exists error
const M = mongoose.model('TestCastModel', schema, 'test_col')

const update = {
  $set: {
    emailOtpHash: 'abc123hash',
    emailOtpExpiresAt: new Date(Date.now() + 600000),
    emailOtpAttempts: 0,
    emailOtpMaxAttempts: 5,
    emailOtpSentAt: new Date(),
    emailOtpPurpose: '2fa_enable',
  },
}

const q = M.findByIdAndUpdate(new mongoose.Types.ObjectId(), update, { returnDocument: 'after' })

try {
  const castResult = q._castUpdate(q._update)
  console.log('Cast result:', JSON.stringify(castResult, null, 2))
} catch (e) {
  console.log('Cast ERROR:', e.message)
  console.log(e)
}

// Also test the select chain
const q2 = M.findByIdAndUpdate(new mongoose.Types.ObjectId(), update, { returnDocument: 'after' })
  .select('emailOtpHash emailOtpPurpose emailOtpExpiresAt userId')

console.log('q2._fields:', q2._fields)
console.log('q2.options:', JSON.stringify(q2.options))
