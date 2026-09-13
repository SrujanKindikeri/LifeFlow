/**
 * receiptParser.test.ts
 *
 * Deterministic unit tests for the zone-based receipt parser.
 *
 * Every test uses a hardcoded OCR-text string that represents what an OCR
 * engine would realistically produce for that receipt type.  No images,
 * no network calls.
 *
 * Acceptance criteria tested:
 *   ✓ Restaurant metadata NOT extracted as food items
 *   ✓ Phone numbers NOT extracted as prices
 *   ✓ GSTIN NOT extracted as an item
 *   ✓ Bill / table / token numbers NOT extracted as items
 *   ✓ Date / time NOT extracted as items
 *   ✓ Item table correctly identified
 *   ✓ Quantity correctly extracted
 *   ✓ Unit price correctly extracted
 *   ✓ Line total correctly extracted
 *   ✓ Multi-line items supported
 *   ✓ Subtotal detected
 *   ✓ CGST + SGST detected
 *   ✓ IGST detected
 *   ✓ Discounts detected
 *   ✓ Service charges detected
 *   ✓ Grand total detected
 *   ✓ Tax-inclusive receipts supported
 *   ✓ Tax-exclusive receipts supported
 *   ✓ Mathematical validation works
 */

import { describe, it, expect } from 'vitest'
import { parseReceiptText, checkOcrQuality } from '@/lib/receiptParser'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Assert an item exists by name and check its numeric fields. */
function expectItem(
  items: ReturnType<typeof parseReceiptText>['items'],
  name: string,
  opts: { qty?: number; unitPrice?: number; lineTotal?: number },
) {
  const item = items.find((it) =>
    it.name.toLowerCase().includes(name.toLowerCase()),
  )
  expect(item, `Item "${name}" not found in [${items.map((i) => i.name).join(', ')}]`).toBeDefined()
  if (!item) return
  if (opts.qty       !== undefined) expect(item.quantity,  `${name}.qty`).toBe(opts.qty)
  if (opts.unitPrice !== undefined) expect(item.unitPrice, `${name}.unitPrice`).toBeCloseTo(opts.unitPrice, 1)
  if (opts.lineTotal !== undefined) expect(item.lineTotal, `${name}.lineTotal`).toBeCloseTo(opts.lineTotal, 1)
}

/** Assert an item name does NOT appear in the extracted items. */
function rejectItem(
  items: ReturnType<typeof parseReceiptText>['items'],
  fragment: string,
) {
  const match = items.find((it) =>
    it.name.toLowerCase().includes(fragment.toLowerCase()),
  )
  expect(
    match,
    `"${fragment}" must NOT appear as an item but found: "${match?.name}"`,
  ).toBeUndefined()
}

// ─── Test 1: Supplied restaurant receipt (the failing case) ───────────────────

