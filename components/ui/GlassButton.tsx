'use client'

import { motion, HTMLMotionProps } from 'framer-motion'
import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
export type ButtonSize    = 'xs' | 'sm' | 'md' | 'lg'

interface GlassButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children:   React.ReactNode
  variant?:   ButtonVariant
  size?:      ButtonSize
  loading?:   boolean
  fullWidth?: boolean
  icon?:      React.ReactNode
  iconRight?: React.ReactNode
}

/*
  Variant class strings.
  • primary   — solid accent, strong visual weight, white text
  • secondary — liquid glass surface, adapts to light/dark via CSS classes
  • ghost     — no background until hover
  • danger    — translucent red-tinted glass
  • success   — translucent green-tinted glass
*/
const variants: Record<ButtonVariant, string> = {
  primary: [
    'text-white font-semibold',
    'border border-blue-500/20',
  ].join(' '),

  secondary: [
    /* btn-glass-secondary applies blur + background + border via globals.css */
    'btn-glass-secondary',
    'font-medium',
  ].join(' '),

  ghost: [
    'btn-glass-ghost',
    'border border-transparent',
  ].join(' '),

  danger: 'border',

  success: 'border',
}

const sizes: Record<ButtonSize, string> = {
  xs: 'px-2.5 py-1   text-xs  gap-1   rounded-lg',
  sm: 'px-3   py-1.5 text-sm  gap-1.5 rounded-xl',
  md: 'px-4   py-2   text-sm  gap-2   rounded-xl',
  lg: 'px-5   py-2.5 text-[15px] gap-2 rounded-xl',
}

/* Inline style per variant — colour values that can't be expressed in classes */
function getInlineStyle(variant: ButtonVariant): React.CSSProperties {
  switch (variant) {
    case 'primary':
      return {
        background: 'var(--accent)',
        boxShadow: '0 2px 12px rgba(37,99,235,0.22), inset 0 1px 0 rgba(255,255,255,0.15)',
        color: '#ffffff',
      }
    case 'secondary':
      return { color: 'var(--text-secondary)' }
    case 'ghost':
      return { color: 'var(--text-secondary)' }
    case 'danger':
      return {
        background: 'rgba(220,38,38,0.08)',
        borderColor: 'rgba(220,38,38,0.18)',
        color: 'var(--danger-text)',
      }
    case 'success':
      return {
        background: 'rgba(22,163,74,0.08)',
        borderColor: 'rgba(22,163,74,0.18)',
        color: 'var(--success-text)',
      }
  }
}

export function GlassButton({
  children,
  variant   = 'secondary',
  size      = 'md',
  loading   = false,
  fullWidth = false,
  icon,
  iconRight,
  className,
  disabled,
  style,
  ...props
}: GlassButtonProps) {
  const isDisabled = disabled || loading

  return (
    <motion.button
      whileTap={isDisabled ? undefined : { scale: 0.97 }}
      whileHover={isDisabled ? undefined : { scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={cn(
        'relative inline-flex items-center justify-center font-medium',
        'transition-colors duration-150 focus-ring select-none',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className
      )}
      style={{ ...getInlineStyle(variant), ...style }}
      disabled={isDisabled}
      {...props}
    >
      {loading ? (
        <>
          <svg className="animate-spin h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Loading…</span>
        </>
      ) : (
        <>
          {icon      && <span className="flex-shrink-0">{icon}</span>}
          {children}
          {iconRight && <span className="flex-shrink-0">{iconRight}</span>}
        </>
      )}
    </motion.button>
  )
}
