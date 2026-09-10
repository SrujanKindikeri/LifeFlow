'use client'

import { forwardRef, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/* ── GlassInput ─────────────────────────────────────────────────────────── */

interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?:     string
  error?:     string
  hint?:      string
  leftIcon?:  React.ReactNode
  rightIcon?: React.ReactNode
}

export const GlassInput = forwardRef<HTMLInputElement, GlassInputProps>(
  ({ label, error, hint, leftIcon, rightIcon, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            {label}
          </label>
        )}

        <div className="relative">
          {leftIcon && (
            <div
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--text-muted)' }}
            >
              {leftIcon}
            </div>
          )}

          <input
            ref={ref}
            id={inputId}
            className={cn(
              'glass-input w-full rounded-xl text-sm',
              'px-3.5 py-2.5',
              leftIcon  && 'pl-9',
              rightIcon && 'pr-9',
              error && '!border-red-400 focus:!border-red-500 focus:!shadow-[0_0_0_3px_rgba(220,38,38,0.10)]',
              className
            )}
            {...props}
          />

          {rightIcon && (
            <div
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
            >
              {rightIcon}
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs flex items-center gap-1" style={{ color: 'var(--danger)' }}>
            <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: 'var(--danger)' }} />
            {error}
          </p>
        )}
        {hint && !error && (
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{hint}</p>
        )}
      </div>
    )
  }
)
GlassInput.displayName = 'GlassInput'

/* ── GlassTextarea ──────────────────────────────────────────────────────── */

interface GlassTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  hint?:  string
}

export const GlassTextarea = forwardRef<HTMLTextAreaElement, GlassTextareaProps>(
  ({ label, error, hint, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            {label}
          </label>
        )}

        <textarea
          ref={ref}
          id={inputId}
          className={cn(
            'glass-input w-full rounded-xl text-sm resize-none',
            'px-3.5 py-2.5 min-h-[96px]',
            error && '!border-red-400',
            className
          )}
          {...props}
        />

        {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
        {hint && !error && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{hint}</p>}
      </div>
    )
  }
)
GlassTextarea.displayName = 'GlassTextarea'

/* ── GlassSelectSimple ──────────────────────────────────────────────────── */

interface GlassSelectSimpleProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?:         string
  error?:         string
  options:        { value: string; label: string }[]
  onValueChange?: (value: string) => void
}

export const GlassSelectSimple = forwardRef<HTMLSelectElement, GlassSelectSimpleProps>(
  ({ label, error, options, className, id, onValueChange, onChange, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            {label}
          </label>
        )}

        <select
          ref={ref}
          id={inputId}
          className={cn(
            'glass-input w-full rounded-xl text-sm appearance-none cursor-pointer',
            'px-3.5 py-2.5 pr-9',
            error && '!border-red-400',
            className
          )}
          onChange={(e) => {
            onChange?.(e)
            onValueChange?.(e.target.value)
          }}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
      </div>
    )
  }
)
GlassSelectSimple.displayName = 'GlassSelectSimple'

/* ── GlassSelect (callback-based) ──────────────────────────────────────── */

interface GlassSelectProps {
  label?:       string
  error?:       string
  options:      { value: string; label: string }[]
  value?:       string
  onChange?:    (value: string) => void
  placeholder?: string
  className?:   string
  disabled?:    boolean
}

export function GlassSelect({
  label,
  error,
  options,
  value,
  onChange,
  placeholder,
  className,
  disabled,
}: GlassSelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: 'var(--text-muted)' }}
        >
          {label}
        </label>
      )}

      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        className={cn(
          'glass-input w-full rounded-xl text-sm appearance-none cursor-pointer',
          'px-3.5 py-2.5',
          error && '!border-red-400',
          className
        )}
      >
        {placeholder && (
          <option value="">{placeholder}</option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}
