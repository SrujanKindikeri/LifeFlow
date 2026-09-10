'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id:      string
  message: string
  type:    ToastType
}

interface ToastContextValue {
  toast:   (message: string, type?: ToastType) => void
  success: (message: string) => void
  error:   (message: string) => void
  warning: (message: string) => void
  info:    (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const iconMap: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2  size={15} className="flex-shrink-0" />,
  error:   <XCircle       size={15} className="flex-shrink-0" />,
  warning: <AlertTriangle size={15} className="flex-shrink-0" />,
  info:    <Info          size={15} className="flex-shrink-0" />,
}

/* Light-mode toast colours: subtle tinted white glass */
const styleMap: Record<ToastType, React.CSSProperties> = {
  success: {
    background: 'rgba(255,255,255,0.95)',
    border: '1px solid rgba(22,163,74,0.20)',
    color: 'var(--success)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
  },
  error: {
    background: 'rgba(255,255,255,0.95)',
    border: '1px solid rgba(220,38,38,0.20)',
    color: 'var(--danger)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
  },
  warning: {
    background: 'rgba(255,255,255,0.95)',
    border: '1px solid rgba(217,119,6,0.20)',
    color: 'var(--warning)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
  },
  info: {
    background: 'rgba(255,255,255,0.95)',
    border: '1px solid rgba(37,99,235,0.20)',
    color: 'var(--accent)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
  },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = Math.random().toString(36).slice(2)
      setToasts((prev) => [...prev.slice(-3), { id, message, type }])
      setTimeout(() => dismiss(id), 4200)
    },
    [dismiss]
  )

  const success = useCallback((msg: string) => toast(msg, 'success'), [toast])
  const error   = useCallback((msg: string) => toast(msg, 'error'),   [toast])
  const warning = useCallback((msg: string) => toast(msg, 'warning'), [toast])
  const info    = useCallback((msg: string) => toast(msg, 'info'),    [toast])

  return (
    <ToastContext.Provider value={{ toast, success, error, warning, info }}>
      {children}

      {/* Toast container */}
      <div
        className="fixed right-4 z-[200] flex flex-col gap-2 pointer-events-none max-w-xs w-full"
        style={{ bottom: 'calc(var(--bottomnav-height, 68px) + 12px)' }}
        aria-live="polite"
        aria-label="Notifications"
      >
        <style>{`@media (min-width: 640px) { .toast-container { bottom: 20px !important; } }`}</style>
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.92 }}
              animate={{ opacity: 1, x: 0,  scale: 1    }}
              exit={{ opacity: 0,   x: 40,  scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className={cn(
                'pointer-events-auto',
                'flex items-center gap-3',
                'pl-4 pr-3 py-3',
                'rounded-2xl',
                'text-sm font-medium',
                'backdrop-blur-xl',
              )}
              style={styleMap[t.type]}
            >
              {iconMap[t.type]}
              <span className="flex-1 leading-snug" style={{ color: 'var(--text-primary)' }}>
                {t.message}
              </span>
              <button
                onClick={() => dismiss(t.id)}
                className="opacity-40 hover:opacity-80 transition-opacity p-0.5 rounded-lg"
                style={{ color: 'var(--text-secondary)' }}
                aria-label="Dismiss"
              >
                <X size={13} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
