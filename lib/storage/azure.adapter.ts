/**
 * lib/storage/azure.adapter.ts — Azure Blob Storage adapter.
 *
 * Activated when: STORAGE_PROVIDER=azure
 *
 * Required environment variables:
 *   AZURE_STORAGE_ACCOUNT_NAME  — Storage account name
 *   AZURE_STORAGE_CONTAINER     — Blob container name (default: transaction-proofs)
 *   AZURE_STORAGE_ACCOUNT_KEY   — Storage account key (omit to use Managed Identity)
 *
 * Install the required packages before using this adapter:
 *   npm install @azure/storage-blob
 *   npm install @azure/identity   # only needed for Managed Identity auth
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { StorageAdapter, UploadResult, DownloadResult } from './index'
import logger from '@/lib/logger'

export class AzureBlobStorageAdapter implements StorageAdapter {
  private accountName: string
  private containerName: string

  constructor() {
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME
    const container   = process.env.AZURE_STORAGE_CONTAINER ?? 'transaction-proofs'

    if (!accountName) {
      throw new Error(
        '[AzureStorage] AZURE_STORAGE_ACCOUNT_NAME environment variable is required'
      )
    }

    this.accountName   = accountName
    this.containerName = container
  }

  private async getContainerClient(): Promise<any> {
    const { BlobServiceClient } = await import('@azure/storage-blob' as any)
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY

    let serviceClient: any

    if (accountKey) {
      const { StorageSharedKeyCredential } = await import('@azure/storage-blob' as any)
      const credential = new StorageSharedKeyCredential(this.accountName, accountKey)
      serviceClient    = new BlobServiceClient(
        `https://${this.accountName}.blob.core.windows.net`,
        credential,
      )
    } else {
      // Managed Identity — requires @azure/identity
      const { DefaultAzureCredential } = await import('@azure/identity' as any)
      serviceClient = new BlobServiceClient(
        `https://${this.accountName}.blob.core.windows.net`,
        new DefaultAzureCredential(),
      )
    }

    return serviceClient.getContainerClient(this.containerName)
  }

  private blobName(fileId: string, filename = ''): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    return `${fileId}/${safe}`
  }

  async upload(
    fileId: string,
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<UploadResult> {
    const container  = await this.getContainerClient()
    await container.createIfNotExists({ access: 'private' })

    const blobName = this.blobName(fileId, filename)
    const blockBlob = container.getBlockBlobClient(blobName)

    await blockBlob.upload(buffer, buffer.length, {
      blobHTTPHeaders: { blobContentType: mimeType },
      metadata: { fileId, originalFilename: filename },
    })

    logger.info('[AzureStorage] uploaded', { fileId, blobName, sizeBytes: buffer.length })
    return { fileId, url: '', key: blobName }
  }

  async download(fileId: string): Promise<DownloadResult> {
    const container = await this.getContainerClient()
    const blobName  = await this.findBlob(fileId)
    if (!blobName) throw new Error(`[AzureStorage] File not found: ${fileId}`)

    const blockBlob  = container.getBlockBlobClient(blobName)
    const properties = await blockBlob.getProperties()
    const downloaded = await blockBlob.downloadToBuffer()

    return {
      buffer:   downloaded,
      mimeType: properties.contentType ?? 'application/octet-stream',
      filename: properties.metadata?.originalFilename ?? fileId,
    }
  }

  async delete(fileId: string): Promise<void> {
    const container = await this.getContainerClient()
    const blobName  = await this.findBlob(fileId)

    if (!blobName) {
      logger.warn('[AzureStorage] delete: blob not found', { fileId })
      return
    }

    await container.getBlockBlobClient(blobName).deleteIfExists()
    logger.info('[AzureStorage] deleted', { fileId, blobName })
  }

  async getSignedUrl(fileId: string, expiresInMs = 15 * 60 * 1000): Promise<string> {
    const {
      generateBlobSASQueryParameters,
      BlobSASPermissions,
      StorageSharedKeyCredential,
    } = await import('@azure/storage-blob' as any)

    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY
    if (!accountKey) {
      logger.warn('[AzureStorage] getSignedUrl: no account key — falling back to proxy')
      return ''
    }

    const container = await this.getContainerClient()
    const blobName  = await this.findBlob(fileId)
    if (!blobName) return ''

    const credential  = new StorageSharedKeyCredential(this.accountName, accountKey)
    const expiresOn   = new Date(Date.now() + expiresInMs)
    const permissions = BlobSASPermissions.parse('r')

    const sasQuery = generateBlobSASQueryParameters(
      { containerName: this.containerName, blobName, permissions, expiresOn },
      credential,
    ).toString()

    return `${container.getBlockBlobClient(blobName).url}?${sasQuery}`
  }

  private async findBlob(fileId: string): Promise<string | null> {
    const container = await this.getContainerClient()
    for await (const item of container.listBlobsFlat({ prefix: `${fileId}/` })) {
      if (item.name) return item.name as string
    }
    return null
  }
}