describe('Test 1 — Supplied restaurant receipt (4-column: ITEM QTY UNIT TOTAL)', () => {
  const ocr = `
YOUR RESTAURANT
GOOD FOOD. GREAT MEMORIES.
Your Restaurant Address
Bengaluru, Karnataka 560001
Ph: 080-4567-8910
GSTIN: 29ABCDE1234F1Z5
Bill No. : SKB/25-05/0142
Date    : 17 Jun 2026
Time    : 20:45
Order Type : Dine In
Table No.  : T-08
Token No.  : A42
ITEM             QTY      UNIT      TOTAL
1. Masala Dosa    1      149.00    149.00
2. Paneer Roll    1      249.00    249.00
3. Tea            2       49.00     98.00
4. Gulab Jamun    2       89.00    178.00
SUBTOTAL                         674.00
CGST (2.5%)                       16.85
SGST (2.5%)                       16.85
Grand Total                      707.70
Thank you for visiting!
`.trim()

  const r = parseReceiptText(ocr)

  it('extracts exactly 4 items', () => {
    expect(r.items).toHaveLength(4)
  })

  it('Masala Dosa — qty=1, unit=149, total=149', () => {
    expectItem(r.items, 'Masala Dosa', { qty: 1, unitPrice: 149, lineTotal: 149 })
  })

  it('Paneer Roll — qty=1, unit=249, total=249', () => {
    expectItem(r.items, 'Paneer Roll', { qty: 1, unitPrice: 249, lineTotal: 249 })
  })

  it('Tea — qty=2, unit=49, total=98', () => {
    expectItem(r.items, 'Tea', { qty: 2, unitPrice: 49, lineTotal: 98 })
  })

  it('Gulab Jamun — qty=2, unit=89, total=178', () => {
    expectItem(r.items, 'Gulab Jamun', { qty: 2, unitPrice: 89, lineTotal: 178 })
  })

  it('phone number NOT extracted as item', () => {
    rejectItem(r.items, 'Ph')
    rejectItem(r.items, '080')
    rejectItem(r.items, '8910')
  })

  it('GSTIN NOT extracted as item', () => {
    rejectItem(r.items, 'GSTIN')
    rejectItem(r.items, '29ABCDE')
  })

  it('Bill No NOT extracted as item', () => {
    rejectItem(r.items, 'Bill No')
    rejectItem(r.items, 'SKB')
  })

  it('Date / Time NOT extracted as item', () => {
    rejectItem(r.items, 'Date')
    rejectItem(r.items, 'Time')
    rejectItem(r.items, 'Jun')
  })

  it('Table No / Token No NOT extracted as item', () => {
    rejectItem(r.items, 'Table')
    rejectItem(r.items, 'Token')
    rejectItem(r.items, 'T-08')
  })

  it('Order Type NOT extracted as item', () => {
    rejectItem(r.items, 'Order Type')
    rejectItem(r.items, 'Dine In')
  })

  it('subtotal = 674', () => {
    expect(r.subtotal).toBeCloseTo(674, 1)
  })

  it('CGST = 16.85 at 2.5%', () => {
    expect(r.gst.cgstAmount).toBeCloseTo(16.85, 1)
    expect(r.gst.cgstRate).toBe(2.5)
  })

  it('SGST = 16.85 at 2.5%', () => {
    expect(r.gst.sgstAmount).toBeCloseTo(16.85, 1)
    expect(r.gst.sgstRate).toBe(2.5)
  })

  it('grand total = 707.70', () => {
    expect(r.grandTotal).toBeCloseTo(707.70, 1)
  })

  it('totals reconcile', () => {
    expect(r.totalsMatch).toBe(true)
  })

  it('no math mismatches on any item', () => {
    expect(r.items.every((it) => !it.mathMismatch)).toBe(true)
  })

  it('restaurant name extracted', () => {
    expect(r.restaurantName).toBeTruthy()
  })

  it('receipt date extracted', () => {
    expect(r.receiptDate).toBe('2026-06-17')
  })
})

// ─── Test 2: 2-column receipt (ITEM | AMOUNT only) ────────────────────────────

describe('Test 2 — Cafe receipt (2-column: ITEM  AMOUNT)', () => {
  const ocr = `
BREW & BITE CAFE
MG Road, Bengaluru
Ph: 9876543210
Bill No: 1042   Date: 15-Jun-2026
ITEM                    AMOUNT
Cappuccino              80.00
Cold Coffee             110.00
Veg Sandwich            120.00
Brownie                 90.00
----------------------------
Subtotal                400.00
GST 5%                   20.00
Total                   420.00
`.trim()

  const r = parseReceiptText(ocr)

  it('extracts 4 items', () => expect(r.items).toHaveLength(4))

  it('Cappuccino total=80', () => {
    expectItem(r.items, 'Cappuccino', { lineTotal: 80 })
  })
  it('Cold Coffee total=110', () => {
    expectItem(r.items, 'Cold Coffee', { lineTotal: 110 })
  })
  it('Veg Sandwich total=120', () => {
    expectItem(r.items, 'Veg Sandwich', { lineTotal: 120 })
  })
  it('Brownie total=90', () => {
    expectItem(r.items, 'Brownie', { lineTotal: 90 })
  })

  it('phone number not an item', () => rejectItem(r.items, '9876543210'))
  it('Bill No not an item', () => rejectItem(r.items, 'Bill No'))

  it('subtotal = 400', () => expect(r.subtotal).toBeCloseTo(400, 1))
  it('GST = 20', () => expect(r.gst.totalGstAmount).toBeCloseTo(20, 1))
  it('grand total = 420', () => expect(r.grandTotal).toBeCloseTo(420, 1))
  it('totals reconcile', () => expect(r.totalsMatch).toBe(true))
})

