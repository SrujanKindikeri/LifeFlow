'use client'

/**
 * OtpInput — 6-digit one-time password input.
 *
 * Features:
 *  - 6 individual digit boxes with auto-advance on input
 *  - Backspace deletes current digit and moves focus back
 *  - Paste support: pasting a 6-digit code fills all boxes at once
 *  - inputMode="numeric" pattern="[0-9]*" for mobile numeric keyboard
 *  - Accessible: role="group", aria-label, individual aria-labels
 *  - Calls onChange with the current combined string (may be < 6 chars)
 *  - Value is always treated as a STRING — never converted to Number
 *
 * Usage:
 *   <OtpInput value={otp} onChange={setOtp} disabled={loading} />
 */

import { useRef, useCallback, KeyboardEvent, ClipboardEvent, ChangeEvent } from 'react'
import { cn } from '@/lib/utils'

interface OtpInputProps {
  value:      string
  onChange:   (value: string) => void
  disabled?:  boolean
  hasError?:  boolean
  className?: string
  /** Called when the user presses Enter on the last box */
  onSubmit?:  () => void
}

const OTP_LENGTH = 6

export function OtpInput({
  value,
  onChange,
  disabled  = false,
  hasError  = false,
  className,
  onSubmit,
}: OtpInputProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])

  // Build an array of 6 characters from the current value string
  const digits = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] ?? '')

  const focusIndex = useCallback((index: number) => {
    const el = inputRefs.current[index]
    if (el) {
      el.focus()
      // Move cursor to end of content so typing replaces the digit cleanly
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [])

  const handleChange = useCallback(
    (index: number, e: ChangeEvent<HTMLInputElement>) => {
      // Accept only digit characters
      const raw = e.target.value.replace(/\D/g, '')
      if (!raw) return

      // Take the last character if somehow more than one ends up here (e.g.
      // autocomplete suggestion on Android), then advance focus.
      const digit = raw[raw.length - 1]

      const newDigits = [...digits]
      newDigits[index] = digit
      const newValue = newDigits.join('')
      onChange(newValue)

      // Advance focus to next box
      if (index < OTP_LENGTH - 1) {
        focusIndex(index + 1)
      }
    },
    [digits, onChange, focusIndex]
  )

  const handleKeyDown = useCallback(
    (index: number, e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace') {
        e.preventDefault()
        if (digits[index]) {
          // Clear current digit
          const newDigits = [...digits]
          newDigits[index] = ''
          onChange(newDigits.join(''))
        } else if (index > 0) {
          // Current box is already empty — clear previous and move focus back
          const newDigits = [...digits]
          newDigits[index - 1] = ''
          onChange(newDigits.join(''))
          focusIndex(index - 1)
        }
        return
      }

      if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault()
        focusIndex(index - 1)
        return
      }
      if (e.key === 'ArrowRight' && index < OTP_LENGTH - 1) {
        e.preventDefault()
        focusIndex(index + 1)
        return
      }

      if (e.key === 'Enter' && index === OTP_LENGTH - 1) {
        onSubmit?.()
        return
      }
    },
    [digits, onChange, focusIndex, onSubmit]
  )

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault()
      const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
      if (!pasted) return

      // Pad / trim to exactly OTP_LENGTH
      const newDigits = Array.from({ length: OTP_LENGTH }, (_, i) => pasted[i] ?? '')
      onChange(newDigits.join(''))

      // Move focus to the last filled box or the one after it
      const lastFilledIndex = Math.min(pasted.length - 1, OTP_LENGTH - 1)
      const nextIndex       = Math.min(pasted.length, OTP_LENGTH - 1)
      focusIndex(pasted.length < OTP_LENGTH ? nextIndex : lastFilledIndex)
    },
    [onChange, focusIndex]
  )

  // Click selects the digit for replacement
  const handleClick = useCallback(
    (index: number) => {
      const el = inputRefs.current[index]
      if (el) el.setSelectionRange(0, el.value.length)
    },
    []
  )

  return (
    <div
      role="group"
      aria-label="One-time verification code"
      className={cn('flex items-center justify-center gap-2 sm:gap-3', className)}
    >
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => { inputRefs.current[i] = el }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={digit}
          aria-label={`Digit ${i + 1}`}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          disabled={disabled}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onClick={() => handleClick(i)}
          className={cn(
            // Sizing — square boxes
            'w-11 h-14 sm:w-12 sm:h-14',
            // Typography
            'text-center text-[22px] font-bold tabular-nums',
            // Shape
            'rounded-xl border',
            // Transitions
            'transition-all duration-150',
            // Focus ring
            'focus:outline-none',
            // Disabled
            'disabled:opacity-40 disabled:cursor-not-allowed',
            // States
            hasError
              ? 'border-red-400/60 bg-red-50/40 text-red-700 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'
              : digit
                ? 'border-blue-400/60 bg-blue-50/40 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                : 'border-[var(--border-strong)] bg-[var(--bg-elevated)] focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20',
          )}
          style={{
            color:      hasError ? undefined : digit ? 'var(--accent)' : 'var(--text-primary)',
            caretColor: 'transparent',
          }}
        />
      ))}
    </div>
  )
}
