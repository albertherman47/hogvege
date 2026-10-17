import { storage } from './storage.ts'
export type InvoiceSource = 'actual' | 'estimated' | 'adjustment'
export type BillIconType = 'electricity' | 'gas' | 'water' | 'landline' | 'mobile' | 'internet' | 'television' | 'rent' | 'common' | 'garbage' | 'tax' | 'insurance' | 'pet' | 'parking' | 'savings' | 'other'

export type Invoice = {
  id: string
  period: string
  amount: number
  consumption?: number
  source: InvoiceSource
}

export type Bill = {
  id: string
  name: string
  category: string
  provider: string
  amount: number
  plannedAmount?: number
  dueDay: number
  startPeriod: string
  color: string
  icon: BillIconType
  recurring: string
  paidPeriods: string[]
  history: Invoice[]
}

/** Record or correct the amount printed on a bill for one month. Payment stays separate. */
export function recordActualInvoice(bill: Bill, period: string, amount: number, id: string): Bill {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Válassz érvényes hónapot.')
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) throw new Error('Adj meg 0-nál nagyobb, érvényes összeget.')
  const previous = bill.history.find(item => item.period === period && item.source === 'actual')
  const invoice: Invoice = { id: previous?.id ?? id, period, amount, source: 'actual', ...(previous?.consumption === undefined ? {} : { consumption: previous.consumption }) }
  return {
    ...bill,
    amount,
    history: [...bill.history.filter(item => item.period !== period || item.source !== 'actual'), invoice],
  }
}

export type BackupFile = {
  app: 'hogvege'
  schemaVersion: 4
  exportedAt: string
  bills: Bill[]
  cashPlan?: { balance: number | null; income: number | null; payday: number | null; balanceDate?: string }
  savingsGoal?: { name: string; target: number; saved: number; deadline: string }
  preferences?: { profileName: string; darkMode: boolean; notificationsEnabled: boolean }
}

const STORAGE_KEY = 'hogvege-bills-v3'
const PREVIOUS_STORAGE_KEY = 'hogvege-bills-v2'
const LEGACY_STORAGE_KEY = 'hogvege-bills-v1'
const icons = new Set<BillIconType>(['electricity', 'gas', 'water', 'landline', 'mobile', 'internet', 'television', 'rent', 'common', 'garbage', 'tax', 'insurance', 'pet', 'parking', 'savings', 'other'])
const legacyIcons: Record<string, BillIconType> = { zap: 'electricity', flame: 'gas', drop: 'water', wifi: 'internet', home: 'rent' }
const sources = new Set<InvoiceSource>(['actual', 'estimated', 'adjustment'])

function isPeriod(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

function normalizeInvoice(value: unknown): Invoice | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id || row.id.length > 200 || !isPeriod(row.period) || !Number.isFinite(row.amount) || Number(row.amount) === 0 || Math.abs(Number(row.amount)) > 1_000_000_000 || (Number(row.amount) < 0 && row.source !== 'adjustment')) return null
  if (typeof row.source !== 'string' || !sources.has(row.source as InvoiceSource)) return null
  const consumption = Number.isFinite(row.consumption) && Number(row.consumption) >= 0 ? Number(row.consumption) : undefined
  return { id: row.id, period: row.period, amount: Number(row.amount), source: row.source as InvoiceSource, ...(consumption === undefined ? {} : { consumption }) }
}