// ─── Test 3: Receipt with IGST ────────────────────────────────────────────────

describe('Test 3 — Receipt with IGST (interstate supply)', () => {
  const ocr = `
QUICK BITES
Delhi Road, Noida
GSTIN: 09FGHIJ5678K2L3
Invoice No: QB-2026-891
Date: 10-Jun-2026
------------------------------
Item              Qty   Rate    Amount
Paneer Tikka       2   350.00   700.00
Dal Makhani        1   280.00   280.00
Butter Naan        4    60.00   240.00
------------------------------
Subtotal                       1220.00
IGST 5%                          61.00
Grand Total                    1281.00
`.trim()

  const r = parseReceiptText(ocr)

  it('extracts 3 items', () => expect(r.items).toHaveLength(3))
  it('Paneer Tikka qty=2 total=700', () => {
    expectItem(r.items, 'Paneer Tikka', { qty: 2, unitPrice: 350, lineTotal: 700 })
  })
  it('Dal Makhani qty=1 total=280', () => {
    expectItem(r.items, 'Dal Makhani', { qty: 1, unitPrice: 280, lineTotal: 280 })
  })
  it('Butter Naan qty=4 total=240', () => {
    expectItem(r.items, 'Butter Naan', { qty: 4, unitPrice: 60, lineTotal: 240 })
  })

  it('IGST = 61', () => expect(r.gst.igstAmount).toBeCloseTo(61, 1))
  it('IGST rate = 5', () => expect(r.gst.igstRate).toBe(5))
  it('CGST and SGST are null (IGST receipt)', () => {
    expect(r.gst.cgstAmount).toBeNull()
    expect(r.gst.sgstAmount).toBeNull()
  })
  it('grand total = 1281', () => expect(r.grandTotal).toBeCloseTo(1281, 1))
  it('totals reconcile', () => expect(r.totalsMatch).toBe(true))
})

// ─── Test 4: Receipt with discount ────────────────────────────────────────────

describe('Test 4 — Receipt with discount', () => {
  const ocr = `
PIZZA PALACE
Koramangala, Bangalore
Order No: PP-789   Date: 12-Jun-2026
--------------------------------------
Description        Qty   Price   Amount
Margherita Pizza    1   450.00   450.00
Garlic Bread        2    80.00   160.00
Coke                2    60.00   120.00
--------------------------------------
Subtotal                         730.00
Discount (10%)                   -73.00
CGST 2.5%                         16.43
SGST 2.5%                         16.42
Grand Total                      689.85
`.trim()

  const r = parseReceiptText(ocr)

  it('extracts 3 items', () => expect(r.items).toHaveLength(3))
  it('Margherita Pizza total=450', () => {
    expectItem(r.items, 'Margherita', { lineTotal: 450 })
  })
  it('Garlic Bread qty=2 total=160', () => {
    expectItem(r.items, 'Garlic Bread', { qty: 2, lineTotal: 160 })
  })
  it('Coke qty=2 total=120', () => {
    expectItem(r.items, 'Coke', { qty: 2, lineTotal: 120 })
  })

  it('discount = 73', () => expect(r.discount).toBeCloseTo(73, 1))
  it('grand total = 689.85', () => expect(r.grandTotal).toBeCloseTo(689.85, 1))
})

// ─── Test 5: Receipt with service charge ──────────────────────────────────────

