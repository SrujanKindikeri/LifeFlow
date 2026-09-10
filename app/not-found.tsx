import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="auth-bg">
      <div className="glass-floating rounded-[28px] p-10 max-w-md w-full text-center shadow-[0_32px_80px_rgba(0,0,0,0.55)] relative overflow-hidden">
        {/* Top highlight */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent pointer-events-none" />
        {/* Ambient glow */}
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative">
          {/* Icon */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl glass border border-white/[0.10] text-3xl mb-6 shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
            🔍
          </div>

          <p className="text-[11px] font-bold tracking-[0.14em] text-indigo-400/65 uppercase mb-3">
            404 — Not Found
          </p>

          <h1 className="text-[24px] font-bold text-white mb-3 tracking-tight">
            Page not found
          </h1>
          <p className="text-[13px] text-white/42 mb-8 leading-relaxed max-w-xs mx-auto">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>

          <Link
            href="/app/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-500/88 hover:bg-indigo-500 text-white font-semibold transition-colors text-sm shadow-[0_4px_14px_rgba(99,102,241,0.3)]"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