export function normalizeBills(value: unknown, currentPeriod: string): Bill[] | null {
  if (!Array.isArray(value) || value.length > 5000) return null
  const normalized: Bill[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    if (
      typeof row.id !== 'string' || !row.id || row.id.length > 200 || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200 ||
      typeof row.category !== 'string' || typeof row.provider !== 'string' || row.provider.length > 500 || row.category.length > 100 ||
      !Number.isFinite(row.amount) || Number(row.amount) <= 0 || Number(row.amount) > 1_000_000_000 ||
      (row.plannedAmount !== undefined && (!Number.isFinite(row.plannedAmount) || Number(row.plannedAmount) <= 0 || Number(row.plannedAmount) > 1_000_000_000)) ||
      !Number.isInteger(row.dueDay) || Number(row.dueDay) < 1 || Number(row.dueDay) > 31 ||
      typeof row.color !== 'string' || typeof row.icon !== 'string' || (!icons.has(row.icon as BillIconType) && !legacyIcons[row.icon]) ||
      typeof row.recurring !== 'string'
    ) return null

    if (Array.isArray(row.history) && row.history.length > 10000) return null
    const history = Array.isArray(row.history) ? row.history.map(normalizeInvoice) : []
    if (history.some(invoice => invoice === null) || new Set(history.map(invoice => invoice?.id)).size !== history.length) return null
    const paidPeriods = Array.isArray(row.paidPeriods)
      ? row.paidPeriods.filter(isPeriod)
      : row.paid === true ? [currentPeriod] : []
    const icon = icons.has(row.icon as BillIconType) ? row.icon as BillIconType : legacyIcons[row.icon as string]
    const startPeriod = isPeriod(row.startPeriod) ? row.startPeriod : (history as Invoice[]).find(invoice => invoice.source !== 'adjustment')?.period ?? currentPeriod
    const recurring = row.recurring === 'Évente' || row.recurring === 'Egyszeri' ? row.recurring : 'Havonta'
    normalized.push({
      id: row.id,
      name: row.name.trim(),
      category: row.category,
      provider: row.provider,
      amount: Number(row.amount),
      ...(row.plannedAmount === undefined ? {} : { plannedAmount: Number(row.plannedAmount) }),
      dueDay: Number(row.dueDay),
      startPeriod,
      color: row.color,
      icon,
      recurring,
      paidPeriods: [...new Set(paidPeriods)],
      history: Array.isArray(row.history) ? history as Invoice[] : [{ id: crypto.randomUUID(), period: currentPeriod, amount: Number(row.amount), source: 'actual' }],
    })
  }
  if (new Set(normalized.map(bill => bill.id)).size !== normalized.length) return null
  return normalized
}

export function loadBills(fallback: Bill[], currentPeriod: string): Bill[] {
  const key = [STORAGE_KEY, PREVIOUS_STORAGE_KEY, LEGACY_STORAGE_KEY].find(key => storage.getItem(key) !== null)
  if (!key) return fallback
  try {
    const normalized = normalizeBills(JSON.parse(storage.getItem(key)!), currentPeriod)
    if (normalized) return normalized
  } catch { /* Keep corrupt data available for recovery instead of overwriting it. */ }
  storage.block(STORAGE_KEY)
  return fallback
}

export function saveBills(bills: Bill[]) {
  storage.setItem(STORAGE_KEY, JSON.stringify(bills))
}

export function createBackup(bills: Bill[], finance?: Pick<BackupFile, 'cashPlan' | 'savingsGoal' | 'preferences'>): BackupFile {
  return { app: 'hogvege', schemaVersion: 4, exportedAt: new Date().toISOString(), bills, ...finance }
}

/** A quick entry is a monthly plan; a real invoice can be added later. */
export function createPlannedBill(input: { name: string; amount: number; dueDay: number; startPeriod: string }): Bill {
  const name = input.name.trim()
  if (!name || name.length > 200 || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1_000_000_000 ||
      !Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31 || !isPeriod(input.startPeriod)) {
    throw new Error('Ellenőrizd a nevet, az összeget és az esedékesség napját.')
  }
  return {
    id: crypto.randomUUID(), name, category: 'Egyéb', provider: 'Saját tétel',
    amount: input.amount, plannedAmount: input.amount, dueDay: input.dueDay,
    startPeriod: input.startPeriod, color: 'blue', icon: 'other', recurring: 'Havonta',
    paidPeriods: [], history: [],
  }
}

export function appliesToPeriod(bill: Bill, period: string): boolean {
  if (period < bill.startPeriod) return false
  if (bill.recurring === 'Egyszeri') return period === bill.startPeriod
  return bill.recurring !== 'Évente' || period.slice(5, 7) === bill.startPeriod.slice(5, 7)
}

export function parseBackup(content: string, currentPeriod: string): Bill[] {
  const data: unknown = JSON.parse(content)
  if (data && !Array.isArray(data) && typeof data === 'object') {
    const metadata = data as Record<string, unknown>
    if ((metadata.app !== undefined && metadata.app !== 'hogvege') || (metadata.schemaVersion !== undefined && metadata.schemaVersion !== 2 && metadata.schemaVersion !== 3 && metadata.schemaVersion !== 4)) {
      throw new Error('Ez az adatmentés nem ehhez a Hóvége-verzióhoz készült.')
    }
  }
  const billList = Array.isArray(data) ? data : data && typeof data === 'object' ? (data as Record<string, unknown>).bills : null
  const normalized = normalizeBills(billList, currentPeriod)
  if (!normalized) throw new Error('A fájl nem érvényes Hóvége-adatmentés, vagy hibás adatot tartalmaz.')
  return normalized
}
