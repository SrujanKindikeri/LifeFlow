/**
 * lib/storage/mongodb.adapter.ts — MongoDB base64 storage adapter.
 *
 * Stores uploaded files as base64 strings in the TransactionProof collection.
 * This is the default provider — it requires no extra dependencies and works
 * on every hosting platform.
 *
 * Suitable for: development, small deployments, < ~10 000 receipts.
 * For larger deployments, switch to STORAGE_PROVIDER=s3 or STORAGE_PROVIDER=azure.
 */

import type { StorageAdapter, UploadResult, DownloadResult } from './index'
import { connectDB } from '@/lib/db'
import TransactionProof from '@/models/TransactionProof'
import mongoose from 'mongoose'
import logger from '@/lib/logger'

export class MongoDBStorageAdapter implements StorageAdapter {
  async upload(
    fileId: string,
    buffer: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<UploadResult> {
    // The MongoDB adapter stores data directly in TransactionProof.
    // The fileId IS the MongoDB document _id — callers must create the
    // TransactionProof document themselves (as the scan-upload route currently does).
    // This adapter is used for download/delete/getSignedUrl operations.
    // Upload is handled natively by the route for backwards compatibility.
    logger.debug('[MongoDBStorage] upload called', { fileId, filename })
    return { fileId, url: '', key: fileId }
  }

  async download(fileId: string): Promise<DownloadResult> {
    await connectDB()

    const proof = await TransactionProof
      .findById(fileId)
      .select('+data')
      .lean()

    if (!proof) {
      throw new Error(`File not found: ${fileId}`)
    }

    const buffer = Buffer.from(proof.data, 'base64')
    return {
      buffer,
      mimeType: proof.mimeType,
      filename: proof.filename,
    }
  }

  async delete(fileId: string): Promise<void> {
    await connectDB()

    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      throw new Error(`Invalid file ID: ${fileId}`)
    }

    await TransactionProof.deleteOne({ _id: fileId })
    logger.debug('[MongoDBStorage] deleted', { fileId })
  }

  async getSignedUrl(_fileId: string, _expiresInMs?: number): Promise<string> {
    // MongoDB adapter serves files through /api/expenses/proof/[fileId]
    // which is already ownership-gated. No signed URL needed.
    return ''
  }
}
