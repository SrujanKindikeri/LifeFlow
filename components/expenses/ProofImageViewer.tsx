'use client'

/**
 * ProofImageViewer
 *
 * Secure modal viewer for transaction proof screenshots.
 * Images are served from /api/expenses/proof/[fileId] which enforces ownership.
 *
 * Features:
 *  - Zoom in/out (pinch-friendly on mobile via CSS)
 *  - Close
 *  - Optional download (downloads through the secure API endpoint)
 *  - Never exposes a public URL
 */

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ZoomIn, ZoomOut, Download, Loader2, AlertTriangle } from 'lucide-react'

interface Props {
  isOpen: boolean
  fileId: string | null
  filename?: string
  onClose: () => void
}

export function ProofImageViewer({ isOpen, fileId, filename, onClose }: Props) {
  const [zoom,    setZoom]    = useState(1)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // Reset state whenever fileId changes
  useEffect(() => {
    setZoom(1)
    setLoading(true)
    setError(false)
  }, [fileId])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  function zoomIn()  { setZoom((z) => Math.min(z + 0.25, 3)) }
  function zoomOut() { setZoom((z) => Math.max(z - 0.25, 0.5)) }

  async function handleDownload() {
    if (!fileId) return
    try {
      const res = await fetch(`/api/expenses/proof/${fileId}`)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = filename ?? `transaction-proof-${fileId}.png`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // Fail silently — user can try again
    }
  }

  const imageUrl = fileId ? `/api/expenses/proof/${fileId}` : null

  return (
    <AnimatePresence>
      {isOpen && imageUrl && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
            onClick={onClose}
          >
            {/* Viewer card — stop propagation so clicking image doesn't close */}
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="relative flex flex-col rounded-2xl overflow-hidden shadow-2xl"
              style={{
                background: 'rgba(18,18,20,0.96)',
                maxWidth: '90vw',
                maxHeight: '90vh',
                width: 'max-content',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header bar */}
              <div
                className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
                style={{ borderColor: 'rgba(255,255,255,0.08)' }}
              >
                <p
                  className="text-sm font-medium truncate max-w-[240px]"
                  style={{ color: 'rgba(255,255,255,0.8)' }}
                >
                  {filename ?? 'Transaction Proof'}
                </p>

                <div className="flex items-center gap-1 ml-4">
                  <button
                    type="button"
                    onClick={zoomOut}
                    disabled={zoom <= 0.5}
                    aria-label="Zoom out"
                    className="p-2 rounded-lg transition-colors disabled:opacity-40"
                    style={{ color: 'rgba(255,255,255,0.6)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <ZoomOut size={15} />
                  </button>
                  <span
                    className="text-xs tabular-nums w-9 text-center"
                    style={{ color: 'rgba(255,255,255,0.5)' }}
                  >
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={zoomIn}
                    disabled={zoom >= 3}
                    aria-label="Zoom in"
                    className="p-2 rounded-lg transition-colors disabled:opacity-40"
                    style={{ color: 'rgba(255,255,255,0.6)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <ZoomIn size={15} />
                  </button>

                  <div
                    className="w-px h-5 mx-1 flex-shrink-0"
                    style={{ background: 'rgba(255,255,255,0.12)' }}
                  />

                  <button
                    type="button"
                    onClick={handleDownload}
                    aria-label="Download screenshot"
                    className="p-2 rounded-lg transition-colors"
                    style={{ color: 'rgba(255,255,255,0.6)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <Download size={15} />
                  </button>

                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close image viewer"
                    className="p-2 rounded-lg transition-colors"
                    style={{ color: 'rgba(255,255,255,0.6)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* Image area */}
              <div
                className="overflow-auto flex items-center justify-center"
                style={{
                  maxHeight: 'calc(90vh - 56px)',
                  minWidth:  240,
                  minHeight: 120,
                  cursor:    zoom > 1 ? 'move' : 'default',
                }}
              >
                {loading && !error && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 size={28} className="animate-spin" style={{ color: 'rgba(255,255,255,0.4)' }} />
                  </div>
                )}

                {error && (
                  <div className="flex flex-col items-center gap-3 p-8">
                    <AlertTriangle size={28} style={{ color: 'rgba(239,68,68,0.8)' }} />
                    <p className="text-sm text-center" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      Could not load the screenshot.
                    </p>
                  </div>
                )}

                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={imageUrl}
                  alt={filename ?? 'Transaction proof'}
                  className="block transition-transform duration-150"
                  style={{
                    transform:    `scale(${zoom})`,
                    transformOrigin: 'top center',
                    maxWidth:     `${Math.min(85, 600)}vw`,
                    maxHeight:    'calc(90vh - 80px)',
                    display:      error ? 'none' : 'block',
                    imageRendering: 'auto',
                  }}
                  onLoad={() => setLoading(false)}
                  onError={() => { setLoading(false); setError(true) }}
                />
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
