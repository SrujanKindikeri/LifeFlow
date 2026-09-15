/**
 * lib/receiptVision/validator.ts
 *
 * Zod schema validation for ReceiptExtraction.
 *
 * Validates the output from any vision provider before it enters the
 * reconciliation and UI pipeline.
 *
 * All financial fields must be non-negative integers (minor units/paise).
 * grandTotalMinor may be null — never coerced to 0.
 */

import { z } from 'zod'
import type { ReceiptExtraction, TaxType } from './types'
import { ReceiptVisionError } from './types'

// ─── Helpers ───────────────────────────────────────────────────────────────────

const minorUnits = z
  .number()
  .int('Financial values must be integers (paise)')
  .nonnegative('Financial values cannot be negative')
  .safe()

const confidence = z
  .number()
  .min(0, 'Confidence must be ≥ 0')
  .max(1, 'Confidence must be ≤ 1')

const VALID_TAX_TYPES: TaxType[] = [
  'cgst', 'sgst', 'igst', 'gst', 'vat',
  'service_charge', 'packing', 'delivery', 'other',
]

function coerceTaxType(raw: string | undefined | null): TaxType {
  if (!raw) return 'other'
  const lower = raw.toLowerCase().trim().replace(/[\s-]/g, '_')
  return (VALID_TAX_TYPES as string[]).includes(lower) ? (lower as TaxType) : 'other'
}

// ─── Schemas ───────────────────────────────────────────────────────────────────

const ItemFieldConfidenceSchema = z.object({
  name:      confidence,
  quantity:  confidence,
  unitPrice: confidence,
  lineTotal: confidence,
})

const ReceiptItemSchema = z.object({
  name:           z.string().trim().min(1).max(200),
  quantity:       z.number().int().positive(),
  unitPriceMinor: minorUnits,
  lineTotalMinor: minorUnits,
  confidence:     ItemFieldConfidenceSchema,
})

const TaxEntrySchema = z.object({
  name:        z.string().trim().min(1).max(100),
  type:        z.string().optional().nullable(),
  rate:        z.number().min(0).max(100).nullable().optional(),
  amountMinor: minorUnits,
}).transform((t) => ({
  name:        t.name,
  type:        coerceTaxType(t.type ?? undefined),
  rate:        t.rate ?? null,
  amountMinor: t.amountMinor,
}))

const MerchantInfoSchema = z.object({
  name:    z.string().trim().max(200).nullable().optional(),
  address: z.string().trim().max(500).nullable().optional(),
  phone:   z.string().trim().max(30).nullable().optional(),
  gstin:   z.string().trim().max(20).nullable().optional(),
  fssai:   z.string().trim().max(30).nullable().optional(),
}).transform((m) => ({
  name:    m.name    ?? null,
  address: m.address ?? null,
  phone:   m.phone   ?? null,
  gstin:   m.gstin   ?? null,
  fssai:   m.fssai   ?? null,
}))

const BillMetadataSchema = z.object({
  number:      z.string().trim().max(100).nullable().optional(),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  time:        z.string().trim().max(10).nullable().optional(),
  orderType:   z.string().trim().max(50).nullable().optional(),
  tableNumber: z.string().trim().max(20).nullable().optional(),
  tokenNumber: z.string().trim().max(20).nullable().optional(),
  cashier:     z.string().trim().max(100).nullable().optional(),
}).transform((b) => ({
  number:      b.number      ?? null,
  date:        b.date        ?? null,
  time:        b.time        ?? null,
  orderType:   b.orderType   ?? null,
  tableNumber: b.tableNumber ?? null,
  tokenNumber: b.tokenNumber ?? null,
  cashier:     b.cashier     ?? null,
}))

const ReceiptExtractionSchema = z.object({
  merchant:           MerchantInfoSchema.optional(),
  bill:               BillMetadataSchema.optional(),
  items:              z.array(ReceiptItemSchema).max(200),
  subtotalMinor:      minorUnits.nullable().optional(),
  taxes:              z.array(TaxEntrySchema).max(20),
  serviceChargeMinor: minorUnits.default(0),
  discountMinor:      minorUnits.default(0),
  roundOffMinor:      z.number().int().default(0),
  grandTotalMinor:    minorUnits.nullable(),
  overallConfidence:  confidence,
  provider:           z.enum(['ai', 'ollama', 'tesseract']).default('tesseract'),
}).strip()

// ─── Validator function ────────────────────────────────────────────────────────

export function validateExtractionSchema(raw: unknown): ReceiptExtraction {
  const result = ReceiptExtractionSchema.safeParse(raw)

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
      .join('; ')
    throw new ReceiptVisionError(
      'schema_invalid',
      `Receipt extraction failed schema validation: ${issues}`,
    )
  }

  const d = result.data

  return {
    merchant:           d.merchant ?? { name: null, address: null, phone: null, gstin: null, fssai: null },
    bill:               d.bill ?? { number: null, date: null, time: null, orderType: null, tableNumber: null, tokenNumber: null, cashier: null },
    items:              d.items,
    subtotalMinor:      d.subtotalMinor ?? null,
    taxes:              d.taxes,
    serviceChargeMinor: d.serviceChargeMinor,
    discountMinor:      d.discountMinor,
    roundOffMinor:      d.roundOffMinor,
    grandTotalMinor:    d.grandTotalMinor,
    overallConfidence:  d.overallConfidence,
    provider:           d.provider,
  }
}

export function looksLikeExtractionAttempt(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'items' in raw &&
    Array.isArray((raw as Record<string, unknown>).items)
  )
}
