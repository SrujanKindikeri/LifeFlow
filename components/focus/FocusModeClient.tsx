'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ArrowLeft, Play, Pause, RotateCcw, CheckCircle2, Timer } from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'

interface Task {
  _id: string; title: string; description?: string; completed: boolean; priority: string
}

const FOCUS_DURATION = 25 * 60 // 25 minutes in seconds

function formatTime(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function FocusModeClient({ taskId }: { taskId: string }) {
  const router = useRouter()
  const { success, error: showError } = useToast()
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [timeLeft, setTimeLeft] = useState(FOCUS_DURATION)
  const [running, setRunning] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [completing, setCompleting] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  // Track start time for accuracy when tab is hidden
  const startTimeRef = useRef<number | null>(null)
  const elapsedRef = useRef(0)

  useEffect(() => {
    fetch(`/api/tasks?date=`)
      .then(() => {})
      .catch(() => {})
    // Fetch this specific task
    fetch('/api/tasks')
      .then((r) => r.json())
      .then((data) => {
        const t = data.tasks?.find((t: Task) => t._id === taskId)
        if (t) { setTask(t); if (t.completed) setCompleted(true) }
        else showError('Task not found')
      })
      .catch(() => showError('Failed to load task'))
      .finally(() => setLoading(false))
  }, [taskId, showError])

  // Visibility-aware timer
  const tick = useCallback(() => {
    if (startTimeRef.current === null) return
    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000) + elapsedRef.current
    const remaining = Math.max(0, FOCUS_DURATION - elapsed)
    setTimeLeft(remaining)
    if (remaining === 0) {
      setRunning(false)
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  useEffect(() => {
    if (running) {
      startTimeRef.current = Date.now()
      intervalRef.current = setInterval(tick, 500)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        // Save elapsed when paused
        if (startTimeRef.current !== null) {
          elapsedRef.current += Math.floor((Date.now() - startTimeRef.current) / 1000)
          startTimeRef.current = null
        }
      }
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running, tick])

  // Page visibility API for accuracy
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) {
        if (running && startTimeRef.current !== null) {
          elapsedRef.current += Math.floor((Date.now() - startTimeRef.current) / 1000)
          startTimeRef.current = null
        }
      } else {
        if (running) startTimeRef.current = Date.now()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [running])

  function reset() {
    setRunning(false)
    setTimeLeft(FOCUS_DURATION)
    elapsedRef.current = 0
    startTimeRef.current = null
  }

  async function markComplete() {
    if (!task) return
    setCompleting(true)
    try {
      const res = await fetch(`/api/tasks/${task._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: true }),
      })
      if (!res.ok) throw new Error()
      success('Task completed! Great work.')
      setCompleted(true)
      setRunning(false)
    } catch { showError('Failed to complete task') }
    finally { setCompleting(false) }
  }

  const pct = Math.round(((FOCUS_DURATION - timeLeft) / FOCUS_DURATION) * 100)
  const circumference = 2 * Math.PI * 88

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-16 h-16 rounded-full animate-spin border-4 border-blue-200 border-t-blue-500" />
      </div>
    )
  }

  if (!task) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p style={{ color: 'var(--text-muted)' }}>Task not found.</p>
        <GlassButton variant="secondary" onClick={() => router.push('/app/tasks')}>Back to Tasks</GlassButton>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--app-bg, #f8fafc)' }}>
      {/* Minimal header */}
      <div className="flex items-center justify-between px-6 py-4">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-sm transition-colors hover:opacity-70" style={{ color: 'var(--text-muted)' }}>
          <ArrowLeft size={16} /> Exit Focus
        </button>
        <div className="flex items-center gap-1.5" style={{ color: 'var(--text-faint)' }}>
          <Timer size={14} />
          <span className="text-xs font-medium">Focus Mode</span>
        </div>
      </div>

      {/* Main focus area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
        {/* Task info */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-sm"
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-faint)' }}>
            {completed ? 'Completed' : 'Focus'}
          </p>
          <h1 className="text-2xl font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>{task.title}</h1>
          {task.description && (
            <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>{task.description}</p>
          )}
        </motion.div>

        {/* Timer circle */}
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1 }} className="relative">
          <svg width="200" height="200" className="-rotate-90">
            <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="8" />
            <circle
              cx="100" cy="100" r="88" fill="none"
              stroke={completed ? '#16a34a' : timeLeft === 0 ? '#f59e0b' : '#3b82f6'}
              strokeWidth="8" strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference - (circumference * pct) / 100}
              style={{ transition: 'stroke-dashoffset 0.5s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {completed ? (
              <CheckCircle2 size={48} style={{ color: '#16a34a' }} />
            ) : (
              <>
                <span className="text-4xl font-bold font-mono tracking-tight" style={{ color: 'var(--text-primary)' }}>
                  {formatTime(timeLeft)}
                </span>
                {timeLeft === 0 && (
                  <span className="text-xs mt-1 font-semibold" style={{ color: '#f59e0b' }}>Time&apos;s up!</span>
                )}
              </>
            )}
          </div>
        </motion.div>

        {/* Controls */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="flex items-center gap-4">
          {!completed && (
            <>
              <GlassButton variant="secondary" size="md" icon={<RotateCcw size={15} />} onClick={reset}>
                Reset
              </GlassButton>

              <GlassButton
                variant="primary"
                size="lg"
                icon={running ? <Pause size={16} /> : <Play size={16} />}
                onClick={() => setRunning((r) => !r)}
                style={{ minWidth: 120 }}
              >
                {running ? 'Pause' : timeLeft < FOCUS_DURATION ? 'Resume' : 'Start'}
              </GlassButton>

              <GlassButton
                variant="success"
                size="md"
                icon={<CheckCircle2 size={15} />}
                onClick={markComplete}
                loading={completing}
              >
                Done
              </GlassButton>
            </>
          )}

          {completed && (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm font-semibold" style={{ color: '#16a34a' }}>Task completed!</p>
              <GlassButton variant="primary" onClick={() => router.push('/app/tasks')}>Back to Tasks</GlassButton>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
