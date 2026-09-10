'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { motion } from 'framer-motion'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import { loginSchema, type LoginInput } from '@/lib/validations'
import { GlassInput } from '@/components/ui/GlassInput'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'

export default function LoginPage() {
  const router = useRouter()
  const { success, error } = useToast()
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  })

  async function onSubmit(data: LoginInput) {
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) { error(json.error ?? 'Login failed'); return }
      success('Welcome back!')
      router.push('/app/dashboard')
      router.refresh()
    } catch {
      error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0,  scale: 1     }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-[400px]"
    >
      {/* Card */}
      <div
        className="relative rounded-[28px] overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(36px) saturate(1.8)',
          WebkitBackdropFilter: 'blur(36px) saturate(1.8)',
          border: '1px solid rgba(0,0,0,0.08)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)',
        }}
      >
        {/* Top inner highlight */}
        <div className="absolute inset-x-0 top-0 h-px pointer-events-none"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)' }} />

        <div className="p-8">
          {/* Logo mark */}
          <div className="flex flex-col items-center mb-8">
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1,   opacity: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 20 }}
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mb-5"
              style={{
                background: 'linear-gradient(135deg, rgba(37,99,235,0.12) 0%, rgba(59,130,246,0.08) 100%)',
                border: '1px solid rgba(37,99,235,0.18)',
                boxShadow: '0 4px 20px rgba(37,99,235,0.12)',
              }}
            >
              ⚡
            </motion.div>
            <h1 className="text-[22px] font-bold tracking-tight mb-1"
              style={{ color: 'var(--text-primary)' }}>
              Welcome back
            </h1>
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              Sign in to continue to LifeFlow
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <GlassInput
              label="Email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              leftIcon={<Mail size={14} />}
              error={errors.email?.message}
              {...register('email')}
            />

            <GlassInput
              label="Password"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              autoComplete="current-password"
              leftIcon={<Lock size={14} />}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="transition-colors focus-ring rounded"
                  style={{ color: 'var(--text-muted)' }}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              }
              error={errors.password?.message}
              {...register('password')}
            />

            <div className="flex justify-end">
              <button
                type="button"
                className="text-[12px] transition-colors"
                style={{ color: 'var(--accent)' }}
              >
                Forgot password?
              </button>
            </div>

            <GlassButton
              type="submit"
              variant="primary"
              fullWidth
              size="lg"
              loading={loading}
              className="mt-1"
            >
              Sign in
            </GlassButton>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
            <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>or</span>
            <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
          </div>

          {/* Sign up link */}
          <p className="text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Don&apos;t have an account?{' '}
            <Link
              href="/signup"
              className="font-semibold transition-colors"
              style={{ color: 'var(--accent)' }}
            >
              Create one
            </Link>
          </p>
        </div>
      </div>

      {/* Footer */}
      <p className="text-center text-[11px] mt-5" style={{ color: 'var(--text-faint)' }}>
        Your data is private and never shared.
      </p>
    </motion.div>
  )
}
