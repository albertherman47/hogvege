const blocked = new Set<string>()
let issue = ''
export const STORAGE_EVENT = 'hogvege-storage-issue'
function report(message: string) {
  issue = message
  window.dispatchEvent(new Event(STORAGE_EVENT))
}
export const storage = {
  getItem(key: string): string | null {
    try { return localStorage.getItem(key) }
    catch { report('A böngésző tárhelye nem hozzáférhető. Az új módosítások csak ebben a megnyitott ablakban élnek; készíts adatmentést.'); return null }
  },
  setItem(key: string, value: string) {
    if (blocked.has(key)) { report('Sérült mentett adatot találtunk. Az eredetit megőriztük; töltsd le a helyreállítási másolatot, majd állíts vissza egy érvényes mentést.'); return }
    try { if (localStorage.getItem(key) !== value) localStorage.setItem(key, value) }
    catch { report('A módosítás nem menthető a böngészőben. Készíts adatmentést, mielőtt bezárod az alkalmazást.'); return }
  },
  removeItem(key: string) {
    try { localStorage.removeItem(key) } catch { report('A böngésző tárhelyét nem sikerült módosítani.') }
  },
  block(key: string) { blocked.add(key); report('Sérült mentett adatot találtunk. Az eredetit megőriztük; töltsd le a helyreállítási másolatot, majd állíts vissza egy érvényes mentést.') },
  release(key: string) { blocked.delete(key); if (!blocked.size) { issue = ''; window.dispatchEvent(new Event(STORAGE_EVENT)) } },
  issue: () => issue,
}

export function readStored<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  const saved = storage.getItem(key)
  if (saved === null) return fallback
  try { const value: unknown = JSON.parse(saved); if (valid(value)) return value } catch { /* Preserve the source for recovery. */ }
  storage.block(key)
  return fallback
}

export function exportRecovery() {
  const raw: Record<string, string | null> = {}
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key?.startsWith('hogvege-')) raw[key] = localStorage.getItem(key)
    }
  } catch { report('A tárhely nem olvasható. A Beállítások oldalon az aktuálisan látható adatok exportálhatók.'); return }
  const url = URL.createObjectURL(new Blob([JSON.stringify({ type: 'hogvege-raw-recovery', raw }, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = `hogvege-helyreallitas-${Date.now()}.json`; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type CashPlan = { balance: number | null; income: number | null; payday: number | null; balanceDate?: string }
export type SavingsGoal = { name: string; target: number; saved: number; deadline: string }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const nonnegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000
export function validCashPlan(value: unknown): value is CashPlan {
  return record(value) && (value.balance === null || nonnegative(value.balance)) && (value.income === null || nonnegative(value.income)) && (value.payday === null || (Number.isInteger(value.payday) && Number(value.payday) >= 1 && Number(value.payday) <= 31)) && (value.balanceDate === undefined || (typeof value.balanceDate === 'string' && /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value.balanceDate)))
}
export function validSavingsGoal(value: unknown): value is SavingsGoal {
  return record(value) && typeof value.name === 'string' && value.name.length <= 200 && nonnegative(value.target) && nonnegative(value.saved) && typeof value.deadline === 'string' && (value.deadline === '' || /^\d{4}-(0[1-9]|1[0-2])$/.test(value.deadline))
}