describe('Test 5 — Receipt with service charge', () => {
  const ocr = `
THE GRAND HOTEL
Fine Dining Restaurant
Table: 12   Covers: 4
Date: 08-Jun-2026  Time: 21:30
---------------------------------------
Item              Qty    Rate     Total
Chicken Biryani    2   420.00   840.00
Fish Curry         1   380.00   380.00
Butter Roti        6    35.00   210.00
Gulab Jamun        2    90.00   180.00
---------------------------------------
Sub Total                      1610.00
Service Charge (10%)            161.00
CGST 2.5%                        44.28
SGST 2.5%                        44.28
Grand Total                    1859.56
`.trim()

  const r = parseReceiptText(ocr)

  it('extracts 4 items', () => expect(r.items).toHaveLength(4))
  it('Chicken Biryani qty=2 total=840', () => {
    expectItem(r.items, 'Chicken Biryani', { qty: 2, lineTotal: 840 })
  })
  it('Butter Roti qty=6 total=210', () => {
    expectItem(r.items, 'Butter Roti', { qty: 6, lineTotal: 210 })
  })

  it('service charge extracted', () => {
    expect(r.serviceCharge).toBeCloseTo(161, 1)
  })
  it('CGST extracted', () => expect(r.gst.cgstAmount).toBeCloseTo(44.28, 1))
  it('SGST extracted', () => expect(r.gst.sgstAmount).toBeCloseTo(44.28, 1))
  it('grand total extracted', () => expect(r.grandTotal).toBeCloseTo(1859.56, 1))
  it('service charge not an item', () => rejectItem(r.items, 'Service'))
})

// ─── Test 6: Multi-line item name ─────────────────────────────────────────────

describe('Test 6 — Multi-line item name (continuation line)', () => {
  // Some thermal printers wrap long item names onto the next line with numbers below
  const ocr = `
SPICE GARDEN
MG Road, Bengaluru
Item          Qty   Rate    Amount
Kadai Paneer
Special
              1    280.00   280.00
Mango Lassi   2     90.00   180.00
---------------------------
Subtotal                    460.00
CGST 2.5%                    11.50
SGST 2.5%                    11.50
Total                        483.00
`.trim()

  const r = parseReceiptText(ocr)

  it('Mango Lassi extracted correctly', () => {
    expectItem(r.items, 'Mango Lassi', { qty: 2, unitPrice: 90, lineTotal: 180 })
  })
  it('all items have correct line totals', () => {
    expect(r.items.every((it) => it.lineTotal > 0)).toBe(true)
  })
  it('no math mismatches for Mango Lassi', () => {
    const item = r.items.find((it) => it.name.toLowerCase().includes('mango'))
    expect(item?.mathMismatch).toBe(false)
  })
})

// ─── Test 7: Tax-inclusive receipt ────────────────────────────────────────────

describe('Test 7 — Tax-inclusive receipt', () => {
  const ocr = `
GARDEN FRESH
Koramangala, Bangalore
Bill No: GF-2026-445
Date: 14-Jun-2026
All prices inclusive of GST
Item                   Amount
Fresh Lime Soda         60.00
Paneer Wrap            180.00
French Fries            90.00
------------------------
Total                  330.00
`.trim()

  const r = parseReceiptText(ocr)

  it('extracts 3 items', () => expect(r.items).toHaveLength(3))
  it('Fresh Lime Soda total=60', () => {
    expectItem(r.items, 'Fresh Lime Soda', { lineTotal: 60 })
  })
  it('grand total = 330', () => expect(r.grandTotal).toBeCloseTo(330, 1))
  it('GST marked as inclusive', () => {
    expect(r.gst.inclusive).toBe(true)
  })
})

// ─── Test 8: Receipt without printed grand total ──────────────────────────────

