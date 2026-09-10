import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency = 'INR'): string {
  const symbols: Record<string, string> = {
    INR: '₹',
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
  }
  const symbol = symbols[currency] || currency
  return `${symbol}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return formatDate(dateStr)
}

export function getTodayString(): string {
  const today = new Date()
  return today.toISOString().split('T')[0]
}

export function getGreeting(name: string): string {
  const hour = new Date().getHours()
  if (hour < 12) return `Good morning, ${name} 👋`
  if (hour < 17) return `Good afternoon, ${name} 👋`
  return `Good evening, ${name} 👋`
}

export function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

export const EXPENSE_CATEGORIES = [
  { value: 'food', label: 'Food', emoji: '🍔', color: '#f97316' },
  { value: 'transport', label: 'Transport', emoji: '🚗', color: '#3b82f6' },
  { value: 'shopping', label: 'Shopping', emoji: '🛍️', color: '#ec4899' },
  { value: 'bills', label: 'Bills', emoji: '📄', color: '#ef4444' },
  { value: 'entertainment', label: 'Entertainment', emoji: '🎬', color: '#a855f7' },
  { value: 'education', label: 'Education', emoji: '📚', color: '#6366f1' },
  { value: 'health', label: 'Health', emoji: '💊', color: '#22c55e' },
  { value: 'subscriptions', label: 'Subscriptions', emoji: '🔄', color: '#0ea5e9' },
  { value: 'other', label: 'Other', emoji: '📦', color: '#6b7280' },
] as const

export const HABIT_ICONS = [
  '💧', '🏃', '📚', '😴', '🧘', '💪', '🥗', '🚴',
  '🎯', '✍️', '🎨', '🎵', '🌱', '🧹', '💊', '📱',
  '🌅', '🐕', '💰', '🧠',
]

export const PRIORITY_CONFIG = {
  high: { label: 'High', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  medium: { label: 'Medium', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  low: { label: 'Low', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
} as const
