/**
 * lib/storage/s3.adapter.ts — AWS S3 (and S3-compatible) storage adapter.
 *
 * Activated when: STORAGE_PROVIDER=s3
 *
 * Required environment variables:
 *   STORAGE_BUCKET              — S3 bucket name
 *   STORAGE_REGION              — AWS region (e.g. ap-south-1)
 *   STORAGE_ACCESS_KEY_ID       — AWS access key ID (omit to use IAM role)
 *   STORAGE_SECRET_ACCESS_KEY   — AWS secret access key (omit to use IAM role)
 *   STORAGE_ENDPOINT            — (optional) for S3-compatible stores (R2, MinIO)
 *
 * Install the required packages before using this adapter:
 *   npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { StorageAdapter, UploadResult, DownloadResult } from './index'
import logger from '@/lib/logger'

export class S3StorageAdapter implements StorageAdapter {
  private bucket: string
  private region: string
  private endpoint: string | undefined

  constructor() {
    const bucket   = process.env.STORAGE_BUCKET
    const region   = process.env.STORAGE_REGION ?? 'ap-south-1'
    const endpoint = process.env.STORAGE_ENDPOINT

    if (!bucket) {
      throw new Error('[S3Storage] STORAGE_BUCKET environment variable is required')
    }

    this.bucket   = bucket
    this.region   = region
    this.endpoint = endpoint || undefined
  }

  private async getClient(): Promise<any> {
    // Dynamic import — only loads when S3 provider is selected.
    // If @aws-sdk/client-s3 is not installed, this throws at runtime with a
    // clear "Cannot find module" message rather than at build time.
    const { S3Client } = await import('@aws-sdk/client-s3' as any)

    const accessKeyId     = process.env.STORAGE_ACCESS_KEY_ID
    const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY

    const credentials =
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined

    return new S3Client({
      region:         this.region,
      endpoint:       this.endpoint,
      credentials,
      forcePathStyle: !!this.endpoint,
    })
  }

  private objectKey(fileId: string, filename = ''): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    return `transaction-proofs/${fileId}/${safe}`
  }

  async upload(
    fileId: string,
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<UploadResult> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3' as any)
    const client = await this.getClient()
    const key    = this.objectKey(fileId, filename)

    await client.send(
      new PutObjectCommand({
        Bucket:               this.bucket,
        Key:                  key,
        Body:                 buffer,
        ContentType:          mimeType,
        ServerSideEncryption: 'AES256',
        Metadata: {
          'x-file-id':        fileId,
          'x-original-name':  filename,
        },
      })
    )

    logger.info('[S3Storage] uploaded', { fileId, key, sizeBytes: buffer.length })
    return { fileId, url: '', key }
  }

  async download(fileId: string): Promise<DownloadResult> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3' as any)
    const client  = await this.getClient()
    const key     = await this.findKey(fileId)
    if (!key) throw new Error(`[S3Storage] File not found: ${fileId}`)

    const response = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    if (!response.Body) throw new Error(`[S3Storage] Empty response for: ${fileId}`)

    const chunks: Uint8Array[] = []
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk)
    }

    return {
      buffer:   Buffer.concat(chunks),
      mimeType: response.ContentType ?? 'application/octet-stream',
      filename: response.Metadata?.['x-original-name'] ?? fileId,
    }
  }

  async delete(fileId: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3' as any)
    const client = await this.getClient()
    const key    = await this.findKey(fileId)

    if (!key) {
      logger.warn('[S3Storage] delete: file not found', { fileId })
      return
    }

    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
    logger.info('[S3Storage] deleted', { fileId, key })
  }

  async getSignedUrl(fileId: string, expiresInMs = 15 * 60 * 1000): Promise<string> {
    const { GetObjectCommand }  = await import('@aws-sdk/client-s3' as any)
    const { getSignedUrl }      = await import('@aws-sdk/s3-request-presigner' as any)
    const client = await this.getClient()
    const key    = await this.findKey(fileId)
    if (!key) return ''

    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: Math.floor(expiresInMs / 1000) },
    )
  }

  private async findKey(fileId: string): Promise<string | null> {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3' as any)
    const client  = await this.getClient()
    const result  = await client.send(
      new ListObjectsV2Command({
        Bucket:  this.bucket,
        Prefix:  `transaction-proofs/${fileId}/`,
        MaxKeys: 1,
      })
    )
    return result.Contents?.[0]?.Key ?? null
  }
}
