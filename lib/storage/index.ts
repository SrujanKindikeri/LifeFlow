/**
 * lib/storage/index.ts — Provider-neutral storage abstraction for LifeFlow.
 *
 * The application calls storage.upload(), storage.download(), etc.
 * The actual provider (MongoDB/base64, S3, Azure Blob) is selected at runtime
 * via the STORAGE_PROVIDER environment variable.
 *
 * Supported providers:
 *   mongodb — stores file data as base64 in TransactionProof (default, zero deps)
 *   s3      — AWS S3 or any S3-compatible object store (R2, MinIO, etc.)
 *   azure   — Azure Blob Storage
 *   local   — local filesystem (development only, NOT for production)
 *
 * Adding a new provider:
 *   1. Create lib/storage/<provider>.adapter.ts implementing StorageAdapter
 *   2. Register it in createStorageService() below
 *
 * Application code must only import StorageService from this file and
 * call storage.upload() etc. — never import provider SDKs directly.
 */

export interface UploadResult {
  /** Opaque identifier used to retrieve/delete the file */
  fileId: string
  /** Public or signed URL for the file (may be empty for MongoDB provider) */
  url: string
  /** Provider-specific key / path */
  key: string
}

export interface DownloadResult {
  /** Raw file bytes */
  buffer: Buffer
  /** MIME type stored at upload time */
  mimeType: string
  /** Original filename */
  filename: string
}

export interface StorageAdapter {
  /**
   * Upload a file.
   *
   * @param fileId    — caller-supplied stable identifier (e.g. MongoDB ObjectId string)
   * @param buffer    — file bytes
   * @param mimeType  — MIME type (e.g. 'image/jpeg')
   * @param filename  — original filename for display purposes
   */
  upload(
    fileId: string,
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<UploadResult>

  /**
   * Download a file by its fileId.
   */
  download(fileId: string): Promise<DownloadResult>

  /**
   * Delete a file by its fileId.
   */
  delete(fileId: string): Promise<void>

  /**
   * Generate a time-limited signed URL for direct browser access.
   * Returns an empty string for providers that don't support signed URLs.
   *
   * @param fileId      — the file identifier
   * @param expiresInMs — URL validity in milliseconds (default 15 min)
   */
  getSignedUrl(fileId: string, expiresInMs?: number): Promise<string>
}

// ─── Factory ──────────────────────────────────────────────────────────────────

let _instance: StorageAdapter | null = null

/**
 * Returns the singleton storage adapter selected by STORAGE_PROVIDER.
 *
 * We use a lazy singleton so adapters are only loaded/validated when first
 * needed — avoids importing cloud SDKs during build time.
 */
export async function getStorageService(): Promise<StorageAdapter> {
  if (_instance) return _instance

  const provider = (process.env.STORAGE_PROVIDER ?? 'mongodb').toLowerCase()

  switch (provider) {
    case 's3': {
      const { S3StorageAdapter } = await import('./s3.adapter')
      _instance = new S3StorageAdapter()
      break
    }
    case 'azure': {
      const { AzureBlobStorageAdapter } = await import('./azure.adapter')
      _instance = new AzureBlobStorageAdapter()
      break
    }
    case 'local': {
      const { LocalStorageAdapter } = await import('./local.adapter')
      _instance = new LocalStorageAdapter()
      break
    }
    case 'mongodb':
    default: {
      // MongoDB adapter — stores base64 in TransactionProof documents.
      // Zero extra dependencies, works everywhere, suitable for < 10 000 proofs.
      const { MongoDBStorageAdapter } = await import('./mongodb.adapter')
      _instance = new MongoDBStorageAdapter()
      break
    }
  }

  return _instance
}

/** Reset the singleton (used in tests) */
export function resetStorageService(): void {
  _instance = null
}
