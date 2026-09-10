/**
 * GET /api/expenses/proof/[fileId]
 *
 * Serves a transaction proof image (screenshot) for the authenticated user.
 *
 * Security guarantees:
 *   - Requires valid session (requireAuth).
 *   - Fetches the proof document using BOTH fileId AND userId — so a user
 *     can never access another user's screenshot by guessing a fileId.
 *   - Response headers prevent caching and downstream sharing.
 *   - Content-Disposition: inline (no forced download by default).
 *   - Never publicly cacheable.
 *
 * DELETE /api/expenses/proof/[fileId]
 *
 *   Deletes the proof document.  Ownership check identical to GET.
 *   NOTE: Also removes the proof reference from any expense that references it.
 */

import { NextRequest } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import TransactionProof from '@/models/TransactionProof'
import Expense from '@/models/Expense'

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { fileId } = await params

    await connectDB()

    // Explicit userId check — user can never access another user's file
    const proof = await TransactionProof
      .findOne({ _id: fileId, userId })
      .select('+data')   // data field is excluded by default
      .lean()

    if (!proof) {
      return Response.json({ error: 'Proof not found.' }, { status: 404 })
    }

    const imageBuffer = Buffer.from(proof.data, 'base64')

    return new Response(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type':              proof.mimeType,
        'Content-Length':            String(imageBuffer.byteLength),
        'Content-Disposition':       `inline; filename="${encodeURIComponent(proof.filename)}"`,
        // Never cache proof images in any shared cache
        'Cache-Control':             'private, no-store',
        'X-Content-Type-Options':    'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[proof GET]', error instanceof Error ? error.message : error)
    return Response.json({ error: 'Failed to retrieve proof.' }, { status: 500 })
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { fileId } = await params

    await connectDB()

    const proof = await TransactionProof.findOneAndDelete({ _id: fileId, userId })
    if (!proof) {
      return Response.json({ error: 'Proof not found.' }, { status: 404 })
    }

    // Remove the proof reference from any expense that holds it
    // (uses $pull on the nested proofs array)
    await Expense.updateMany(
      { userId, 'transactionCapture.proofs.fileId': fileId },
      { $pull: { 'transactionCapture.proofs': { fileId } } }
    )

    return Response.json({ message: 'Proof deleted.' })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[proof DELETE]', error instanceof Error ? error.message : error)
    return Response.json({ error: 'Failed to delete proof.' }, { status: 500 })
  }
}
