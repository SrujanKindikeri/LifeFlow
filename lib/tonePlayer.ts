/**
 * lib/tonePlayer.ts — LifeFlow in-app notification tone player
 *
 * DESIGN
 * ──────────────────────────────────────────────────────────────────────────
 * Plays a short, subtle chime tone when a new in-app notification arrives.
 *
 * BROWSER AUTOPLAY POLICY
 * ──────────────────────────────────────────────────────────────────────────
 * Modern browsers block AudioContext from producing sound until the user has
 * interacted with the page (click, key-press, touch). This module handles
 * that transparently:
 *
 *   1. The AudioContext is created lazily on first playback attempt.
 *   2. If the context is suspended (autoplay blocked), we attempt to resume
 *      it once. If resumption fails, we silently drop the play request.
 *   3. We never throw or log warnings visible to end users.
 *   4. Tone failure NEVER affects notifications, email, push, or any other
 *      application feature — playTone() is always best-effort.
 *
 * TONE DESIGN
 * ──────────────────────────────────────────────────────────────────────────
 * A two-oscillator soft chime:
 *   - Primary:   sine wave at 880 Hz (A5) — gentle, non-jarring
 *   - Harmonic:  sine wave at 1320 Hz (E6) — adds pleasant warmth
 * Both have a fast attack and exponential decay so it sounds like a soft
 * bell hit rather than a sustained tone.
 * Total duration: ~0.6 s.
 */

let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    return ctx
  } catch {
    return null
  }
}

/**
 * Play a short notification chime at the given volume (0–1).
 * Returns a promise that resolves when the tone has been scheduled
 * (not when it finishes playing). Silently no-ops on any error.
 */
export async function playTone(volume: number): Promise<void> {
  // Clamp volume to valid range
  const vol = Math.max(0, Math.min(1, volume))
  if (vol === 0) return

  const ac = getContext()
  if (!ac) return

  try {
    // Resume suspended context (autoplay policy)
    if (ac.state === 'suspended') {
      await ac.resume()
    }
    // If still not running (e.g., user never interacted), bail out silently
    if (ac.state !== 'running') return

    const now = ac.currentTime

    // Master gain — controls overall volume
    const master = ac.createGain()
    master.gain.setValueAtTime(0, now)
    master.gain.linearRampToValueAtTime(vol * 0.35, now + 0.008)   // fast attack
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.55)   // decay
    master.connect(ac.destination)

    // Primary oscillator — 880 Hz (A5)
    const osc1 = ac.createOscillator()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(880, now)
    osc1.connect(master)
    osc1.start(now)
    osc1.stop(now + 0.6)

    // Harmonic oscillator — 1320 Hz (E6) at lower gain for warmth
    const harmGain = ac.createGain()
    harmGain.gain.setValueAtTime(0.35, now)
    harmGain.connect(master)

    const osc2 = ac.createOscillator()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(1320, now)
    osc2.connect(harmGain)
    osc2.start(now)
    osc2.stop(now + 0.6)

  } catch {
    // Any Web Audio error is silently swallowed — tone is purely cosmetic
  }
}

/**
 * Call this once on any user interaction (click/key) to pre-warm the
 * AudioContext so it's ready to play immediately when a notification arrives.
 * Calling this multiple times is safe — it's a no-op after the first call.
 */
export function prewarmAudio(): void {
  const ac = getContext()
  if (!ac) return
  if (ac.state === 'suspended') {
    void ac.resume().catch(() => undefined)
  }
}
