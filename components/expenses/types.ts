// Shared UI-layer types for the Group Bill Splitter
// These mirror the DB model but are plain objects (no Mongoose docs)

export type SplitMode = 'item' | 'equal' | 'custom'
export type ChargeValueType = 'amount' | 'percent'

export interface BillPerson {
  id: string
  name: string
  paidAmount: number
}

export interface BillItem {
  id: string
  name: string
  price: number
  quantity: number
  assignedPeople: string[] // person ids
}

export interface CustomSplit {
  personId: string
  value: number
  type: 'amount' | 'percent'
}

export interface Settlement {
  fromPerson: string // person id
  toPerson: string   // person id
  amount: number
  settled: boolean
}

export interface GroupBillData {
  _id?: string
  name: string
  date: string
  currency: string
  people: BillPerson[]
  items: BillItem[]
  splitMode: SplitMode
  customSplits: CustomSplit[]
  discountType: ChargeValueType
  discountValue: number
  taxType: ChargeValueType
  taxValue: number
  serviceChargeType: ChargeValueType
  serviceChargeValue: number
  tipType: ChargeValueType
  tipValue: number
  subtotal: number
  discountAmount: number
  taxAmount: number
  serviceChargeAmount: number
  tipAmount: number
  total: number
  settlements: Settlement[]
  savedAsExpense: boolean
  expenseId?: string
  createdAt?: string
  updatedAt?: string
}

export const CURRENCIES = [
  { value: 'INR', label: '₹ INR' },
  { value: 'USD', label: '$ USD' },
  { value: 'EUR', label: '€ EUR' },
  { value: 'GBP', label: '£ GBP' },
  { value: 'JPY', label: '¥ JPY' },
]

export const CURRENCY_SYMBOL: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
}

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOL[currency] ?? currency
}

export function formatMoney(amount: number, currency = 'INR'): string {
  const sym = currencySymbol(currency)
  return `${sym}${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function newPersonId(): string {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function newItemId(): string {
  return `i_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}
