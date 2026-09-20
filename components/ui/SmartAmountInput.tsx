'use client'

/**
 * SmartAmountInput
 *
 * A reusable monetary amount input that supports arithmetic expressions.
 *
 * Users can type:
 *   90         → plain number (works exactly as before)
 *   40+40+10   → expression (auto-calculated to 90)
 *   100 + 25.50 + 10  → with whitespace (calculated to 135.50)
 *
 * Features:
 *   - Safe parser — no eval(), no Function(), no arbitrary execution
 *   - Only allows: digits, decimal point, +, whitespace
 *   - Integer-paise arithmetic prevents floating-point errors (0.10+0.20 = 0.30)
 *   - Live calculation preview: shows "= ₹90.00" while typing
 *   - Respects existing LifeFlow currency configuration
 *   - Accessible: proper label, aria-describedby for preview/error, keyboard-friendly
 *   - Works with paste and mobile keyboards
 *
 * Usage:
 *   const [expr, setExpr] = useState('')
 *   const [numericValue, setNumericValue] = useState<number | null>(null)
 *
 *   <SmartAmountInput
 *     label="Amount"
 *     value={expr}
 *     onChange={(raw, numeric) => { setExpr(raw); setNumericValue(numeric) }}
 *     currency="INR"
 *   />
 *
 *   // At submit time, use numericValue (a clean float in rupees).
 *
 * The `onChange` callback receives TWO arguments:
 *   raw     — the raw expression string (what the user typed)
 *   numeric — the calculated result in rupees, or null if expression is invalid/empty
 */

import { forwardRef, useId, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { parseAmountExpression, formatAmountPreview } from '@/lib/amountParser'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SmartAmountInputProps {
  /** Current raw expression value (e.g. "40+40+10" or "90") */
  value: string
  /**
   * Called on every keystroke.
   * @param raw     The raw expression string typed by the user
   * @param numeric The calculated numeric value in rupees, or null if invalid/empty
   */
  onChange: (raw: string, numeric: number | null) => void
  /** Label rendered above the input */
  label?: string
  /** Currency code for symbol display (default: 'INR') */
  currency?: string
  /** Validation error from the parent form (shown in red below input) */
  error?: string
  /** Hint text shown below input when there is no error */
  hint?: string
  /** Makes the input required (adds aria-required) */
  required?: boolean
  /** Disables the input */
  disabled?: boolean
  /** Autofocus on mount */
  autoFocus?: boolean
  /** HTML id — auto-generated from label if not provided */
  id?: string
  /** Additional className for the root wrapper div */
  className?: string
  /** Placeholder text (default: "0.00") */
  placeholder?: string
  /**
   * Optional maximum value in rupees.
   * Used by RecordPaymentModal to cap at remaining balance.
   */
  maxValue?: number
}

// ─── Component ────────────────────────────────────────────────────────────────

export const SmartAmountInput = forwardRef<HTMLInputElement, SmartAmountInputProps>(
  (
    {
      value,
      onChange,
      label,
      currency = 'INR',
      error,
      hint,
      required,
      disabled,
      autoFocus,
      id,
      className,
      placeholder = '0.00',
      maxValue,
    },
    ref
  ) => {
    const autoId = useId()
    const inputId = id ?? (label ? `smart-amount-${label.toLowerCase().replace(/\s+/g, '-')}` : autoId)
    const previewId = `${inputId}-preview`
    const errorId   = `${inputId}-error`
    const hintId    = `${inputId}-hint`

    // Track whether the field has been touched (for showing validation)
    const [touched, setTouched] = useState(false)

    const parsed = parseAmountExpression(value)

    // Determine the visible error:
    // 1. Parser error (invalid characters / expression) — shown after first interaction
    // 2. maxValue exceeded
    // 3. Parent-supplied error (form-level validation)
    let visibleError: string | null = null
    if (touched && parsed.error) {
      visibleError = parsed.error
    } else if (
      touched &&
      maxValue !== undefined &&
      parsed.value !== null &&
      parsed.value > maxValue
    ) {
      visibleError = `Maximum allowed: ${formatAmountPreview(maxValue, currency)}`
    } else if (error) {
      visibleError = error
    }

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value
        const result = parseAmountExpression(raw)
        onChange(raw, result.value)
      },
      [onChange]
    )

    const handleBlur = useCallback(() => {
      setTouched(true)
    }, [])

    // Show preview only when the expression contains '+' AND is valid
    const showPreview =
      parsed.isExpression &&
      parsed.value !== null &&
      !visibleError

    // Currency symbol for the left-side prefix
    const symbols: Record<string, string> = {
      INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥',
    }
    const symbol = symbols[currency] ?? currency

    // aria-describedby accumulates applicable IDs
    const describedBy = [
      showPreview  ? previewId : null,
      visibleError ? errorId   : null,
      hint && !visibleError ? hintId : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined

    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        {/* Label */}
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            {label}
            {required && (
              <span aria-hidden="true" className="ml-0.5" style={{ color: 'var(--danger)' }}>
                *
              </span>
            )}
          </label>
        )}

        {/* Input wrapper */}
        <div className="relative">
          {/* Currency symbol prefix */}
          <span
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold pointer-events-none select-none"
            aria-hidden="true"
            style={{ color: 'var(--text-muted)' }}
          >
            {symbol}
          </span>

          <input
            ref={ref}
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder={placeholder}
            required={required}
            disabled={disabled}
            autoFocus={autoFocus}
            aria-required={required}
            aria-invalid={!!visibleError}
            aria-describedby={describedBy}
            className={cn(
              'glass-input w-full rounded-xl text-sm pl-8 pr-3.5 py-2.5',
              visibleError && '!border-red-400 focus:!border-red-500 focus:!shadow-[0_0_0_3px_rgba(220,38,38,0.10)]',
            )}
          />
        </div>

        {/* Calculation preview — shown live while typing an expression */}
        {showPreview && (
          <p
            id={previewId}
            role="status"
            aria-live="polite"
            className="text-xs font-medium tabular-nums"
            style={{ color: 'var(--accent, #6366f1)' }}
          >
            = {formatAmountPreview(parsed.value!, currency)}
          </p>
        )}

        {/* Error message */}
        {visibleError && (
          <p
            id={errorId}
            role="alert"
            className="text-xs flex items-center gap-1"
            style={{ color: 'var(--danger)' }}
          >
            <span
              className="w-1 h-1 rounded-full flex-shrink-0"
              style={{ background: 'var(--danger)' }}
              aria-hidden="true"
            />
            {visibleError}
          </p>
        )}

        {/* Hint */}
        {hint && !visibleError && (
          <p id={hintId} className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {hint}
          </p>
        )}
      </div>
    )
  }
)

SmartAmountInput.displayName = 'SmartAmountInput'
