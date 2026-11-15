/**
 * GET /api/admin/features
 * Returns aggregate counts for all major feature areas.
 * Used by the feature-specific management pages (Notes, Tasks, Habits, etc.)
 *
 * Query param: module = notes | tasks | habits | projects | expenses | subscriptions | all
 */
import { NextRequest, NextResponse }                  from 'next/server'
import { requireAdmin, handleAdminAuthError }         from '@/lib/admin-auth'
import { connectDB }                                   from '@/lib/db'
import mongoose                                        from 'mongoose'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin()
    await connectDB()

    const moduleName = req.nextUrl.searchParams.get('module') ?? 'all'

    const db = mongoose.connection.db
    if (!db) {
      return NextResponse.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database not ready.' } }, { status: 503 })
    }

    // Collect counts only — never return user document content
    const results: Record<string, unknown> = {}

    if (moduleName === 'all' || moduleName === 'notes') {
      results.notes = {
        total:    await db.collection('notes').countDocuments(),
        pinned:   await db.collection('notes').countDocuments({ pinned: true }),
        archived: await db.collection('notes').countDocuments({ archived: true }),
      }
    }

    if (moduleName === 'all' || moduleName === 'tasks') {
      results.tasks = {
        total:     await db.collection('tasks').countDocuments(),
        completed: await db.collection('tasks').countDocuments({ completed: true }),
        overdue:   await db.collection('tasks').countDocuments({
          completed: false,
          dueDate: { $lt: new Date().toISOString().split('T')[0] },
        }),
      }
    }

    if (moduleName === 'all' || moduleName === 'habits') {
      const today = new Date().toISOString().split('T')[0]
      results.habits = {
        total:          await db.collection('habits').countDocuments(),
        logsToday:      await db.collection('habitlogs').countDocuments({ date: today }),
        completedToday: await db.collection('habitlogs').countDocuments({ date: today, completed: true }),
      }
    }

    if (moduleName === 'all' || moduleName === 'projects') {
      results.projects = {
        total:     await db.collection('projects').countDocuments(),
        active:    await db.collection('projects').countDocuments({ status: 'active' }),
        completed: await db.collection('projects').countDocuments({ status: 'completed' }),
        archived:  await db.collection('projects').countDocuments({ status: 'archived' }),
      }
    }

    if (moduleName === 'all' || moduleName === 'expenses') {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      results.expenses = {
        total:       await db.collection('expenses').countDocuments(),
        last30Days:  await db.collection('expenses').countDocuments({
          createdAt: { $gte: thirtyDaysAgo },
        }),
        budgets:     await db.collection('budgets').countDocuments(),
      }
    }

    if (moduleName === 'all' || moduleName === 'subscriptions') {
      results.subscriptions = {
        total:     await db.collection('subscriptions').countDocuments(),
        active:    await db.collection('subscriptions').countDocuments({ status: 'active' }),
        paused:    await db.collection('subscriptions').countDocuments({ status: 'paused' }),
        cancelled: await db.collection('subscriptions').countDocuments({ status: 'cancelled' }),
      }
    }

    return NextResponse.json({ module: moduleName, ...results, generatedAt: new Date().toISOString() })
  } catch (err) {
    return handleAdminAuthError(err)
  }
}
