/**
 * GET /api/search?q=<query>
 *
 * Server-side full-text search across the authenticated user's own data.
 * Searches: Notes, Tasks, Habits, Expenses, GroupBills.
 *
 * Security: ONLY queries data owned by the authenticated user.
 * Never trusts userId from the request — always reads from the session.
 *
 * Performance:
 * - Uses MongoDB regex queries (case-insensitive) on indexed fields.
 * - All five collection queries run in parallel via Promise.all.
 * - Results are capped per collection to avoid oversized responses.
 * - Query is trimmed and validated before hitting the DB.
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Note from '@/models/Note'
import Task from '@/models/Task'
import Habit from '@/models/Habit'
import Expense from '@/models/Expense'
import GroupBill from '@/models/GroupBill'
import MoneyRecord from '@/models/MoneyRecord'
import MoneyPayment from '@/models/MoneyPayment'
import { calcBalance } from '@/lib/moneyCalculator'
import type { IMoneyRecord } from '@/models/MoneyRecord'
import type { IMoneyPayment } from '@/models/MoneyPayment'

// ─── Result types ─────────────────────────────────────────────────────────────

export interface SearchResult {
  _id: string
  type: 'note' | 'task' | 'habit' | 'expense' | 'groupBill' | 'moneyRecord'
  title: string
  subtitle?: string
  href: string
}

// ─── GET handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth()

    const { searchParams } = new URL(req.url)
    const raw = searchParams.get('q') ?? ''
    const q = raw.trim().slice(0, 100) // sanitise: max 100 chars

    if (q.length < 1) {
      return NextResponse.json({ results: [], query: q })
    }

    await connectDB()

    // Escape special regex chars to avoid injection
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'i')

    // Run all searches in parallel — each is scoped to userId
    const [notes, tasks, habits, expenses, groupBills, moneyRecords] = await Promise.all([
      Note.find({
        userId,
        archived: false,
        $or: [
          { title: regex },
          { content: regex },
          { tags: regex },
        ],
      })
        .sort({ updatedAt: -1 })
        .limit(5)
        .select('_id title content tags updatedAt')
        .lean(),

      Task.find({
        userId,
        $or: [
          { title: regex },
          { description: regex },
        ],
      })
        .sort({ dueDate: 1, createdAt: -1 })
        .limit(5)
        .select('_id title description priority dueDate completed')
        .lean(),

      Habit.find({
        userId,
        $or: [
          { name: regex },
          { description: regex },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('_id name icon description')
        .lean(),

      Expense.find({
        userId,
        $or: [
          { description: regex },
          { category: regex },
        ],
      })
        .sort({ date: -1 })
        .limit(5)
        .select('_id description category amount date')
        .lean(),

      GroupBill.find({
        userId,
        $or: [
          { name: regex },
          { 'people.name': regex },
        ],
      })
        .sort({ date: -1 })
        .limit(5)
        .select('_id name date total currency people')
        .lean(),

      MoneyRecord.find({
        userId,
        $or: [
          { 'person.name': regex },
          { reason: regex },
          { note: regex },
        ],
      })
        .sort({ givenDate: -1 })
        .limit(5)
        .select('_id person direction originalAmountMinor currency reason givenDate status')
        .lean(),
    ])

    // ── Serialise results ─────────────────────────────────────────────────────

    const results: SearchResult[] = []

    for (const n of notes) {
      results.push({
        _id: n._id.toString(),
        type: 'note',
        title: n.title,
        subtitle: n.content ? n.content.slice(0, 80) : undefined,
        href: '/app/notes',
      })
    }

    for (const t of tasks) {
      results.push({
        _id: t._id.toString(),
        type: 'task',
        title: t.title,
        subtitle: t.dueDate ? `Due ${t.dueDate}` : (t.description?.slice(0, 60) ?? undefined),
        href: '/app/tasks',
      })
    }

    for (const h of habits) {
      results.push({
        _id: h._id.toString(),
        type: 'habit',
        title: `${h.icon} ${h.name}`,
        subtitle: h.description?.slice(0, 60) ?? undefined,
        href: '/app/habits',
      })
    }

    for (const e of expenses) {
      results.push({
        _id: e._id.toString(),
        type: 'expense',
        title: e.description ?? e.category,
        subtitle: `${e.category} · ${e.date}`,
        href: '/app/expenses',
      })
    }

    for (const g of groupBills) {
      const peopleNames = g.people.map((p: { name: string }) => p.name).join(', ')
      results.push({
        _id: g._id.toString(),
        type: 'groupBill',
        title: g.name,
        subtitle: `₹${g.total} · ${peopleNames.slice(0, 60)}`,
        href: '/app/expenses',
      })
    }

    // Fetch payments for these money records to compute remaining balance
    if (moneyRecords.length > 0) {
      const moneyIds = moneyRecords.map((r) => r._id)
      const moneyPayments = await MoneyPayment.find({ moneyRecordId: { $in: moneyIds } }).lean()
      const paymentMap = new Map<string, IMoneyPayment[]>()
      for (const p of moneyPayments) {
        const key = p.moneyRecordId.toString()
        if (!paymentMap.has(key)) paymentMap.set(key, [])
        paymentMap.get(key)!.push(p as unknown as IMoneyPayment)
      }

      for (const r of moneyRecords) {
        const rec = r as unknown as IMoneyRecord
        const payments = paymentMap.get(r._id.toString()) ?? []
        const balance = calcBalance(rec.originalAmountMinor, payments.map((p) => p.amountMinor))
        const remaining = balance.remainingMinor / 100
        const direction = rec.direction === 'given' ? 'Owes you' : 'You owe'
        results.push({
          _id: r._id.toString(),
          type: 'moneyRecord',
          title: rec.person.name,
          subtitle: `${direction} ₹${remaining.toLocaleString('en-IN')} · ${rec.reason}`,
          href: '/app/money',
        })
      }
    }

    return NextResponse.json({ results, query: q })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[search GET]', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