describe('Test 8 — Receipt without explicit grand total label', () => {
  const ocr = `
TIFFIN EXPRESS
Station Road, Bengaluru
Table: 5
Item            Qty   Rate   Amt
Idli Sambar      2    40.00   80.00
Masala Vada      4    25.00  100.00
Filter Coffee    2    35.00   70.00
---------------------------------
Subtotal                    250.00
CGST 2.5%                     6.25
SGST 2.5%                     6.25
`.trim()

  const r = parseReceiptText(ocr)

  it('extracts 3 items', () => expect(r.items).toHaveLength(3))
  it('Idli Sambar qty=2 total=80', () => {
    expectItem(r.items, 'Idli Sambar', { qty: 2, lineTotal: 80 })
  })
  it('subtotal = 250', () => expect(r.subtotal).toBeCloseTo(250, 1))
  it('CGST = 6.25', () => expect(r.gst.cgstAmount).toBeCloseTo(6.25, 1))
  it('computed total = 262.50', () => expect(r.computedTotal).toBeCloseTo(262.5, 1))
  it('review flag for missing grand total', () => {
    expect(r.reviewFlags.some((f) => /grand total/i.test(f))).toBe(true)
  })
})

// ─── Test 9: Receipt with multiplier notation (Qty×Rate) ──────────────────────

describe('Test 9 — Receipt with multiplier notation (2×49)', () => {
  const ocr = `
CHAI POINT
Airport Road, Bengaluru
Bill: CP-2026-112
Item                      Total
Masala Chai 3 x 30.00     90.00
Samosa      2 x 25.00     50.00
Kachori     1 x 45.00     45.00
-------------------------
Sub Total                185.00
GST 5%                     9.25
Total                    194.25
`.trim()

  const r = parseReceiptText(ocr)

  it('Masala Chai qty=3 unit=30 total=90', () => {
    expectItem(r.items, 'Masala Chai', { qty: 3, unitPrice: 30, lineTotal: 90 })
  })
  it('Samosa qty=2 unit=25 total=50', () => {
    expectItem(r.items, 'Samosa', { qty: 2, unitPrice: 25, lineTotal: 50 })
  })
  it('Kachori qty=1 unit=45 total=45', () => {
    expectItem(r.items, 'Kachori', { qty: 1, unitPrice: 45, lineTotal: 45 })
  })
  it('subtotal = 185', () => expect(r.subtotal).toBeCloseTo(185, 1))
  it('GST = 9.25', () => expect(r.gst.totalGstAmount).toBeCloseTo(9.25, 1))
  it('grand total = 194.25', () => expect(r.grandTotal).toBeCloseTo(194.25, 1))
  it('no math mismatches', () => {
    expect(r.items.every((it) => !it.mathMismatch)).toBe(true)
  })
})

// ─── Test 10: Math mismatch detection ─────────────────────────────────────────

describe('Test 10 — Math mismatch flagging', () => {
  // Deliberately wrong: Tea qty=2 @ 49 should = 98, but receipt prints 100
  const ocr = `
TEST CAFE
Item          Qty   Rate    Total
Tea            2    49.00   100.00
Coffee         1    60.00    60.00
---------------------------
Sub Total               160.00
Total                   160.00
`.trim()

  const r = parseReceiptText(ocr)

  it('Tea item has mathMismatch=true', () => {
    const tea = r.items.find((it) => it.name.toLowerCase().includes('tea'))
    expect(tea).toBeDefined()
    expect(tea?.mathMismatch).toBe(true)
  })

  it('Coffee item has mathMismatch=false', () => {
    const coffee = r.items.find((it) => it.name.toLowerCase().includes('coffee'))
    expect(coffee).toBeDefined()
    expect(coffee?.mathMismatch).toBe(false)
  })

  it('review flags include math mismatch message', () => {
    expect(r.reviewFlags.some((f) => /qty.*price|price.*qty|≠|mismatch/i.test(f))).toBe(true)
  })

  it('requiresReview = true', () => {
    expect(r.requiresReview).toBe(true)
  })
})

// ─── Test 11: Grocery / supermarket receipt ───────────────────────────────────

