/**
 * lib/storage/local.adapter.ts — Local filesystem storage adapter.
 *
 * FOR DEVELOPMENT ONLY. Do NOT use in production — files are lost when
 * the container restarts and the filesystem is not shared across instances.
 *
 * Activated when: STORAGE_PROVIDER=local
 *
 * Files are stored in: ./uploads/transaction-proofs/{fileId}/
 *
 * The 'uploads' directory is gitignored.
 */

import type { StorageAdapter, UploadResult, DownloadResult } from './index'
import path from 'path'
import fs from 'fs/promises'
import logger from '@/lib/logger'

if (process.env.NODE_ENV === 'production') {
  throw new Error(
    '[LocalStorage] STORAGE_PROVIDER=local must NOT be used in production. ' +
    'Set STORAGE_PROVIDER=s3 or STORAGE_PROVIDER=azure.'
  )
}

const BASE_DIR = path.join(process.cwd(), 'uploads', 'transaction-proofs')

export class LocalStorageAdapter implements StorageAdapter {
  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true })
  }

  private fileDir(fileId: string): string {
    return path.join(BASE_DIR, fileId)
  }

  async upload(
    fileId: string,
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<UploadResult> {
    const dir     = this.fileDir(fileId)
    const safe    = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const filePath = path.join(dir, safe)

    await this.ensureDir(dir)
    await fs.writeFile(filePath, buffer)

    // Write metadata alongside the file
    await fs.writeFile(
      path.join(dir, 'meta.json'),
      JSON.stringify({ fileId, filename, mimeType, sizeBytes: buffer.length }),
    )

    logger.debug('[LocalStorage] uploaded', { fileId, filePath })
    return { fileId, url: '', key: filePath }
  }

  async download(fileId: string): Promise<DownloadResult> {
    const dir = this.fileDir(fileId)

    const metaRaw = await fs.readFile(path.join(dir, 'meta.json'), 'utf8').catch(() => null)
    if (!metaRaw) throw new Error(`[LocalStorage] File not found: ${fileId}`)

    const meta = JSON.parse(metaRaw) as { filename: string; mimeType: string }

    const safe   = meta.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const buffer = await fs.readFile(path.join(dir, safe))

    return { buffer, mimeType: meta.mimeType, filename: meta.filename }
  }

  async delete(fileId: string): Promise<void> {
    const dir = this.fileDir(fileId)
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    logger.debug('[LocalStorage] deleted', { fileId })
  }

  async getSignedUrl(_fileId: string): Promise<string> {
    return '' // local dev: files served through the API proxy
  }
}
