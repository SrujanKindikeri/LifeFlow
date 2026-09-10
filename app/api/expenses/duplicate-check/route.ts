/**
 * POST /api/expenses/duplicate-check
 *
 * Checks whether a transaction the user is about to create likely already
 * exists as an expense.
 *
 * Body: { amount, date, referenceValue? }
 *   amount         — in rupees (float), same units as expense.amount
 *   date           — YYYY-MM-DD
 *   referenceValue — optional transaction/UTR reference string
 *
 * Returns: { duplicate: boolean, existing?: SerializedExpense }
 *
 * Matching logic (OR):
 *   1. Same userId + same amount + same date  (strong signal)
 *   2. Same userId + same transaction reference value in transactionCapture.references
 *
 * NOTE: This is a suggestion tool — the user may still create the expense if
 * they choose. Never block creation automatically.
 */

import { NextRequest } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Expense from '@/models/Expense'

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()
    const body = await req.json() as {
      amount?: unknown
      date?: unknown
      referenceValue?: unknown
    }

    const amount = typeof body.amount === 'number' ? body.amount : undefined
    const date   = typeof body.date   === 'string' ? body.date   : undefined
    const ref    = typeof body.referenceValue === 'string' ? body.referenceValue.trim() : undefined

    if (!amount || !date) {
      return Response.json({ error: 'amount and date are required' }, { status: 400 })
    }

    await connectDB()

    // Build OR query for duplicate matching
    const orConditions: Record<string, unknown>[] = [
      { userId, amount, date },
    ]

    if (ref && ref.length >= 6) {
      orConditions.push({
        userId,
        'transactionCapture.references.value': ref,
      })
    }

    const existing = await Expense.findOne({ $or: orConditions })
      .sort({ createdAt: -1 })
      .lean()

    if (!existing) {
      return Response.json({ duplicate: false })
    }

    // Serialize enough for the UI duplicate warning
    return Response.json({
      duplicate: true,
      existing: {
        _id:         existing._id.toString(),
        amount:      existing.amount,
        category:    existing.category,
        description: existing.description,
        date:        existing.date,
        paymentMethod: (existing as { paymentMethod?: string }).paymentMethod ?? undefined,
        createdAt:   existing.createdAt instanceof Date
          ? existing.createdAt.toISOString()
          : existing.createdAt,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[duplicate-check POST]', error instanceof Error ? error.message : error)
    return Response.json({ error: 'Failed to check for duplicates.' }, { status: 500 })
  }
}
