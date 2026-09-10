import { redirect } from 'next/navigation'

// /app/goals is no longer a standalone page — Goals now lives inside Projects.
// Redirect any old bookmarks / links gracefully.
export default function GoalsPage() {
  redirect('/app/projects?tab=goals')
}
