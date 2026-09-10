// Client-side serialized Draft type

export type DraftType =
  | 'note'
  | 'task'
  | 'habit'
  | 'expense'
  | 'groupBill'
  | 'moneyGiven'
  | 'moneyBorrowed'
  | 'goal'
  | 'project'
  | 'subscription'
  | 'savingsGoal'

export interface Draft {
  _id: string
  userId: string
  type: DraftType
  title: string
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// ─── Type metadata used in DraftCard and Drafts page ─────────────────────────

export const DRAFT_TYPE_META: Record<
  DraftType,
  { label: string; icon: string; color: string; bgColor: string; href: string; queryParam?: string }
> = {
  note: {
    label: 'Note',
    icon: 'FileText',
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-500/10 border-yellow-500/20',
    href: '/app/notes',
    queryParam: 'new',
  },
  task: {
    label: 'Task',
    icon: 'CheckSquare',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-500/10 border-indigo-500/20',
    href: '/app/tasks',
    queryParam: 'new',
  },
  habit: {
    label: 'Habit',
    icon: 'Flame',
    color: 'text-orange-600',
    bgColor: 'bg-orange-500/10 border-orange-500/20',
    href: '/app/habits',
    queryParam: 'new',
  },
  expense: {
    label: 'Personal Expense',
    icon: 'Wallet',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-500/10 border-emerald-500/20',
    href: '/app/expenses',
    queryParam: 'new',
  },
  groupBill: {
    label: 'Group Bill',
    icon: 'Users',
    color: 'text-violet-600',
    bgColor: 'bg-violet-500/10 border-violet-500/20',
    href: '/app/expenses',
    queryParam: 'splitbill',
  },
  moneyGiven: {
    label: 'Money Given',
    icon: 'ArrowUpRight',
    color: 'text-rose-600',
    bgColor: 'bg-rose-500/10 border-rose-500/20',
    href: '/app/people',
    queryParam: 'money_given',
  },
  moneyBorrowed: {
    label: 'Money Borrowed',
    icon: 'ArrowDownLeft',
    color: 'text-sky-600',
    bgColor: 'bg-sky-500/10 border-sky-500/20',
    href: '/app/people',
    queryParam: 'money_borrowed',
  },
  goal: {
    label: 'Goal',
    icon: 'Target',
    color: 'text-blue-600',
    bgColor: 'bg-blue-500/10 border-blue-500/20',
    href: '/app/projects',
    queryParam: 'tab=goals&new',
  },
  project: {
    label: 'Project',
    icon: 'FolderOpen',
    color: 'text-teal-600',
    bgColor: 'bg-teal-500/10 border-teal-500/20',
    href: '/app/projects',
    queryParam: 'new',
  },
  subscription: {
    label: 'Subscription',
    icon: 'CreditCard',
    color: 'text-purple-600',
    bgColor: 'bg-purple-500/10 border-purple-500/20',
    href: '/app/subscriptions',
    queryParam: 'new',
  },
  savingsGoal: {
    label: 'Savings Goal',
    icon: 'PiggyBank',
    color: 'text-pink-600',
    bgColor: 'bg-pink-500/10 border-pink-500/20',
    href: '/app/savings',
    queryParam: 'new',
  },
}

// ─── Preview helpers ──────────────────────────────────────────────────────────

export function getDraftPreview(draft: Draft): string {
  const d = draft.data
  switch (draft.type) {
    case 'note':
      return [d.content as string].filter(Boolean).join(' ').slice(0, 80) || ''
    case 'task':
      return [
        d.priority ? `Priority: ${d.priority}` : '',
        d.dueDate ? `Due: ${d.dueDate}` : '',
      ].filter(Boolean).join(' · ')
    case 'habit':
      return [
        d.frequency ? String(d.frequency) : '',
        d.target ? `Target: ${d.target}` : '',
      ].filter(Boolean).join(' · ')
    case 'expense':
      return [
        d.amount ? `₹${d.amount}` : '',
        d.category ? String(d.category) : '',
      ].filter(Boolean).join(' · ')
    case 'groupBill': {
      const people = d.people as { name: string }[] | undefined
      return [
        d.name ? String(d.name) : '',
        people?.length ? `${people.length} people` : '',
      ].filter(Boolean).join(' · ')
    }
    case 'moneyGiven':
    case 'moneyBorrowed':
      return [
        d.personName ? String(d.personName) : '',
        d.amount ? `₹${d.amount}` : '',
        d.reason ? String(d.reason) : '',
      ].filter(Boolean).join(' · ')
    case 'goal':
      return [
        d.category ? String(d.category) : '',
        d.targetValue ? `Target: ${d.targetValue}` : '',
      ].filter(Boolean).join(' · ')
    case 'project':
      return [
        d.status ? String(d.status) : '',
        d.dueDate ? `Due: ${d.dueDate}` : '',
      ].filter(Boolean).join(' · ')
    case 'subscription':
      return [
        d.amount ? `₹${d.amount}` : '',
        d.billingCycle ? String(d.billingCycle) : '',
      ].filter(Boolean).join(' · ')
    case 'savingsGoal':
      return [
        d.targetAmount ? `₹${d.targetAmount}` : '',
        d.targetDate ? `By: ${d.targetDate}` : '',
      ].filter(Boolean).join(' · ')
    default:
      return ''
  }
}
