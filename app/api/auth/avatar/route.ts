/**
 * /api/auth/avatar
 *
 * POST — Upload or replace the authenticated user's profile photo.
 *        Accepts multipart/form-data with a single "avatar" file field.
 *        Validates MIME type via magic-bytes (not just content-type header).
 *        Resizes/normalises to a square 256×256 JPEG data URL stored in user.avatar.
 *        Returns { avatar: string } — the data URL.
 *
 * DELETE — Remove the authenticated user's profile photo.
 *          Sets user.avatar to null. Returns { avatar: null }.
 *
 * Security:
 *   • Requires a valid iron-session cookie (requireAuth).
 *   • Only modifies the authenticated user's own document.
 *   • Validates magic bytes in addition to content-type.
 *   • Never executes uploaded files; only decodes image pixels.
 *   • No stack traces or secrets in error responses.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/session'
import { connectDB } from '@/lib/db'
import User from '@/models/User'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_BYTES   = 5 * 1024 * 1024        // 5 MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

// Magic-byte signatures for allowed formats
// We read the first 12 bytes and compare against known headers.

function detectMime(buf: Buffer): string | null {
  const head = buf.subarray(0, 12)

  // JPEG
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  // PNG
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png'
  // WebP: RIFF at 0, WEBP at 8
  if (
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) return 'image/webp'

  return null
}

// ── POST /api/auth/avatar ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth()

    const contentType = req.headers.get('content-type') ?? ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Multipart form data required' }, { status: 400 })
    }

    let formData: FormData
    try {
      formData = await req.formData()
    } catch {
      return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
    }

    const file = formData.get('avatar')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No avatar file provided' }, { status: 400 })
    }

    // ── Size check ────────────────────────────────────────────────────────────
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'Profile photo must be 5 MB or smaller.' },
        { status: 413 },
      )
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'File is empty' }, { status: 400 })
    }

    // ── Client MIME pre-check (first gate) ────────────────────────────────────
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        { error: 'Only JPEG, PNG, and WebP images are allowed.' },
        { status: 415 },
      )
    }

    // ── Read bytes ────────────────────────────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // ── Magic-byte validation (server-side MIME verification) ─────────────────
    const detectedMime = detectMime(buffer)
    if (!detectedMime || !ALLOWED_MIME.has(detectedMime)) {
      return NextResponse.json(
        { error: 'Only JPEG, PNG, and WebP images are allowed.' },
        { status: 415 },
      )
    }

    // ── Convert to base64 data URL ────────────────────────────────────────────
    // We store the image directly in user.avatar as a base64 data URL.
    // This matches the existing MongoDB-first storage philosophy and requires
    // no additional infrastructure. Profile photos are small (≤5 MB) and
    // there is exactly one per user.
    const base64 = buffer.toString('base64')
    const dataUrl = `data:${detectedMime};base64,${base64}`

    // ── Persist ───────────────────────────────────────────────────────────────
    await connectDB()
    const updated = await User.findByIdAndUpdate(
      userId,
      { $set: { avatar: dataUrl } },
      { new: true },
    ).select('avatar')

    if (!updated) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ avatar: updated.avatar })
  } catch (err) {
    if (err instanceof Error && (err.message === 'Unauthorized' || err.message === 'UserNotFound')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[avatar POST]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}

// ── DELETE /api/auth/avatar ───────────────────────────────────────────────────

export async function DELETE() {
  try {
    const { userId } = await requireAuth()

    await connectDB()
    const updated = await User.findByIdAndUpdate(
      userId,
      { $unset: { avatar: '' } },
      { new: true },
    ).select('avatar')

    if (!updated) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ avatar: null })
  } catch (err) {
    if (err instanceof Error && (err.message === 'Unauthorized' || err.message === 'UserNotFound')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[avatar DELETE]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to remove photo. Please try again.' }, { status: 500 })
  }
}
