'use client'

/**
 * TransactionCapturePanel
 *
 * Inline paste / upload / drag-drop area for UPI & payment screenshots.
 * Lives inside the Add Personal Expense modal accordion.
 *
 * ── AUTO-READ FLOW ────────────────────────────────────────────────────────────
 *
 *   1. User pastes / uploads / drags a screenshot.
 *   2. Image is previewed INSTANTLY via URL.createObjectURL — no server call yet.
 *   3. OCR starts AUTOMATICALLY — no "Read Transaction" button click needed.
 *   4. While OCR is in flight the image row shows "Reading transaction…"
 *   5. On success → onFillFromCapture(parsed, images) — parent fills form.
 *   6. On failure → per-image error row with [ Try Again ] [ Replace ] [ Enter Manually ].
 *
 * ── DUPLICATE-SCAN PREVENTION ─────────────────────────────────────────────────
 *   Each image gets ONE automatic extraction job, tracked by its previewUrl in
 *   processingRef (a Set).  React re-renders cannot trigger a second scan for
 *   the same image.
 *
 * ── GUARANTEES ────────────────────────────────────────────────────────────────
 *   - OCR request is cancellable via AbortController (stored per previewUrl).
 *   - 25-second client-side timeout → graceful error with retry.
 *   - Replacing an image cancels in-flight OCR and clears cached result.
 *   - All timing is logged in development (never in production).
 *   - No sensitive transaction text is ever logged.
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  DragEvent,
  ChangeEvent,
} from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload,
  ImagePlus,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Eye,
  RefreshCw,
  ZapOff,
} from 'lucide-react'
import { GlassButton } from '@/components/ui/GlassButton'
import { useToast } from '@/components/ui/Toast'
import type { ParsedTransaction } from '@/lib/transactionParser'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapturedImage {
  /** Client-side object URL for instant preview — revoked on remove / unmount */
  previewUrl: string
  /** Original File — held for proof upload at save time */
  file: File
  filename: string
  mimeType: string
  sizeBytes: number
  /**
   * MongoDB _id of a TransactionProof document.
   * Only set if this image has already been uploaded and saved to the DB.
   */
  fileId?: string

  // Populated after OCR completes
  parsed?: ParsedTransaction | null
  parseOk?: boolean
  parseMsg?: string | null

  /**
   * 'ready'    — attached, preview shown, OCR will start momentarily
   * 'reading'  — OCR in flight
   * 'done'     — OCR complete (parse may have succeeded or partially failed)
   * 'error'    — network / server / timeout error
   */
  status: 'ready' | 'reading' | 'done' | 'error'
  errorMsg?: string
  isTimeout?: boolean
}

interface ScanOcrResponse {
  parsed:   ParsedTransaction | null
  parseOk:  boolean
  parseMsg: string | null
  timeout?: boolean
  error?:   string
}

export interface Props {
  /**
   * Called automatically when OCR completes for a newly attached image.
   * `images` contains the original File objects so the parent can upload
   * proofs when the expense is saved.
   */
  onFillFromCapture: (parsed: ParsedTransaction | null, images: CapturedImage[]) => void
  /** Called when the user wants to view a proof that was already saved. */
  onViewImage?: (fileId: string, filename: string) => void
  /** Maximum simultaneous images allowed */
  maxImages?: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_IMAGES   = 5
const MAX_BYTES    = 8 * 1024 * 1024   // 8 MB — client-side guard
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
const ALLOWED_EXT  = /\.(png|jpg|jpeg|webp)$/i

/** Max dimension (px) of the image sent to OCR — preserves aspect ratio. */
const OCR_MAX_PX = 1600

/** Client-side OCR request timeout in ms. */
const OCR_TIMEOUT_MS = 25_000

/** Provider names recognised for display. */
const PROVIDER_NAMES = ['PhonePe', 'Paytm', 'Google Pay', 'GPay', 'BHIM', 'Amazon Pay']

// ─── Dev timing helper ────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV === 'development'

function tcLog(msg: string, startMs?: number) {
  if (!IS_DEV) return
  const elapsed = startMs != null ? ` (+${(performance.now() - startMs).toFixed(0)}ms)` : ''
  // eslint-disable-next-line no-console
  console.log(`[TransactionCapture] ${msg}${elapsed}`)
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

/** Pick the best parsed result from a set of images (highest confidence). */
export function bestParsedFrom(images: CapturedImage[]): ParsedTransaction | null {
  const order: Record<string, number> = { high: 3, partial: 2, low: 1 }
  const candidates = images
    .filter((i) => i.status === 'done' && i.parsed)
    .map((i) => i.parsed!)
    .sort((a, b) => (order[b.confidence] ?? 0) - (order[a.confidence] ?? 0))
  return candidates[0] ?? null
}

/** Derive the provider label from a parsed result (e.g. "PhonePe"). */
export function detectProvider(parsed: ParsedTransaction | null): string | undefined {
  if (!parsed) return undefined
  const haystack = [parsed.bank, parsed.paidTo, parsed.receivedFrom].filter(Boolean).join(' ')
  for (const name of PROVIDER_NAMES) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(haystack)) return name
  }
  return undefined
}

