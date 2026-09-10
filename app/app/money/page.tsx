import { redirect } from 'next/navigation'

/**
 * /app/money is now merged into the Expenses page as the "Money Tracker" tab.
 * Redirect old bookmarks/links to the new canonical URL.
 */
export default function MoneyPage() {
  redirect('/app/expenses?tab=money-tracker')
}
