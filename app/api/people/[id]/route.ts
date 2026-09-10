import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { requireAuth } from '@/lib/session'
import Person from '@/models/Person'
import { z } from 'zod'

const updateSchema = z.object({
  name:       z.string().min(1).max(100).optional(),
  phone:      z.string().max(20).optional(),
  email:      z.string().email().max(200).optional().or(z.literal('')),
  lifeFlowId: z.string().max(20).optional(),
  notes:      z.string().max(500).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params
    const body = await req.json()

    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    await connectDB()

    const person = await Person.findOneAndUpdate(
      { _id: id, userId },
      { $set: parsed.data },
      { new: true }
    )

    if (!person) {
      return NextResponse.json({ error: 'Person not found' }, { status: 404 })
    }

    return NextResponse.json({
      person: {
        _id:       person._id.toString(),
        name:      person.name,
        phone:     person.phone,
        email:     person.email,
        lifeFlowId: person.lifeFlowId,
        notes:     person.notes,
        updatedAt: person.updatedAt.toISOString(),
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[person PATCH]', error)
    return NextResponse.json({ error: 'Failed to update person' }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth()
    const { id } = await params

    await connectDB()

    const person = await Person.findOneAndDelete({ _id: id, userId })
    if (!person) {
      return NextResponse.json({ error: 'Person not found' }, { status: 404 })
    }

    return NextResponse.json({ message: 'Person deleted' })
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[person DELETE]', error)
    return NextResponse.json({ error: 'Failed to delete person' }, { status: 500 })
  }
}