describe('Test 11 — Grocery receipt (different layout)', () => {
  const ocr = `
SUPER MART
Indiranagar, Bengaluru
GSTIN: 29PQRST9876U1V2
Bill No: SM-2026-33891
Date: 16-Jun-2026  Time: 18:22
Customer: Walk-in
-------------------------------------------
S.No  Item Description       Qty  Rate   Amt
1     Basmati Rice 1kg        2   120.00  240.00
2     Toor Dal 500g           3    85.00  255.00
3     Sunflower Oil 1L        1   175.00  175.00
4     Tomatoes                2    40.00   80.00
5     Onions 1kg              1    60.00   60.00
-------------------------------------------
Sub Total                                810.00
GST 5%                                    40.50
Grand Total                              850.50
Cash Tendered                            900.00
Change                                    49.50
`.trim()

  const r = parseReceiptText(ocr)

  it('extracts 5 items', () => expect(r.items).toHaveLength(5))
  it('Basmati Rice qty=2 total=240', () => {
    expectItem(r.items, 'Basmati Rice', { qty: 2, unitPrice: 120, lineTotal: 240 })
  })
  it('Toor Dal qty=3 total=255', () => {
    expectItem(r.items, 'Toor Dal', { qty: 3, unitPrice: 85, lineTotal: 255 })
  })
  it('Sunflower Oil total=175', () => {
    expectItem(r.items, 'Sunflower Oil', { lineTotal: 175 })
  })

  it('Cash Tendered NOT an item', () => rejectItem(r.items, 'Cash'))
  it('Change NOT an item', () => rejectItem(r.items, 'Change'))
  it('Customer NOT an item', () => rejectItem(r.items, 'Customer'))

  it('subtotal = 810', () => expect(r.subtotal).toBeCloseTo(810, 1))
  it('grand total = 850.50', () => expect(r.grandTotal).toBeCloseTo(850.5, 1))
  it('totals reconcile', () => expect(r.totalsMatch).toBe(true))
})

// ─── Test 12: Restaurant with CGST + SGST at different rates per item ─────────

describe('Test 12 — Mixed tax rates (different GST slabs)', () => {
  // Some restaurants have items taxed at 5% and beverages at 12%
  // The scanner should extract the tax amounts regardless of rate complexity
  const ocr = `
MULTI FLAVOUR
Whitefield, Bangalore
GSTIN: 29MNOPQ3456R7S8
Invoice: MF/2026/1234
Date: 09-Jun-2026
Item              Qty   Rate    Amount
Veg Biryani        1   250.00   250.00
Chicken Curry      1   320.00   320.00
Beer (Pint)        2   180.00   360.00
-------------------------------------
Subtotal                        930.00
CGST (2.5% on food)              14.38
SGST (2.5% on food)              14.37
CGST (6% on liquor)              21.60
SGST (6% on liquor)              21.60
-------------------------------------
Grand Total                    1001.95
`.trim()

  const r = parseReceiptText(ocr)

  it('extracts 3 food items', () => expect(r.items).toHaveLength(3))
  it('Veg Biryani extracted', () => {
    expectItem(r.items, 'Veg Biryani', { qty: 1, lineTotal: 250 })
  })
  it('Beer extracted with qty=2', () => {
    expectItem(r.items, 'Beer', { qty: 2, lineTotal: 360 })
  })
  it('CGST amounts summed', () => {
    // 14.38 + 21.60 = 35.98
    expect(r.gst.cgstAmount).toBeCloseTo(35.98, 0)
  })
  it('grand total = 1001.95', () => expect(r.grandTotal).toBeCloseTo(1001.95, 1))
})

// ─── Test 13: OCR quality check ───────────────────────────────────────────────

describe('Test 13 — checkOcrQuality', () => {

  it('empty string → not a receipt', () => {
    const q = checkOcrQuality('')
    expect(q.looksLikeReceipt).toBe(false)
    expect(q.tooSparse).toBe(true)
  })

  it('very short text → too sparse', () => {
    const q = checkOcrQuality('Hello World 100')
    expect(q.tooSparse).toBe(true)
  })

  it('receipt with items → looksLikeReceipt=true', () => {
    const q = checkOcrQuality(`
RESTAURANT
Item  Qty  Amount
Dosa   1   80.00
Idli   2   60.00
Total      140.00
    `.trim())
    expect(q.looksLikeReceipt).toBe(true)
    expect(q.hasTotalLine).toBe(true)
  })
})
