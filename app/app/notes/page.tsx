import { requireAuth } from '@/lib/session'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { NotesClient } from '@/components/notes/NotesClient'

export default async function NotesPage() {
  try { await requireAuth() } catch { redirect('/login') }
  return (
    <div className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
      <Suspense>
        <NotesClient />
      </Suspense>
    </div>
  )
}
