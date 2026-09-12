/**
 * app/manifest.ts — PWA web app manifest.
 *
 * Next.js App Router auto-serves this as /manifest.webmanifest.
 * Required for browser "Add to Home Screen" prompts and for push notifications
 * on iOS 16.4+ (only when installed to the home screen).
 *
 * Icons: place icon-192.png and icon-512.png in /public/.
 * Until real icons are added the browser will fall back to the favicon.
 * badge-96.png should also be placed in /public/ for the notification badge.
 */

import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             'LifeFlow',
    short_name:       'LifeFlow',
    description:      'Plan. Focus. Achieve. — Your personal life operating system.',
    start_url:        '/app/dashboard',
    scope:            '/',
    display:          'standalone',
    orientation:      'portrait',
    background_color: '#ffffff',
    theme_color:      '#2563eb',
    categories:       ['productivity', 'lifestyle', 'finance'],
    icons: [
      {
        src:     '/icon-192.png',
        sizes:   '192x192',
        type:    'image/png',
        purpose: 'maskable',
      },
      {
        src:     '/icon-512.png',
        sizes:   '512x512',
        type:    'image/png',
        purpose: 'maskable',
      },
      {
        src:     '/icon-192.png',
        sizes:   '192x192',
        type:    'image/png',
        purpose: 'any',
      },
    ],
  }
}