// ─── Image resize (client-side, canvas) ──────────────────────────────────────

/**
 * Resize `file` so its longest side is at most `maxPx`.
 * Returns a new Blob with the same MIME type.
 * Falls back to the original Blob if Canvas API is unavailable (e.g. SSR).
 */
async function resizeForOcr(file: File, maxPx = OCR_MAX_PX): Promise<Blob> {
  if (typeof document === 'undefined') return file

  return new Promise<Blob>((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)

      const { naturalWidth: w, naturalHeight: h } = img
      const longest = Math.max(w, h)

      if (longest <= maxPx) {
        resolve(file)
        return
      }

      const scale  = maxPx / longest
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(w * scale)
      canvas.height = Math.round(h * scale)

      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(file); return }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      canvas.toBlob(
        (blob) => resolve(blob ?? file),
        outType,
        outType === 'image/jpeg' ? 0.92 : undefined,
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(file)
    }

    img.src = objectUrl
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TransactionCapturePanel({
  onFillFromCapture,
  onViewImage,
  maxImages = MAX_IMAGES,
}: Props) {
  const { error: toastError } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef  = useRef<HTMLDivElement>(null)

  const [images,   setImages]   = useState<CapturedImage[]>([])
  const [dragging, setDragging] = useState(false)

  /**
   * Set of previewUrls currently being processed (or already done / errored).
   * Prevents a React re-render from scheduling a second OCR job for the same image.
   */
  const processingRef = useRef<Set<string>>(new Set())

  /**
   * Per-image AbortControllers — keyed by previewUrl.
   * Lets us cancel a specific in-flight request when the user removes that image.
   */
  const abortMapRef = useRef<Map<string, AbortController>>(new Map())

  /**
   * OCR result cache keyed by previewUrl.
   * Not used for auto-scanning (each image is scanned once) but kept so
   * that the parent can call "Use Detected Details" without a re-scan.
   */
  const ocrCacheRef = useRef<Map<string, { parsed: ParsedTransaction | null; parseOk: boolean; parseMsg: string | null }>>(new Map())

  // Stable ref to onFillFromCapture so the OCR async job always calls the
  // latest version without needing it in the useEffect dependency array.
  const onFillRef = useRef(onFillFromCapture)
  useEffect(() => { onFillRef.current = onFillFromCapture }, [onFillFromCapture])

  // ── Client-side validation ────────────────────────────────────────────────
  function validateFile(file: File, name: string): string | null {
    if (!ALLOWED_MIME.has(file.type.toLowerCase()) && !ALLOWED_EXT.test(name)) {
      return 'Unsupported file type. Use PNG, JPG, or WEBP.'
    }
    if (file.size === 0) return 'The image file is empty.'
    if (file.size > MAX_BYTES) {
      return `Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 8 MB.`
    }
    return null
  }

  // ── Core OCR job ──────────────────────────────────────────────────────────
  /**
   * Run OCR for a single image entry and update component state.
   * Called automatically when a new 'ready' image is detected.
   * Never called more than once per previewUrl (enforced by processingRef).
   */
  async function runOcr(target: CapturedImage) {
    const { previewUrl } = target

    // Mark in-progress BEFORE any await so concurrent calls are blocked
    processingRef.current.add(previewUrl)

    const abort = new AbortController()
    abortMapRef.current.set(previewUrl, abort)

    // ── Mark as reading ──────────────────────────────────────────────────
    setImages((prev) =>
      prev.map((img) =>
        img.previewUrl === previewUrl ? { ...img, status: 'reading' } : img
      )
    )

    const t0 = IS_DEV ? performance.now() : 0
    tcLog(`auto-scan started: ${target.filename} (${(target.sizeBytes / 1024).toFixed(0)} KB)`)

    try {
      // ── Resize for OCR ─────────────────────────────────────────────────
      const ocrBlob = await resizeForOcr(target.file, OCR_MAX_PX)
      tcLog(`image resized: ${(ocrBlob.size / 1024).toFixed(0)} KB`, t0)

      if (abort.signal.aborted) return

      // ── POST to scan-ocr ────────────────────────────────────────────────
      const fd = new FormData()
      fd.append('image', ocrBlob, target.filename)

      const timeoutId = setTimeout(() => abort.abort(), OCR_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch('/api/expenses/scan-ocr', {
          method: 'POST',
          body:   fd,
          signal: abort.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }

      if (abort.signal.aborted) return

      tcLog(`OCR response received`, t0)

      const data: ScanOcrResponse = await res.json()

      // ── Timeout ─────────────────────────────────────────────────────────
      if (data.timeout || res.status === 504) {
        setImages((prev) =>
          prev.map((img) =>
            img.previewUrl === previewUrl
              ? { ...img, status: 'error', isTimeout: true, errorMsg: 'Transaction reading took too long.' }
              : img
          )
        )
        return
      }

      // ── HTTP / server error ──────────────────────────────────────────────
      if (!res.ok || data.error) {
        const msg = data.error ?? 'Transaction reading is temporarily unavailable.'
        setImages((prev) =>
          prev.map((img) =>
            img.previewUrl === previewUrl ? { ...img, status: 'error', errorMsg: msg } : img
          )
        )
        return
      }

      // ── Cache & mark done ────────────────────────────────────────────────
      const ocrEntry = { parsed: data.parsed, parseOk: data.parseOk, parseMsg: data.parseMsg }
      ocrCacheRef.current.set(previewUrl, ocrEntry)

      // We need the full updated array to call onFillFromCapture correctly.
      // Use the functional updater and capture the result via a local variable.
      let updatedImages: CapturedImage[] = []
      setImages((prev) => {
        updatedImages = prev.map((img) =>
          img.previewUrl === previewUrl
            ? { ...img, status: 'done' as const, ...ocrEntry }
            : img
        )
        return updatedImages
      })

      tcLog(`parsed: confidence=${data.parsed?.confidence ?? 'none'}`, t0)

      // Give React one tick to apply the state update before calling the callback
      // so the parent sees the correct images array.
      setTimeout(() => {
        const doneImages = updatedImages.filter((i) => i.status === 'done')
        const best       = bestParsedFrom(doneImages)
        onFillRef.current(best, doneImages)
        tcLog('form populated', t0)
      }, 0)

    } catch (err) {
      if (abort.signal.aborted) {
        // User explicitly cancelled — restore to 'ready' only if the image
        // still exists in state (it may have been removed already)
        setImages((prev) =>
          prev.map((img) =>
            img.previewUrl === previewUrl && img.status === 'reading'
              ? { ...img, status: 'ready' }
              : img
          )
        )
        // Remove from processingRef so a retry is possible
        processingRef.current.delete(previewUrl)
        return
      }

      const errMsg =
        err instanceof Error && err.name === 'AbortError'
          ? 'Transaction reading was cancelled.'
          : 'Transaction reading is temporarily unavailable.'

      setImages((prev) =>
        prev.map((img) =>
          img.previewUrl === previewUrl ? { ...img, status: 'error', errorMsg: errMsg } : img
        )
      )
    } finally {
      abortMapRef.current.delete(previewUrl)
    }
  }

  // ── Auto-scan effect ──────────────────────────────────────────────────────
  /**
   * Whenever `images` changes, find any newly-attached 'ready' images that
   * haven't been processed yet and start OCR for them.
   *
   * The processingRef Set prevents this effect from scheduling the same image
   * twice even if React re-renders multiple times between attaching and the
   * first effect run.
   */
  useEffect(() => {
    for (const img of images) {
      if (img.status === 'ready' && !processingRef.current.has(img.previewUrl)) {
        // Fire-and-forget — runOcr manages its own state transitions
        void runOcr(img)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images])

  // ── Attach image ──────────────────────────────────────────────────────────
  const attachImage = useCallback((file: File, overrideName?: string) => {
    if (images.length >= maxImages) {
      toastError(`You can attach up to ${maxImages} images.`)
      return
    }
    const name = overrideName ?? file.name
    const validationError = validateFile(file, name)
    if (validationError) { toastError(validationError); return }

    const previewUrl = URL.createObjectURL(file)
    tcLog(`image attached: ${name} (${(file.size / 1024).toFixed(0)} KB)`)

    const entry: CapturedImage = {
      previewUrl,
      file,
      filename:  name,
      mimeType:  file.type || 'image/png',
      sizeBytes: file.size,
      status:    'ready',   // auto-scan effect will pick this up
    }
    setImages((prev) => [...prev, entry])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length, maxImages, toastError])

  // ── Clipboard paste ───────────────────────────────────────────────────────
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) return

      const items = e.clipboardData?.items
      if (!items) return

      for (const item of Array.from(items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) attachImage(file, `clipboard-paste-${Date.now()}.png`)
          break
        }
      }
    },
    [attachImage]
  )

  useEffect(() => {
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [handlePaste])

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  function onDragOver(e: DragEvent<HTMLDivElement>) { e.preventDefault(); setDragging(true) }
  function onDragLeave() { setDragging(false) }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    Array.from(e.dataTransfer.files)
      .slice(0, maxImages - images.length)
      .forEach((f) => attachImage(f))
  }

  // ── File input ────────────────────────────────────────────────────────────
  function onFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    Array.from(e.target.files ?? [])
      .slice(0, maxImages - images.length)
      .forEach((f) => attachImage(f))
    e.target.value = ''
  }

  // ── Remove image ──────────────────────────────────────────────────────────
  function removeImage(previewUrl: string) {
    // Cancel any in-flight OCR for this image
    abortMapRef.current.get(previewUrl)?.abort()
    abortMapRef.current.delete(previewUrl)
    // Clear processing + cache so a re-attach can be scanned fresh
    processingRef.current.delete(previewUrl)
    ocrCacheRef.current.delete(previewUrl)

    setImages((prev) => {
      const img = prev.find((i) => i.previewUrl === previewUrl)
      if (img) URL.revokeObjectURL(img.previewUrl)
      return prev.filter((i) => i.previewUrl !== previewUrl)
    })
  }

  // ── Retry (after error) ───────────────────────────────────────────────────
  function retryImage(previewUrl: string) {
    // Remove from processingRef so the auto-scan effect can pick it up
    processingRef.current.delete(previewUrl)
    ocrCacheRef.current.delete(previewUrl)
    setImages((prev) =>
      prev.map((img) =>
        img.previewUrl === previewUrl
          ? { ...img, status: 'ready', errorMsg: undefined, isTimeout: undefined }
          : img
      )
    )
    // The status change to 'ready' will trigger the auto-scan useEffect
  }

  // ── Cancel all in-flight OCR ──────────────────────────────────────────────
  function cancelAllOcr() {
    for (const [url, ctrl] of abortMapRef.current) {
      ctrl.abort()
      processingRef.current.delete(url)
    }
    abortMapRef.current.clear()
    setImages((prev) =>
      prev.map((img) => img.status === 'reading' ? { ...img, status: 'ready' } : img)
    )
  }

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    const abortMap = abortMapRef.current
    const imagesCopy = images
    return () => {
      for (const ctrl of abortMap.values()) ctrl.abort()
      // eslint-disable-next-line react-hooks/exhaustive-deps
      imagesCopy.forEach((img) => URL.revokeObjectURL(img.previewUrl))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Derived state ─────────────────────────────────────────────────────────
  const hasImages  = images.length > 0
  const isReading  = images.some((i) => i.status === 'reading')
  const hasDone    = images.some((i) => i.status === 'done')
  const hasErrors  = images.some((i) => i.status === 'error')
  const hasTimeout = images.some((i) => i.isTimeout)
  const canAddMore = images.length < maxImages

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">

      {/* Helper text — changes based on state */}
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {hasImages
          ? isReading
            ? 'Reading your transaction screenshot…'
            : hasDone
              ? 'Transaction details detected — review the form above.'
              : hasErrors
                ? 'Could not read the screenshot. Try again or enter details manually.'
                : 'Upload or paste your UPI / payment screenshot.'
          : 'Upload or paste your UPI / payment screenshot to fill the form automatically.'}
      </p>

      {/* Drop zone */}
      <div
        ref={dropZoneRef}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className="relative rounded-xl border-2 border-dashed transition-all duration-150"
        style={{
          borderColor: dragging ? 'var(--accent)' : 'var(--border)',
          background:  dragging ? 'rgba(99,102,241,0.06)' : 'rgba(0,0,0,0.02)',
          minHeight:   hasImages ? undefined : 96,
          cursor:      canAddMore && !isReading ? 'pointer' : 'default',
        }}
        onClick={() => canAddMore && !isReading && fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload transaction screenshot"
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && canAddMore && !isReading) {
            e.preventDefault()
            fileInputRef.current?.click()
          }
        }}
      >
        {!hasImages ? (
          /* ── Empty / drop state ──────────────────────────────────────────── */
          <div className="flex flex-col items-center justify-center gap-2 py-5 px-4 text-center select-none">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(99,102,241,0.10)' }}
            >
              <Upload size={16} style={{ color: 'var(--accent)' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
              {dragging ? 'Drop screenshot here' : 'Upload Screenshot'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Drag & Drop · PNG, JPG, WEBP · up to 8 MB
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <ClipboardPaste size={11} style={{ color: 'var(--text-faint)' }} />
              <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                or press{' '}
                <kbd
                  className="rounded px-1 py-0.5 text-[10px] font-mono"
                  style={{ background: 'rgba(0,0,0,0.06)', color: 'var(--text-muted)' }}
                >
                  Ctrl / ⌘ + V
                </kbd>{' '}
                to paste
              </span>
            </div>
          </div>
        ) : (
          /* ── Image list ──────────────────────────────────────────────────── */
          <div className="p-2 flex flex-col gap-1.5">
            <AnimatePresence mode="popLayout">
              {images.map((img) => (
                <motion.div
                  key={img.previewUrl}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-2"
                  style={{ background: 'rgba(0,0,0,0.03)' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Thumbnail */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.previewUrl}
                    alt={img.filename}
                    className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border"
                    style={{ borderColor: 'var(--border)' }}
                  />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {img.filename}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                      {(img.sizeBytes / 1024).toFixed(0)} KB
                    </p>

                    {/* ── Status line ── */}
                    {img.status === 'ready' && (
                      <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                        <Loader2 size={10} className="animate-spin" />
                        Starting…
                      </p>
                    )}

                    {img.status === 'reading' && (
                      <p className="text-[11px] flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                        <Loader2 size={10} className="animate-spin" />
                        Reading transaction…
                      </p>
                    )}

                    {img.status === 'done' && img.parseOk && img.parsed?.amountRupees != null && (
                      <p className="text-[11px] flex items-center gap-1" style={{ color: '#16a34a' }}>
                        <CheckCircle2 size={10} />
                        ₹{img.parsed.amountRupees.toFixed(2)} detected
                      </p>
                    )}
                    {img.status === 'done' && img.parseOk && img.parsed && img.parsed.amountRupees == null && (
                      <p className="text-[11px] flex items-center gap-1" style={{ color: '#b45309' }}>
                        <AlertTriangle size={10} />
                        {img.parseMsg ?? 'Amount not detected — enter manually'}
                      </p>
                    )}
                    {img.status === 'done' && !img.parseOk && (
                      <p className="text-[11px] flex items-center gap-1" style={{ color: '#b45309' }}>
                        <AlertTriangle size={10} />
                        {img.parseMsg ?? "Couldn't read transaction details"}
                      </p>
                    )}

                    {img.status === 'error' && img.isTimeout && (
                      <p className="text-[11px] flex items-center gap-1" style={{ color: '#dc2626' }}>
                        <ZapOff size={10} />
                        Took too long — try again
                      </p>
                    )}
                    {img.status === 'error' && !img.isTimeout && (
                      <p className="text-[11px] flex items-center gap-1" style={{ color: '#dc2626' }}>
                        <AlertTriangle size={10} />
                        {img.errorMsg ?? 'Reading failed'}
                      </p>
                    )}
                  </div>

                  {/* ── Per-image actions ── */}
                  <div className="flex items-center gap-1 flex-shrink-0">

                    {/* Cancel while reading */}
                    {img.status === 'reading' && (
                      <button
                        type="button"
                        aria-label="Cancel"
                        title="Cancel reading"
                        onClick={(e) => {
                          e.stopPropagation()
                          abortMapRef.current.get(img.previewUrl)?.abort()
                        }}
                        className="p-1.5 rounded-lg hover:bg-black/[0.06] transition-colors"
                        style={{ color: 'var(--text-faint)' }}
                      >
                        <X size={12} />
                      </button>
                    )}

                    {/* Retry on error */}
                    {img.status === 'error' && (
                      <button
                        type="button"
                        aria-label="Try again"
                        title="Try again"
                        onClick={(e) => { e.stopPropagation(); retryImage(img.previewUrl) }}
                        className="p-1.5 rounded-lg hover:bg-black/[0.06] transition-colors"
                        style={{ color: 'var(--text-faint)' }}
                      >
                        <RefreshCw size={12} />
                      </button>
                    )}

                    {/* View saved proof */}
                    {img.status === 'done' && onViewImage && img.fileId && (
                      <button
                        type="button"
                        aria-label="View screenshot"
                        onClick={(e) => {
                          e.stopPropagation()
                          onViewImage(img.fileId!, img.filename)
                        }}
                        className="p-1.5 rounded-lg hover:bg-black/[0.06] transition-colors"
                        style={{ color: 'var(--text-faint)' }}
                      >
                        <Eye size={13} />
                      </button>
                    )}

                    {/* Remove */}
                    <button
                      type="button"
                      aria-label="Remove image"
                      disabled={img.status === 'reading'}
                      onClick={(e) => { e.stopPropagation(); removeImage(img.previewUrl) }}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-colors disabled:opacity-40"
                      style={{ color: 'var(--text-faint)' }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Add more */}
            {canAddMore && !isReading && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors hover:bg-black/[0.04]"
                style={{ color: 'var(--text-muted)' }}
              >
                <ImagePlus size={13} />
                Add another screenshot ({images.length}/{maxImages})
              </button>
            )}
          </div>
        )}

        {/* Drag overlay */}
        {dragging && (
          <div
            className="absolute inset-0 rounded-xl flex items-center justify-center pointer-events-none"
            style={{ background: 'rgba(99,102,241,0.08)' }}
          >
            <p className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
              Drop screenshot here
            </p>
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        multiple={maxImages > 1}
        className="hidden"
        onChange={onFileInputChange}
        aria-hidden="true"
      />

      {/* Bottom action row — shown only during reading (cancel) or on errors */}
      {hasImages && (isReading || hasErrors) && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {isReading
              ? `Reading transaction…`
              : `${images.filter((i) => i.status === 'error').length} screenshot${images.filter((i) => i.status === 'error').length !== 1 ? 's' : ''} could not be read`}
          </p>

          {isReading && (
            <GlassButton variant="secondary" size="sm" onClick={cancelAllOcr}>
              <X size={13} />
              Cancel
            </GlassButton>
          )}

          {!isReading && hasErrors && (
            <GlassButton
              variant="ghost"
              size="sm"
              onClick={() => {
                // Pass null so parent shows "enter manually" state
                const doneImages = images.filter((i) => i.status === 'done')
                onFillRef.current(null, doneImages)
              }}
            >
              Enter Manually
            </GlassButton>
          )}
        </div>
      )}

      {/* Timeout guidance */}
      {hasTimeout && !isReading && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl p-3 flex flex-col gap-2"
          style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.18)' }}
        >
          <p className="text-xs font-semibold" style={{ color: '#b91c1c' }}>
            Transaction reading took too long.
          </p>
          <p className="text-xs" style={{ color: '#dc2626' }}>
            The OCR service is slow right now. You can retry or enter the details manually.
          </p>
          <div className="flex gap-2">
            <GlassButton
              variant="secondary"
              size="sm"
              onClick={() => {
                images
                  .filter((img) => img.isTimeout)
                  .forEach((img) => retryImage(img.previewUrl))
              }}
            >
              <RefreshCw size={12} />
              Try Again
            </GlassButton>
            <GlassButton
              variant="ghost"
              size="sm"
              onClick={() => {
                const doneImages = images.filter((i) => i.status === 'done')
                onFillRef.current(null, doneImages)
              }}
            >
              Enter Manually
            </GlassButton>
          </div>
        </motion.div>
      )}

      {/* Paste hint — only when no image attached */}
      {!hasImages && (
        <p className="text-[11px] text-center" style={{ color: 'var(--text-faint)' }}>
          You can also paste using{' '}
          <kbd
            className="rounded px-1 py-0.5 font-mono text-[10px]"
            style={{ background: 'rgba(0,0,0,0.06)', color: 'var(--text-muted)' }}
          >
            Ctrl+V
          </kbd>
          {' '}/{' '}
          <kbd
            className="rounded px-1 py-0.5 font-mono text-[10px]"
            style={{ background: 'rgba(0,0,0,0.06)', color: 'var(--text-muted)' }}
          >
            ⌘+V
          </kbd>
        </p>
      )}
    </div>
  )
}
