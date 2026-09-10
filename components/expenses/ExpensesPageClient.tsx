'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Wallet, Users, HandCoins } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PersonalExpensesClient } from './PersonalExpensesClient'
import { ExpensesClient } from './ExpensesClient'
import { MoneyPageClient } from '@/components/money/MoneyPageClient'

type Tab = 'personal' | 'group' | 'money-tracker'

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'personal',      label: 'Personal Spending', icon: <Wallet    size={13} /> },
  { key: 'group',         label: 'Group Bills',        icon: <Users     size={13} /> },
  { key: 'money-tracker', label: 'Money Tracker',      icon: <HandCoins size={13} /> },
]

function resolveTab(raw: string | null): Tab {
  if (raw === 'group' || raw === 'money-tracker') return raw
  return 'personal'
}

export function ExpensesPageClient() {
  const router     = useRouter()
  const pathname   = usePathname()
  const params     = useSearchParams()
  const activeTab  = resolveTab(params.get('tab'))

  const setTab = useCallback(
    (key: Tab) => {
      const next = new URLSearchParams(params.toString())
      if (key === 'personal') {
        next.delete('tab')
      } else {
        next.set('tab', key)
      }
      const qs = next.toString()
      router.push(pathname + (qs ? `?${qs}` : ''), { scroll: false })
    },
    [router, pathname, params],
  )

  return (
    <div className="flex flex-col gap-5">
      {/* ── Tab switcher ── */}
      <div
        className="flex gap-1 p-1 glass rounded-xl w-fit max-w-full flex-wrap sm:flex-nowrap"
        role="tablist"
        aria-label="Expenses sections"
      >
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={activeTab === key}
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap',
              activeTab === key
                ? 'glass-segment-active text-white'
                : 'hover:bg-black/[0.04]',
            )}
            style={activeTab === key ? {} : { color: 'var(--text-muted)' }}
          >
            <span
              className="shrink-0"
              style={activeTab === key ? { color: '#a5b4fc' } : { color: 'var(--text-faint)' }}
            >
              {icon}
            </span>
            {label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <AnimatePresence mode="wait">
        {activeTab === 'personal' && (
          <motion.div
            key="personal"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            <PersonalExpensesClient />
          </motion.div>
        )}

        {activeTab === 'group' && (
          <motion.div
            key="group"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            <ExpensesClient />
          </motion.div>
        )}

        {activeTab === 'money-tracker' && (
          <motion.div
            key="money-tracker"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            <MoneyPageClient />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
