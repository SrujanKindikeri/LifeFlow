/**
 * next.config.ts — Next.js configuration for LifeFlow
 *
 * Designed for deployment on:
 *   - Vercel          (default Next.js output)
 *   - AWS App Runner / ECS / Fargate  (standalone output + Docker)
 *   - Azure App Service / Container Apps  (standalone output + Docker)
 *   - Local development (npm run dev)
 *
 * output: 'standalone' produces a self-contained build in .next/standalone
 * that includes only the required Node.js files — no node_modules copy needed.
 * The Docker image copies this directory and runs node server.js directly.
 *
 * When deploying to Vercel, 'standalone' is ignored — Vercel handles bundling.
 */

import type { NextConfig } from 'next'

// ─── Security headers ─────────────────────────────────────────────────────────

const securityHeaders = [
  // Prevent MIME-type sniffing
  {
    key:   'X-Content-Type-Options',
    value: 'nosniff',
  },
  // Block the site from being embedded in iframes (clickjacking protection)
  {
    key:   'X-Frame-Options',
    value: 'SAMEORIGIN',
  },
  // Control referrer information sent to other sites
  {
    key:   'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  // Disable browser features that LifeFlow doesn't use
  {
    key:   'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  // Force HTTPS in production (HSTS)
  // max-age=31536000 = 1 year; includeSubDomains covers all subdomains
  // NOTE: Only sent when NEXT_PUBLIC_APP_URL starts with https:// so that
  // HTTP-only EC2/Azure test deployments (http://IP:3000) are NOT affected.
  // Sending HSTS over HTTP is meaningless and can confuse some clients.
  ...(process.env.NODE_ENV === 'production' &&
      process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://')
    ? [
        {
          key:   'Strict-Transport-Security',
          value: 'max-age=31536000; includeSubDomains',
        },
      ]
    : []),
  // Content-Security-Policy
  // Tailored to LifeFlow: allows self, Next.js inline scripts, and recharts SVGs.
  // Tighten nonces or hash-based CSP once the app is stable.
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next.js requires 'unsafe-inline' for dev HMR; inline scripts are needed
      // for Next.js App Router hydration chunks in production.
      // Replace with nonce-based CSP for stricter security.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // Images: self + data URIs (for inline SVGs / recharts)
      "img-src 'self' data: blob:",
      // Fonts served from same origin
      "font-src 'self'",
      // API calls: only to self + Google Vision (if OCR provider is google_vision)
      "connect-src 'self' https://vision.googleapis.com",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      // Allow our own service worker bundle (Next.js webpack worker chunk)
      "worker-src 'self' blob:",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  // ─── Output mode ───────────────────────────────────────────────────────────
  //
  // 'standalone' creates .next/standalone — a minimal self-contained Node.js
  // server that can run without node_modules. Used by the Docker image.
  //
  // Vercel ignores this setting and uses its own bundling pipeline.
  output: 'standalone',

  // ─── Security headers ───────────────────────────────────────────────────────
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },

  // ─── Redirects ──────────────────────────────────────────────────────────────
  async redirects() {
    return [
      { source: '/app/bills', destination: '/app/dashboard', permanent: false },
    ]
  },

  // ─── Server external packages ───────────────────────────────────────────────
  // Packages that should NOT be bundled by webpack — they use native bindings
  // or are too large to bundle efficiently.
  serverExternalPackages: [
    'mongoose',
    'tesseract.js',
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
    '@azure/storage-blob',
    '@azure/identity',
    'nodemailer',
    'resend',
    '@sendgrid/mail',
    'web-push',
  ],

  // ─── Image optimization ─────────────────────────────────────────────────────
  images: {
    // No external image domains needed — all images are user-uploaded and
    // served through /api/expenses/proof/[fileId] (not next/image)
    remotePatterns: [],
  },

}

export default nextConfig
