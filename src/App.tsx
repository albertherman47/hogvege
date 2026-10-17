import { BillAnalytics } from './components/BillAnalytics'
import { initialBills, markPastBenchmarkPeriodsPaid } from './demo'
import { useEffect, useMemo, useState, type ChangeEvent, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { Icon, type IconName } from './icons'
import { useDialogAccessibility } from './components/useDialogAccessibility'
import { forecast, periodAmount, dueDate, recordedAmount, rolledCashBalance, currentMonthProjection } from './finance'
import { storage, STORAGE_EVENT, readStored, exportRecovery, validCashPlan, validSavingsGoal, type CashPlan, type SavingsGoal } from './storage'
import { appliesToPeriod, createBackup, createPlannedBill, loadBills, parseBackup, recordActualInvoice, saveBills, type Bill, type BillIconType, type Invoice, type InvoiceSource } from './data'

type Source = InvoiceSource
type ExtractedInvoice = { supplier: string | null; billingPeriod: string | null; dueDate: string | null; amount: number | null; currency: string | null; consumption: number | null; consumptionUnit: string | null; confidence: 'high' | 'medium' | 'low' }

async function encodeFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 32_768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)))
  return btoa(chunks.join(''))
}

function monthKey(offset = 0) {
  const date = new Date(new Date().getFullYear(), new Date().getMonth() + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function nameInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toLocaleUpperCase('hu-HU') ?? '').join('') || 'H'
}

const navItems = [
  { id: 'overview', label: 'Áttekintés', icon: 'Home' as IconName },
  { id: 'bills', label: 'Számláim', icon: 'FileText' as IconName },
  { id: 'calendar', label: 'Naptár', icon: 'CalendarDays' as IconName },
  { id: 'reports', label: 'Kimutatások', icon: 'Chart' as IconName },
  { id: 'planning', label: 'Tervezés', icon: 'Wallet' as IconName },
  { id: 'settings', label: 'Beállítások', icon: 'Settings2' as IconName },
]

const billIconOptions: { value: BillIconType; label: string }[] = [
  { value: 'electricity', label: 'Villanyszámla' }, { value: 'gas', label: 'Gázszámla' }, { value: 'water', label: 'Vízdíj' },
  { value: 'internet', label: 'Internet' }, { value: 'mobile', label: 'Mobiltelefon' }, { value: 'landline', label: 'Vezetékes telefon' },
  { value: 'television', label: 'Televízió' }, { value: 'rent', label: 'Lakbér' }, { value: 'common', label: 'Közös költség' },
  { value: 'garbage', label: 'Szemétdíj' }, { value: 'tax', label: 'Építményadó' }, { value: 'insurance', label: 'Biztosítás' },
  { value: 'pet', label: 'Kisállatdíj' }, { value: 'parking', label: 'Parkolás' }, { value: 'savings', label: 'Megtakarítás' }, { value: 'other', label: 'Egyéb' },
]

const categoryOptions = [
  { label: 'Közüzem', icon: 'electricity' as BillIconType }, { label: 'Lakhatás', icon: 'rent' as BillIconType },
  { label: 'Előfizetés', icon: 'internet' as BillIconType }, { label: 'Közös költség', icon: 'common' as BillIconType },
  { label: 'Adó', icon: 'tax' as BillIconType }, { label: 'Biztosítás', icon: 'insurance' as BillIconType },
  { label: 'Kisállat', icon: 'pet' as BillIconType }, { label: 'Közlekedés', icon: 'parking' as BillIconType },
  { label: 'Megtakarítás', icon: 'savings' as BillIconType }, { label: 'Egyéb', icon: 'other' as BillIconType },
]

function CategoryPicker({ value, onChange }: { value: string; onChange: (category: string) => void }) {
  return <div className="visual-choice-group"><span className="field-label">Kategória</span><div className="visual-choice-grid category-choice-grid" role="group" aria-label="Kategória kiválasztása">{categoryOptions.map(option => <button type="button" key={option.label} className={`visual-choice ${value === option.label ? 'selected' : ''}`} aria-pressed={value === option.label} onClick={() => onChange(option.label)}><span className="visual-choice-image"><img src={`/images/bill-icons/${option.icon === 'other' ? 'common' : option.icon}.png`} alt="" /></span><span>{option.label}</span></button>)}</div></div>
}

function IconPicker({ value, onChange }: { value: BillIconType; onChange: (icon: BillIconType) => void }) {
  return <div className="visual-choice-group"><span className="field-label">Fizetés ikonja</span><div className="visual-choice-grid icon-choice-grid" role="group" aria-label="Fizetés ikonjának kiválasztása">{billIconOptions.map(option => <button type="button" key={option.value} className={`visual-choice ${value === option.value ? 'selected' : ''}`} aria-pressed={value === option.value} onClick={() => onChange(option.value)}><span className="visual-choice-image"><img src={`/images/bill-icons/${option.value === 'other' ? 'common' : option.value}.png`} alt="" /></span><span>{option.label}</span></button>)}</div></div>
}

function categoryColor(category: string) {
  return category === 'Lakhatás' ? 'green' : category === 'Előfizetés' ? 'purple' : category === 'Közüzem' ? 'yellow' : 'blue'
}

const money = (value: number) => `${new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 }).format(value)} lei`

const chartColors = ['#244b37', '#5b8296', '#d4a27e']
function BillHistoryInsights({ bill, bills }: { bill: Bill; bills: Bill[] }) {
  const recentPeriods = Array.from({ length: 22 }, (_, index) => {
    const date = new Date(new Date().getFullYear(), new Date().getMonth() - 21 + index, 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })
  const monthly = recentPeriods.map(period => ({ period, amount: recordedAmount(bill, period) ?? 0 }))
  const activeMonths = monthly.filter(item => recordedAmount(bill, item.period) !== null)
  const amounts = activeMonths.map(item => item.amount)
  const total = amounts.reduce((sum, amount) => sum + amount, 0)
  const average = amounts.length ? Math.round(total / amounts.length) : 0
  const highest = amounts.length ? Math.max(...amounts) : 0
  const lowest = amounts.length ? Math.min(...amounts) : 0
  const first = activeMonths[0]?.amount ?? 0
  const last = activeMonths.at(-1)?.amount ?? 0
  const change = first > 0 ? Math.round((last - first) / first * 100) : null
  const max = Math.max(...monthly.map(item => item.amount), 1)
  const monthLabels = new Intl.DateTimeFormat('hu-HU', { month: 'short' })

  const spendByBill = bills.map(item => ({ bill: item, amount: recentPeriods.reduce((sum, period) => sum + (recordedAmount(item, period) ?? 0), 0) })).filter(item => item.amount > 0).sort((a, b) => b.amount - a.amount)
  const spendTotal = spendByBill.reduce((sum, item) => sum + item.amount, 0)
  let accumulated = 0
  const segments = spendByBill.map((item, index) => {
    const start = accumulated
    accumulated += spendTotal ? item.amount / spendTotal * 100 : 0
    return `${chartColors[index % chartColors.length]} ${start}% ${accumulated}%`
  })
  const ringStyle = { background: spendTotal ? `conic-gradient(${segments.join(', ')})` : '#e8ece6' }

  return <section className="history-insights" aria-label={`${bill.name} statisztikái`}>
    <div className="history-stats-grid">
      <article><span>Összesen · 22 hó</span><strong>{money(total)}</strong><small>{amounts.length} rögzített hónap</small></article>
      <article><span>Havi átlag</span><strong>{money(average)}</strong><small>csak rögzített hónapokból</small></article>
      <article><span>Legmagasabb</span><strong>{money(highest)}</strong><small>{activeMonths.find(item => item.amount === highest)?.period ?? 'nincs adat'}</small></article>
      <article><span>Éves változás</span><strong className={change !== null && change > 0 ? 'stat-increase' : 'stat-decrease'}>{change === null ? '—' : `${change > 0 ? '+' : ''}${change}%`}</strong><small>{first && last ? `${money(first)} → ${money(last)}` : 'kevés adat az összehasonlításhoz'}</small></article>
    </div>
    <div className="history-visual-grid">
      <section className="history-chart-card"><div className="history-chart-heading"><div><span className="section-kicker">22 HÓNAP</span><h3>Havi alakulás</h3></div><strong>{money(average)} <small>átlag</small></strong></div>
        {amounts.length ? <div className="history-bar-chart" role="img" aria-label={`Az elmúlt 12 hónap számlaösszegei: ${monthly.filter(item => item.amount > 0).map(item => `${item.period}: ${money(item.amount)}`).join(', ')}`}>
          {monthly.map(item => { const date = new Date(Number(item.period.slice(0, 4)), Number(item.period.slice(5, 7)) - 1, 1); return <div className={`history-bar-column ${item.amount === highest ? 'peak' : ''}`} key={item.period} title={`${item.period}: ${money(item.amount)}`}><span>{item.amount ? money(item.amount) : '—'}</span><div className="history-bar-track"><i style={{ height: `${item.amount ? Math.max(7, item.amount / max * 100) : 0}%` }} /></div><small>{monthLabels.format(date).replace('.', '')}</small></div> })}
        </div> : <p className="history-chart-empty">Ehhez a tételhez még nincs számlaadat az elmúlt 12 hónapban.</p>}
      </section>
      <section className="history-chart-card history-breakdown-card"><div className="history-chart-heading"><div><span className="section-kicker">KIADÁSI MEGOSZLÁS</span><h3>22 havi arányok</h3></div><span className="history-period-pill">{money(spendTotal)}</span></div>
        {spendByBill.length ? <div className="history-donut-layout"><div className="history-donut" style={ringStyle} role="img" aria-label={`Kiadások megoszlása számlánként az elmúlt 12 hónapban, összesen ${money(spendTotal)}`}><div><strong>{money(spendTotal)}</strong><span>összes kiadás</span></div></div><ul className="history-legend">{spendByBill.map(({ bill: item, amount }, index) => <li key={item.id}><i style={{ background: chartColors[index % chartColors.length] }} /><span>{item.name}</span><strong>{Math.round(amount / spendTotal * 100)}%</strong></li>)}</ul></div> : <p className="history-chart-empty">Nincs megjeleníthető adat.</p>}
      </section>
    </div>
    <div className="history-stat-footnote"><span>Legkisebb összeg</span><strong>{amounts.length ? money(lowest) : '—'}</strong><span>{amounts.length} aktív hónap a vizsgált időszakban</span></div>
  </section>
}

function formatPeriod(period: string) {
  const [year, month] = period.split('-').map(Number)
  return new Intl.DateTimeFormat('hu-HU', { month: 'short', year: 'numeric' }).format(new Date(year, month - 1, 1))
}

function sourceLabel(source: Source) {
  if (source === 'estimated') return 'Becsült fogyasztás'
  if (source === 'adjustment') return 'Korrekció / elszámolás'
  return 'Tényleges számla'
}


function BillIcon({ type }: { type: Bill['icon'] }) {
  return <img className="category-photo" src={`/images/bill-icons/${type === 'other' ? 'common' : type}.png`} alt="" />
}

type BillSetupValues = Pick<Bill, 'name' | 'provider' | 'startPeriod' | 'category' | 'icon' | 'recurring'> & { amount: string; dueDay: string }

function BillSetupFields({ value, onChange }: { value: BillSetupValues; onChange: (changes: Partial<BillSetupValues>) => void }) {
  return <>
    <label className="field-label">Mi ez a fizetés?<input maxLength={200} value={value.name} onChange={event => onChange({ name: event.target.value })} placeholder="Például villanyszámla" required /></label>
    <label className="field-label">Szolgáltató vagy megjegyzés<input maxLength={500} value={value.provider} onChange={event => onChange({ provider: event.target.value })} placeholder="Opcionális" /></label>
    <div className="field-row"><label className="field-label">Tervezett összeg<input type="number" min="0.01" step="0.01" value={value.amount} onChange={event => onChange({ amount: event.target.value })} placeholder="0" required /></label><label className="field-label">Esedékesség napja<input type="number" min="1" max="31" value={value.dueDay} onChange={event => onChange({ dueDay: event.target.value })} required /></label></div>
    <CategoryPicker value={value.category} onChange={category => onChange({ category })} />
    <IconPicker value={value.icon} onChange={icon => onChange({ icon })} />
    <div className="field-row"><label className="field-label">Érvényes ettől<input type="month" value={value.startPeriod} onChange={event => onChange({ startPeriod: event.target.value })} required /></label><label className="field-label">Ismétlődés<select value={value.recurring} onChange={event => onChange({ recurring: event.target.value })}><option>Havonta</option><option>Évente</option><option>Egyszeri</option></select></label></div>
  </>
}

function App() {
  const [bills, setBills] = useState<Bill[]>(() => {
    const currentPeriod = monthKey()
    const loadedBills = loadBills([], currentPeriod)
    const migrationKey = 'hogvege-demo-paid-periods-migrated-v2'
    if (storage.getItem(migrationKey) === 'true') return loadedBills
    const migratedBills = markPastBenchmarkPeriodsPaid(loadedBills, currentPeriod)
    if (migratedBills.some((bill, index) => bill !== loadedBills[index])) saveBills(migratedBills)
    storage.setItem(migrationKey, 'true')
    return migratedBills
  })
  const [active, setActive] = useState(() => navItems.some(item => item.id === location.hash.slice(1)) ? location.hash.slice(1) : 'overview')
  const [showAdd, setShowAdd] = useState(false)
  const [showActualEntry, setShowActualEntry] = useState(false)
  const [actualEntry, setActualEntry] = useState({ billId: '', amount: '' })
  const [showHelp, setShowHelp] = useState(false)
  const [addMode, setAddMode] = useState<'quick' | 'detailed'>('quick')
  const [addStep, setAddStep] = useState(0)
  const [quickBill, setQuickBill] = useState({ name: '', amount: '', dueDay: '15' })
  const [profileName, setProfileName] = useState(() => storage.getItem('hogvege-profile-name-v1')?.trim() ?? '')
  const [profileNameDraft, setProfileNameDraft] = useState(() => storage.getItem('hogvege-profile-name-v1')?.trim() ?? '')
  const [editingProfileName, setEditingProfileName] = useState(() => !storage.getItem('hogvege-profile-name-v1')?.trim())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settlingBillId, setSettlingBillId] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null)
  const [invoiceDeleteId, setInvoiceDeleteId] = useState<string | null>(null)
  const [invoiceEditForm, setInvoiceEditForm] = useState({ period: monthKey(), amount: '', source: 'actual' as Source, consumption: '' })
  const [toast, setToast] = useState('')
  const [deletedBill, setDeletedBill] = useState<Bill | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState('due')
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); location.hash = active; document.title = `${navItems.find(item => item.id === active)?.label} · Hóvége` }, [active])
  useEffect(() => { const change = () => { const page = location.hash.slice(1); if (navItems.some(item => item.id === page)) setActive(page) }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change) }, [])
  const [monthOffset, setMonthOffset] = useState(0)
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => storage.getItem('hogvege-reminders-v1') !== 'false')
  const [savingsGoal, setSavingsGoal] = useState<SavingsGoal>(() => readStored('hogvege-savings-goal-v1', { name: '', target: 0, saved: 0, deadline: '' }, validSavingsGoal))
  const [cashPlan, setCashPlan] = useState<CashPlan>(() => {
    const savedPlan = readStored('hogvege-cash-plan-v1', { balance: null, income: null, payday: null }, validCashPlan)
    return savedPlan.balance !== null && savedPlan.balanceDate === undefined ? { ...savedPlan, balanceDate: localDateKey() } : savedPlan
  })
  const [storageError, setStorageError] = useState(storage.issue)
  useEffect(() => {
    const update = () => setStorageError(storage.issue())
    window.addEventListener(STORAGE_EVENT, update)
    update()
    return () => window.removeEventListener(STORAGE_EVENT, update)
  }, [])
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === 'hogvege-bills-v3') { setBills(loadBills([], monthKey())); setToast('A számlalista frissült egy másik ablakból.'); setSelectedId(null) }
      if (event.key === 'hogvege-cash-plan-v1') setCashPlan(readStored(event.key, { balance: null, income: null, payday: null }, validCashPlan))
      if (event.key === 'hogvege-savings-goal-v1') setSavingsGoal(readStored(event.key, { name: '', target: 0, saved: 0, deadline: '' }, validSavingsGoal))
    }
    window.addEventListener('storage', update)
    return () => window.removeEventListener('storage', update)
  }, [])
  const [isDemoData, setIsDemoData] = useState(() => {
    if (storage.getItem('hogvege-demo-dismissed-v1') === 'true') return false
    const saved = storage.getItem('hogvege-bills-v3') ?? storage.getItem('hogvege-bills-v2') ?? storage.getItem('hogvege-bills-v1')
    if (!saved) return false
    try { return JSON.parse(saved).some((bill: { history?: Invoice[] }) => bill.history?.some(invoice => invoice.id.startsWith('ro-benchmark-'))) } catch { return false }
  })
  const [darkMode, setDarkMode] = useState(() => storage.getItem('hogvege-theme-v1') === 'dark')
  useEffect(() => { storage.setItem('hogvege-theme-v1', darkMode ? 'dark' : 'light') }, [darkMode])
  useEffect(() => { storage.setItem('hogvege-reminders-v1', String(notificationsEnabled)) }, [notificationsEnabled])
  useEffect(() => { storage.setItem('hogvege-savings-goal-v1', JSON.stringify(savingsGoal)) }, [savingsGoal])
  useEffect(() => { storage.setItem('hogvege-cash-plan-v1', JSON.stringify(cashPlan)) }, [cashPlan])
  const saveSavingsGoal = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const target = Number(form.get('goal-target')); const saved = Number(form.get('goal-saved')); if (!validSavingsGoal({ name: String(form.get('goal-name') || 'Megtakarítási cél'), target, saved, deadline: String(form.get('goal-deadline') || '') }) || target <= 0) { setToast('Ellenőrizd a cél nevét, összegét és határidejét.'); return; } setSavingsGoal({ name: String(form.get('goal-name') || 'Megtakarítási cél'), target, saved, deadline: String(form.get('goal-deadline') || '') }); setToast('A megtakarítási cél mentve.') }
  const saveCashPlan = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const balance = Number(form.get('cash-balance')); const income = Number(form.get('cash-income')); const payday = Number(form.get('cash-payday')); if (!validCashPlan({ balance, income, payday }) || income <= 0) { setToast('Ellenőrizd az egyenleget, a bevételt és a fizetés napját.'); return; } setCashPlan({ balance, income, payday, balanceDate: localDateKey() }); setToast('Az induló egyenleg és a havi bevételi terv mentve.') }
  const restoreBenchmarkData = () => {
    if (bills.length && !window.confirm('A referenciaadatok lecserélik a jelenlegi számlalistát. Előbb készíts mentést, ha meg szeretnéd tartani. Betöltöd a 22 hónapos mintát?')) return
    setBills(initialBills)
    setIsDemoData(true)
    storage.removeItem('hogvege-demo-dismissed-v1')
    setToast('A 2025–2026-os romániai próbaadatok visszaállítva.')
  }
  const [billForm, setBillForm] = useState({ name: '', provider: '', amount: '', dueDay: '15', period: monthKey(), startPeriod: monthKey(), category: 'Közüzem', source: 'actual' as Source, consumption: '', icon: 'electricity' as BillIconType, recurring: 'Havonta' })
  const [editForm, setEditForm] = useState({ name: '', provider: '', amount: '', dueDay: '15', startPeriod: monthKey(), category: 'Közüzem', icon: 'electricity' as BillIconType, recurring: 'Havonta' })
  const [invoiceForm, setInvoiceForm] = useState({ period: monthKey(), amount: '', source: 'actual' as Source, consumption: '' })
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null)
  const [invoiceAI, setInvoiceAI] = useState<ExtractedInvoice | null>(null)
  const [invoiceAIStatus, setInvoiceAIStatus] = useState('')
  const [invoiceAIError, setInvoiceAIError] = useState('')
  const [invoiceAIWorking, setInvoiceAIWorking] = useState(false)
  useDialogAccessibility(showAdd || showActualEntry || !!selectedId || showHelp, () => { if (!invoiceAIWorking) { setShowAdd(false); setShowActualEntry(false); setSelectedId(null); setShowHelp(false) } })

  useEffect(() => { try { saveBills(bills) } catch { setToast('A böngésző tárhelye megtelt. Készíts adatmentést, vagy törölj felesleges adatokat.') } }, [bills])
  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(''), 6500)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const monthInfo = useMemo(() => {
    const date = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1)
    return {
      label: new Intl.DateTimeFormat('hu-HU', { month: 'long', year: 'numeric' }).format(date),
      year: date.getFullYear(), monthIndex: date.getMonth(),
      days: new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(),
      offset: (date.getDay() + 6) % 7,
    }
  }, [monthOffset])
  const month = monthInfo.label
  const selectedPeriod = monthKey(monthOffset)
  const currentPeriod = monthKey()
  const isPaid = (bill: Bill) => bill.paidPeriods.includes(selectedPeriod) || (
    selectedPeriod <= currentPeriod && bill.history.some(invoice => invoice.id.startsWith('ro-benchmark-') && invoice.period === selectedPeriod)
  )
  const billsForPeriod = bills.filter(bill => appliesToPeriod(bill, selectedPeriod))
  const activeBills = billsForPeriod.filter(bill => !isPaid(bill)).sort((a, b) => a.dueDay - b.dueDay)
  const totalEstimate = billsForPeriod.reduce((sum, bill) => sum + periodAmount(bill, selectedPeriod), 0)
  const pendingEstimate = activeBills.reduce((sum, bill) => sum + periodAmount(bill, selectedPeriod), 0)
  const today = new Date()
  const cashPlanConfigured = cashPlan.balance !== null && cashPlan.income !== null && cashPlan.payday !== null
  const currentCashBalance = cashPlanConfigured ? rolledCashBalance(cashPlan, bills, today) : cashPlan.balance
  const monthProjection = cashPlanConfigured ? currentMonthProjection({ balance: currentCashBalance!, income: cashPlan.income!, payday: cashPlan.payday!, balanceDate: cashPlan.balanceDate }, bills, savingsGoal, today) : null
  const projectedMonthEnd = monthProjection?.beforeSaving ?? null
  const goalRemaining = Math.max(0, savingsGoal.target - savingsGoal.saved)
  const goalReserveThisMonth = monthProjection?.reserve ?? 0
  const monthsToGoal = savingsGoal.deadline ? Math.max(0, (Number(savingsGoal.deadline.slice(0, 4)) - today.getFullYear()) * 12 + Number(savingsGoal.deadline.slice(5, 7)) - today.getMonth() - 1) : 0
  let projectedGoalBalance = projectedMonthEnd === null ? 0 : projectedMonthEnd - goalReserveThisMonth
  let projectedGoalSaved = savingsGoal.saved + goalReserveThisMonth
  let projectedGoalRemaining = Math.max(0, savingsGoal.target - projectedGoalSaved)
  for (let index = 0; index < monthsToGoal; index++) {
    const period = monthKey(index + 1)
    const monthlyBills = bills.filter(bill => appliesToPeriod(bill, period)).reduce((sum, bill) => sum + periodAmount(bill, period), 0)
    projectedGoalBalance += cashPlanConfigured ? cashPlan.income! - monthlyBills : 0
    const monthlyTarget = Math.ceil(projectedGoalRemaining / (monthsToGoal - index) * 100) / 100
    const contribution = Math.min(monthlyTarget, Math.max(0, projectedGoalBalance))
    projectedGoalBalance -= contribution
    projectedGoalSaved += contribution
    projectedGoalRemaining -= contribution
  }
  const goalProjectedByDeadline = Math.min(savingsGoal.target, projectedGoalSaved)
  const weeksToGoalDeadline = savingsGoal.deadline ? Math.max(0, Math.ceil((new Date(Number(savingsGoal.deadline.slice(0, 4)), Number(savingsGoal.deadline.slice(5, 7)), 0).getTime() - today.getTime()) / 604800000)) : 0
  const weeklyGoalContribution = weeksToGoalDeadline > 0 ? Math.ceil(goalRemaining / weeksToGoalDeadline) : 0
  const rawSafeToSpend = projectedMonthEnd === null ? null : projectedMonthEnd - goalReserveThisMonth
  const cashPlanAvailable = cashPlanConfigured && monthOffset === 0
  const paidAmount = billsForPeriod.filter(isPaid).reduce((sum, bill) => sum + periodAmount(bill, selectedPeriod), 0)
  const filteredBills = billsForPeriod.filter(bill => `${bill.name} ${bill.provider} ${bill.category}`.toLocaleLowerCase('hu').includes(search.toLocaleLowerCase('hu')) && (statusFilter === 'all' || (statusFilter === 'paid' ? isPaid(bill) : !isPaid(bill)))).sort((a, b) => sortOrder === 'amount' ? periodAmount(b, selectedPeriod) - periodAmount(a, selectedPeriod) : sortOrder === 'name' ? a.name.localeCompare(b.name, 'hu') : a.dueDay - b.dueDay)
  const overdueBills = activeBills.filter(bill => dueDate(bill, selectedPeriod) < new Date(today.getFullYear(), today.getMonth(), today.getDate()))
  const selectedBill = bills.find(bill => bill.id === selectedId) ?? null
  const actualEntryBill = billsForPeriod.find(bill => bill.id === actualEntry.billId) ?? null
  const actualEntryExists = !!actualEntryBill?.history.some(item => item.period === selectedPeriod && item.source === 'actual')

  function dueSoonBill() {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setDate(start.getDate() + 3)
    return bills.flatMap(bill => [0, 1].flatMap(offset => {
      const date = new Date(start.getFullYear(), start.getMonth() + offset, Math.min(bill.dueDay, new Date(start.getFullYear(), start.getMonth() + offset + 1, 0).getDate()))
      const period = monthKey(offset)
      return date >= start && date <= end && appliesToPeriod(bill, period) && !bill.paidPeriods.includes(period) ? [{ bill, date }] : []
    })).sort((a, b) => a.date.getTime() - b.date.getTime())[0]
  }

  async function toggleReminders() {
    if (notificationsEnabled) {
      if ('Notification' in window && Notification.permission === 'default') {
        const permission = await Notification.requestPermission()
        setToast(permission === 'granted' ? 'A böngészőértesítések engedélyezve.' : 'Az alkalmazáson belüli emlékeztetők továbbra is működnek.')
        return
      }
      setNotificationsEnabled(false)
      setToast('Emlékeztetők kikapcsolva.')
      return
    }
    let permission: NotificationPermission | 'unsupported' = 'unsupported'
    if ('Notification' in window) permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
    setNotificationsEnabled(true)
    setToast(permission === 'granted' ? 'Emlékeztetők bekapcsolva. A böngésző jelez, ha közeleg egy számla.' : 'Alkalmazáson belüli emlékeztetők bekapcsolva.')
  }

  useEffect(() => {
    if (!notificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return
    try {
    const due = dueSoonBill()
    if (due) {
      const key = `hogvege-reminder-${due.bill.id}-${monthKey(due.date.getMonth() - new Date().getMonth())}-${new Date().toISOString().slice(0, 10)}`
      if (sessionStorage.getItem(key)) return
      new Notification(`${due.bill.name} hamarosan esedékes`, { body: `${due.date.getMonth() + 1}.${due.date.getDate()}-ig · ${money(forecast(due.bill).amount)}` })
      sessionStorage.setItem(key, 'true')
      return
    }
    const increase = bills.flatMap(bill => {
      const history = [...new Set(bill.history.filter(item => item.period <= monthKey() && item.source !== 'adjustment').map(item => item.period))].sort((a, b) => b.localeCompare(a)).map(period => ({ period, amount: recordedAmount(bill, period) ?? 0 }))
      if (history.length < 2 || history[1].amount <= 0 || history[0].amount < history[1].amount * 1.15) return []
      return [{ bill, current: history[0].amount, previous: history[1].amount }]
    }).sort((a, b) => b.current / b.previous - a.current / a.previous)[0]
    if (!increase) return
    const key = `hogvege-price-alert-${increase.bill.id}-${increase.current}`
    if (sessionStorage.getItem(key)) return
    new Notification(`${increase.bill.name} számlája emelkedett`, { body: `${money(increase.previous)} helyett ${money(increase.current)} · legalább 15%-os változás.` })
    sessionStorage.setItem(key, 'true')
    } catch { /* Some browsers do not support desktop notifications even with permission. In-app reminders remain available. */ }
  }, [notificationsEnabled, bills])

  function openDetails(id: string) {
    const bill = bills.find(item => item.id === id)
    if (bill) setEditForm({ name: bill.name, provider: bill.provider, amount: String(bill.plannedAmount ?? bill.amount), dueDay: String(bill.dueDay), startPeriod: bill.startPeriod, category: bill.category, icon: bill.icon, recurring: bill.recurring })
    setSelectedId(id)
    setConfirmRemove(false)
    setInvoiceForm({ period: selectedPeriod, amount: '', source: 'actual', consumption: '' })
    setInvoiceFile(null)
    setInvoiceAI(null)
    setInvoiceAIStatus('')
    setInvoiceAIError('')
  }

  async function recognizeInvoice(target: 'history' | 'new-bill' = 'history') {
    if (!invoiceFile || invoiceAIWorking) return
    setInvoiceAIWorking(true)
    setInvoiceAIError('')
    setInvoiceAIStatus('A számla feldolgozása helyben folyamatban…')
    try {
      const response = await fetch('/api/invoices/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: invoiceFile.name, mimeType: invoiceFile.type, base64: await encodeFile(invoiceFile) }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Nem sikerült felismerni a számlát.')
      const found = result.invoice as ExtractedInvoice
      if (found.currency && found.currency !== 'RON') throw new Error('Ez a számla nem lejben van. Add meg kézzel a RON-ra átszámított összeget.')
      setInvoiceAI(found)
      if (target === 'new-bill') {
        const supplier = found.supplier?.trim() ?? ''
        const identity = `${supplier} ${invoiceFile.name}`.toLocaleLowerCase('hu')
        const detected = identity.includes('villany') || identity.includes('electric') || identity.includes('energie') || identity.includes('áram')
          ? { name: 'Villany', icon: 'electricity' as BillIconType }
          : identity.includes('gaz') || identity.includes('gáz') || identity.includes('gas')
            ? { name: 'Földgáz', icon: 'gas' as BillIconType }
            : identity.includes('víz') || identity.includes('water') || identity.includes('apa')
              ? { name: 'Víz és csatorna', icon: 'water' as BillIconType }
              : identity.includes('internet') || identity.includes('telecom') || identity.includes('digi')
                ? { name: 'Internet', icon: 'internet' as BillIconType }
                : null
        setBillForm(current => ({
          ...current,
          ...(detected ? { name: detected.name, icon: detected.icon, category: detected.icon === 'internet' ? 'Előfizetés' : 'Közüzem' } : supplier ? { name: supplier } : {}),
          ...(supplier ? { provider: supplier } : {}),
          ...(found.amount !== null ? { amount: String(found.amount) } : {}),
          ...(found.billingPeriod ? { period: found.billingPeriod, startPeriod: found.billingPeriod } : {}),
          ...(found.consumption !== null ? { consumption: String(found.consumption) } : {}),
          ...(found.dueDate ? { dueDay: String(Number(found.dueDate.slice(-2))) } : {}),
        }))
        if (found.amount !== null) setInvoiceForm(current => ({ ...current, amount: String(found.amount), period: found.billingPeriod ?? current.period, consumption: found.consumption === null ? current.consumption : String(found.consumption) }))
        setInvoiceAIStatus('A felismert adatok betöltődtek az új fizetésbe. Nézd át a mezőket, majd folytasd a beállítást.')
      } else {
        setInvoiceForm(current => ({ ...current, period: found.billingPeriod ?? current.period, amount: found.amount === null ? current.amount : String(found.amount), source: 'actual', consumption: found.consumption === null ? current.consumption : String(found.consumption) }))
        setInvoiceAIStatus('Az adatokat betöltöttük az űrlapba. Ellenőrizd, javítsd, majd mentsd el az előzményt.')
      }
      setInvoiceFile(null)
    } catch (error) {
      setInvoiceAIStatus('')
      setInvoiceAIError(error instanceof Error ? error.message : 'Hiba történt a számla felismerése közben.')
    } finally { setInvoiceAIWorking(false) }
  }

  function addBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const amount = Number(billForm.amount)
    if (!billForm.name.trim() || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) return
    if (billForm.period < billForm.startPeriod) { setToast('Az első számlázási időszak nem lehet korábbi az érvényesség kezdeténél.'); return }
    if (billForm.recurring === 'Évente' && billForm.period.slice(5, 7) !== billForm.startPeriod.slice(5, 7)) { setToast('Éves fizetésnél az első számlázás hónapja egyezzen a kezdő hónappal.'); return }
    const invoice: Invoice = {
      id: crypto.randomUUID(), period: billForm.period, amount,
      source: billForm.source, consumption: billForm.consumption ? Number(billForm.consumption) : undefined,
    }
    const name = billForm.name.trim()
    const color = categoryColor(billForm.category)
    setBills(current => [...current, {
      id: crypto.randomUUID(), name, category: billForm.category, provider: billForm.provider.trim() || 'Saját tétel',
      amount, plannedAmount: amount, dueDay: Math.min(31, Math.max(1, Number(billForm.dueDay) || 15)), startPeriod: billForm.startPeriod, color, icon: billForm.icon,
      recurring: billForm.recurring, paidPeriods: [], history: [invoice],
    }])
    setBillForm({ name: '', provider: '', amount: '', dueDay: '15', period: selectedPeriod, startPeriod: selectedPeriod, category: 'Közüzem', source: 'actual', consumption: '', icon: 'electricity', recurring: 'Havonta' })
    setShowAdd(false)
    setToast('A számla és az első előzménye bekerült a tervedbe.')
  }

  function addQuickBill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const planned = createPlannedBill({ name: quickBill.name, amount: Number(quickBill.amount), dueDay: Number(quickBill.dueDay), startPeriod: selectedPeriod })
      const bill = recordActualInvoice(planned, selectedPeriod, planned.amount, crypto.randomUUID())
      setBills(current => [...current, bill])
      setShowAdd(false)
      setToast('A tényleges számla mentve. A fizetést külön jelölheted rendezettnek.')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'A tétel mentése nem sikerült.')
    }
  }

  function addInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedBill || !Number.isFinite(Number(invoiceForm.amount)) || Number(invoiceForm.amount) === 0 || Math.abs(Number(invoiceForm.amount)) > 1_000_000_000 || (Number(invoiceForm.amount) < 0 && invoiceForm.source !== 'adjustment')) return
    const invoice: Invoice = {
      id: crypto.randomUUID(), period: invoiceForm.period, amount: Number(invoiceForm.amount), source: invoiceForm.source,
      consumption: invoiceForm.consumption ? Number(invoiceForm.consumption) : undefined,
    }
    setBills(current => current.map(bill => bill.id === selectedBill.id ? {
      ...bill,
      amount: invoice.source === 'adjustment' ? bill.amount : invoice.amount,
      history: [...bill.history.filter(item => item.period !== invoice.period || item.source !== invoice.source), invoice],
    } : bill))
    setInvoiceForm({ period: selectedPeriod, amount: '', source: 'actual', consumption: '' })
    setInvoiceAI(null)
    setInvoiceAIStatus('')
    setInvoiceAIError('')
    setToast(invoice.source === 'adjustment' ? 'A korrekció mentve; nem számítjuk a havi átlagba.' : 'A számla bekerült az előzményekbe.')
  }

  function startInvoiceEdit(invoice: Invoice) {
    setEditingInvoiceId(invoice.id)
    setInvoiceDeleteId(null)
    setInvoiceEditForm({ period: invoice.period, amount: String(invoice.amount), source: invoice.source, consumption: invoice.consumption === undefined ? '' : String(invoice.consumption) })
  }

  function saveInvoiceEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedBill || !editingInvoiceId || !Number.isFinite(Number(invoiceEditForm.amount)) || Number(invoiceEditForm.amount) === 0 || Math.abs(Number(invoiceEditForm.amount)) > 1_000_000_000 || (Number(invoiceEditForm.amount) < 0 && invoiceEditForm.source !== 'adjustment')) return
    const updated: Invoice = { id: editingInvoiceId, period: invoiceEditForm.period, amount: Number(invoiceEditForm.amount), source: invoiceEditForm.source, consumption: invoiceEditForm.consumption ? Number(invoiceEditForm.consumption) : undefined }
    setBills(current => current.map(bill => bill.id !== selectedBill.id ? bill : { ...bill, amount: updated.source === 'actual' ? updated.amount : bill.amount, history: [...bill.history.filter(item => item.id !== editingInvoiceId && (item.period !== updated.period || item.source !== updated.source)), updated] }))
    setEditingInvoiceId(null)
    setToast('A számlaadat módosítva.')
  }

  function removeInvoice(invoiceId: string) {
    if (!selectedBill) return
    setBills(current => current.map(bill => bill.id !== selectedBill.id ? bill : { ...bill, history: bill.history.filter(item => item.id !== invoiceId) }))
    setInvoiceDeleteId(null)
    setToast('A számlaadat törölve az előzményekből.')
  }

  function saveBillSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedBill || !editForm.name.trim() || !Number.isFinite(Number(editForm.amount)) || Number(editForm.amount) <= 0 || Number(editForm.amount) > 1_000_000_000) return
    setBills(current => current.map(bill => bill.id === selectedBill.id ? {
      ...bill,
      name: editForm.name.trim(), provider: editForm.provider.trim() || 'Saját tétel',
      plannedAmount: Number(editForm.amount), dueDay: Math.min(31, Math.max(1, Number(editForm.dueDay) || 1)),
      startPeriod: editForm.startPeriod, category: editForm.category, color: categoryColor(editForm.category),
      icon: editForm.icon, recurring: editForm.recurring,
    } : bill))
    setToast('A számlabeállítások mentve.')
  }

  function togglePaid(id: string) {
    setBills(current => current.map(bill => {
      if (bill.id !== id) return bill
      const paidPeriods = bill.paidPeriods.includes(selectedPeriod)
        ? bill.paidPeriods.filter(period => period !== selectedPeriod)
        : [...bill.paidPeriods, selectedPeriod]
      return { ...bill, paidPeriods }
    }))
  }

  function toggleUpcomingPaid(id: string) {
    const bill = bills.find(item => item.id === id)
    if (!bill) return
    if (isPaid(bill)) {
      setSettlingBillId(null)
    } else {
      setSettlingBillId(id)
      window.setTimeout(() => setSettlingBillId(current => current === id ? null : current), 560)
    }
    togglePaid(id)
  }

  function exportBackup() {
    const backup = createBackup(bills, { cashPlan, savingsGoal, preferences: { profileName, darkMode, notificationsEnabled } })
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `hogvege-mentes-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setToast('Az adatmentés letöltése elindult.')
  }

  function exportDemoData() {
    const demoBackup = createBackup(initialBills, {
      cashPlan: { balance: 4200, income: 6500, payday: 5 },
      savingsGoal: { name: 'Nyaralás', target: 3500, saved: 800, deadline: '2027-07' },
    })
    const url = URL.createObjectURL(new Blob([JSON.stringify(demoBackup, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'hogvege-probaadatok.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setToast('A próbaadatok fájlja letöltődött. A „Mentés visszaállítása” gombbal importálhatod.')
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Az adatmentés legfeljebb 10 MB lehet.')
      const content = await file.text()
      const restored = parseBackup(content, monthKey())
      if (!window.confirm(`A visszaállítás lecseréli a jelenlegi számlalistát, pénzügyi tervet és megtakarítási célt. ${restored.length} számla kerül be. Folytatod?`)) return
      const backup = JSON.parse(content) as { cashPlan?: { balance: number | null; income: number | null; payday: number | null; balanceDate?: string }; savingsGoal?: { name: string; target: number; saved: number; deadline: string }; preferences?: { profileName: string; darkMode: boolean; notificationsEnabled: boolean } }
      if (backup.cashPlan !== undefined && !validCashPlan(backup.cashPlan)) throw new Error('Az adatmentés hibás pénzügyi tervet tartalmaz.')
      if (backup.savingsGoal !== undefined && !validSavingsGoal(backup.savingsGoal)) throw new Error('Az adatmentés hibás megtakarítási célt tartalmaz.')
      if (backup.preferences && (typeof backup.preferences.profileName !== 'string' || backup.preferences.profileName.length > 40 || typeof backup.preferences.darkMode !== 'boolean' || typeof backup.preferences.notificationsEnabled !== 'boolean')) throw new Error('Az adatmentés hibás személyes beállításokat tartalmaz.')
      const restoredWithDemoPayments = markPastBenchmarkPeriodsPaid(restored, monthKey())
      storage.release('hogvege-bills-v3')
      storage.release('hogvege-cash-plan-v1')
      storage.release('hogvege-savings-goal-v1')
      if (backup.preferences) { setProfileName(backup.preferences.profileName); setProfileNameDraft(backup.preferences.profileName); setEditingProfileName(!backup.preferences.profileName); storage.setItem('hogvege-profile-name-v1', backup.preferences.profileName); setDarkMode(backup.preferences.darkMode); setNotificationsEnabled(backup.preferences.notificationsEnabled) }
      setDeletedBill(null)
      setBills(restoredWithDemoPayments)
      const restoredCashPlan = backup.cashPlan ?? { balance: null, income: null, payday: null }
      setCashPlan(restoredCashPlan.balance !== null && restoredCashPlan.balanceDate === undefined ? { ...restoredCashPlan, balanceDate: localDateKey() } : restoredCashPlan)
      setSavingsGoal(backup.savingsGoal ?? { name: '', target: 0, saved: 0, deadline: '' })
      const importedDemo = restoredWithDemoPayments.some(bill => bill.history.some(invoice => invoice.id.startsWith('ro-benchmark-')))
      setIsDemoData(importedDemo)
      if (importedDemo) storage.removeItem('hogvege-demo-dismissed-v1')
      else storage.setItem('hogvege-demo-dismissed-v1', 'true')
      setToast(`${restored.length} számla visszaállítva az adatmentésből.`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Nem sikerült beolvasni az adatmentést.')
    }
  }

  function removeSelectedBill() {
    if (!selectedBill) return
    setDeletedBill(selectedBill)
    setBills(current => current.filter(bill => bill.id !== selectedBill.id))
    setSelectedId(null)
    setConfirmRemove(false)
    setToast('A számla és a hozzá tartozó előzmények törölve.')
  }

  const openNewBill = () => {
    setQuickBill({ name: '', amount: '', dueDay: '15' })
    setAddMode('quick')
    setBillForm({ name: '', provider: '', amount: '', dueDay: '15', period: selectedPeriod, startPeriod: selectedPeriod, category: 'Közüzem', source: 'actual', consumption: '', icon: 'electricity', recurring: 'Havonta' })
    setInvoiceFile(null)
    setInvoiceAI(null)
    setInvoiceAIStatus('')
    setInvoiceAIError('')
    setAddStep(0)
    setShowAdd(true)
  }

  function openActualEntry(billId = '') {
    const bill = billsForPeriod.find(item => item.id === billId)
    const actual = bill?.history.find(item => item.period === selectedPeriod && item.source === 'actual')
    setActualEntry({ billId: bill?.id ?? '', amount: actual ? String(actual.amount) : '' })
    setShowActualEntry(true)
  }

  function saveActualEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!actualEntryBill) { setToast('Válaszd ki, melyik számla érkezett meg.'); return }
    const amount = Number(actualEntry.amount)
    try {
      const id = crypto.randomUUID()
      recordActualInvoice(actualEntryBill, selectedPeriod, amount, id)
      setBills(current => current.map(bill => bill.id === actualEntryBill.id ? recordActualInvoice(bill, selectedPeriod, amount, id) : bill))
      setShowActualEntry(false)
      setToast(`${actualEntryBill.name}: a tényleges összeg mentve. A rendezett állapotot külön jelölheted.`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'A számlaösszeg mentése nem sikerült.')
    }
  }

  function saveProfileName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = profileNameDraft.trim().replace(/\s+/g, ' ')
    if (!name) return
    storage.setItem('hogvege-profile-name-v1', name)
    setProfileName(name)
    setProfileNameDraft(name)
    setEditingProfileName(false)
  }

  return <div className={`app-shell ${darkMode ? 'dark' : ''}`}>
    <aside className="sidebar">
      <button className="brand" onClick={() => setActive('overview')} aria-label="Hóvége kezdőlap"><span className="brand-mark"><span /><span /><span /></span><span className="brand-name">hóvége<span className="brand-dot">.</span></span></button>
      <div className="workspace-label">SAJÁT HÁZTARTÁS</div>
      <nav className="side-nav" aria-label="Fő navigáció">{navItems.map(item => { return <button key={item.id} aria-current={active === item.id ? 'page' : undefined} className={`nav-link ${active === item.id ? 'selected' : ''}`} onClick={() => setActive(item.id)}><Icon name={item.icon} size={19} /><span>{item.label}</span>{item.id === 'bills' && <span className="nav-count">{bills.length}</span>}</button>})}</nav>
      <div className="sidebar-bottom"><button className="help-card" onClick={() => setShowHelp(true)} aria-haspopup="dialog"><span className="help-icon"><Icon name="CircleHelp" size={17} /></span><span className="help-card-copy"><strong>Kérdésed van?</strong><span>Útmutató az alkalmazáshoz</span></span><Icon name="ChevronRight" size={16} /></button><button className="profile-row" onClick={() => { setProfileNameDraft(profileName); setEditingProfileName(true); setActive('overview') }}><span className="avatar">{nameInitials(profileName)}</span><span className="profile-copy"><strong>{profileName || 'Saját háztartás'}</strong><small>Név és háztartás</small></span><Icon name="ChevronRight" size={18} /></button></div>
    </aside>

    <a className="skip-link" href="#main-content">Ugrás a tartalomra</a><main className={`main-area ${active === 'overview' ? 'overview-main' : active === 'calendar' ? 'calendar-main' : ''}`} id="main-content" tabIndex={-1}>
      <header className="topbar"><div className="mobile-brand"><span className="brand-mark"><span /><span /><span /></span><b>hóvége<span className="brand-dot">.</span></b></div><div className="crumb"><span>{profileName || 'Saját háztartás'}</span><Icon name="ChevronRight" size={14} /><strong>{navItems.find(item => item.id === active)?.label}</strong></div><div className="top-actions"><button className="primary-button top-add" onClick={() => billsForPeriod.length ? openActualEntry() : openNewBill()}><Icon name="Plus" size={17}/>{billsForPeriod.length ? "Számla érkezett" : "Új számla"}</button><button className="icon-button notification-button" aria-label="Emlékeztetők" onClick={() => { const dueSoon = dueSoonBill(); const days = dueSoon ? Math.ceil((dueSoon.date.getTime() - new Date(new Date().setHours(0, 0, 0, 0)).getTime()) / 86400000) : 0; setToast(notificationsEnabled && dueSoon ? `${dueSoon.bill.name} ${days === 0 ? 'ma' : `${days} nap múlva`} esedékes · ${money(forecast(dueSoon.bill).amount)}.` : notificationsEnabled ? 'Nincs számla a következő 3 napban.' : 'Az emlékeztetők ki vannak kapcsolva.') }}><Icon name="Bell" size={19} /><i /></button><button className="top-avatar" aria-label="Beállítások megnyitása" onClick={() => setActive('settings')}>{nameInitials(profileName)}</button></div></header>

      {deletedBill && <div className="undo-banner" role="status"><span>„{deletedBill.name}” törölve.</span><button className="text-link" onClick={() => { setBills(current => current.some(bill => bill.id === deletedBill.id) ? current : [...current, deletedBill]); setDeletedBill(null); setToast('A számlát visszaállítottuk.') }}>Visszavonás</button><button className="icon-button" aria-label="Visszavonási lehetőség bezárása" onClick={() => setDeletedBill(null)}><Icon name="X"/></button></div>}
      {storageError && <div className="storage-alert" role="alert"><div><strong>Az adataid mentése figyelmet kér</strong><p>{storageError}</p></div><button className="secondary-button" onClick={exportRecovery}>Helyreállítási másolat</button><button className="secondary-button" onClick={exportBackup}>Aktuális adatok exportálása</button></div>}
      {active === 'overview' && <section className="page-content overview-page" aria-labelledby="overview-title">
        <header className="overview-header">
          <div className="overview-intro">
            <span className="overview-kicker">Havi áttekintés</span>
            {editingProfileName ? <>
              <h1 id="overview-title">Hogy szólíthatunk?</h1>
              <p>Add meg a neved, és így köszönünk majd a havi áttekintőn.</p>
              <form className="welcome-name-form" onSubmit={saveProfileName}><label className="sr-only" htmlFor="profile-name">A neved</label><input id="profile-name" value={profileNameDraft} onChange={event => setProfileNameDraft(event.target.value)} placeholder="Például Anna" maxLength={40} autoFocus required/><button className="primary-button" type="submit">Mentés</button></form>
            </> : <>
              <h1 id="overview-title">Szia, {profileName}!</h1>
              <p>{isDemoData ? 'Mintaadatokkal nézheted meg, hogyan alakul a hónap.' : 'Itt látod egy helyen, mi van rendezve és mi vár még rád.'}</p>
              <button className="overview-name-edit" type="button" onClick={() => { setProfileNameDraft(profileName); setEditingProfileName(true) }}>Név módosítása</button>
            </>}
          </div>
          <div className="overview-period" role="group" aria-label="Hónapváltás">
            <span className="overview-period-label">Megjelenített hónap</span>
            <div className="overview-period-controls"><button type="button" onClick={() => setMonthOffset(value => value - 1)} aria-label="Előző hónap"><Icon name="ArrowLeft" size={18} /></button><strong>{month}</strong><button type="button" onClick={() => setMonthOffset(value => value + 1)} aria-label="Következő hónap"><Icon name="ArrowRight" size={18} /></button></div>
            {monthOffset !== 0 && <button className="overview-current-month" type="button" onClick={() => setMonthOffset(0)}>Vissza az aktuális hónapra</button>}
          </div>
        </header>
        {isDemoData && <div className="demo-data-banner"><span className="comparison-pill">PRÓBAADATOK</span><span>A romániai referenciaértékek becslések, nem valódi számlák. 2025. jan. – 2026. okt.</span><button onClick={restoreBenchmarkData}>Referenciaadatok betöltése</button>{isDemoData && <button onClick={() => { if (!window.confirm('Töröljük az érintetlen próbaszámlákat? A saját számlák és a saját előzménnyel kiegészített tételek megmaradnak.')) return; setBills(current => current.filter(bill => !bill.history.length || !bill.history.every(invoice => invoice.id.startsWith('ro-benchmark-')))); setIsDemoData(false); storage.setItem('hogvege-demo-dismissed-v1', 'true'); setToast('Az érintetlen próbaszámlákat töröltük. A saját adataid megmaradtak.') }}>Próbaadatok törlése</button>}</div>}
        {bills.length === 0 && <section className="onboarding-card"><div className="onboarding-icon"><Icon name="Wallet" size={32}/></div><div><span className="section-kicker">A NYUGODT HÓVÉGE ITT KEZDŐDIK</span><h2>Egy helyen minden havi kiadásod.</h2><p>Rögzítsd az első számlád, és állítsd össze a saját havi terved. Pár perc, több átláthatóság.</p><div className="onboarding-actions"><button className="primary-button" onClick={openNewBill}><Icon name="Plus"/> Első számla hozzáadása</button><button className="text-link" onClick={restoreBenchmarkData}>Kipróbálom mintaadatokkal <Icon name="ArrowRight"/></button></div></div></section>}
        <div className="overview-lead">
          <section className="overview-balance-card" aria-labelledby="overview-balance-title">
            <div className="overview-card-top"><span className="overview-card-kicker">Számlák állapota</span><span className={`overview-status ${overdueBills.length ? 'is-urgent' : ''}`}>{overdueBills.length ? `${overdueBills.length} lejárt` : activeBills.length ? `${activeBills.length} teendő` : 'Minden rendezve'}</span></div>
            <h2 id="overview-balance-title">{activeBills.length ? 'Még rendezendő' : 'Nincs nyitott számla'}</h2>
            <strong className="overview-balance-amount">{money(pendingEstimate)}</strong>
            <p className="overview-balance-copy">{activeBills.length ? `${activeBills.length} számla van hátra ebben a hónapban.` : billsForPeriod.length ? 'A hónap összes rögzített számláját rendezted.' : 'Erre a hónapra még nem vettél fel számlát.'}</p>
            <div className="overview-progress" role="img" aria-label={`Rendezve ${money(paidAmount)} a ${money(totalEstimate)} havi kötelezettségből`}><span style={{ width: `${totalEstimate > 0 ? Math.max(0, Math.min(100, paidAmount / totalEstimate * 100)) : 0}%` }} /></div>
            <div className="overview-totals"><span>Rendezve <strong>{money(paidAmount)}</strong></span><span>Havi összesen <strong>{money(totalEstimate)}</strong></span></div>
            <button className="overview-card-action" type="button" onClick={() => setActive('bills')}>Számlák megnyitása <Icon name="ArrowRight" size={17}/></button>
          </section>
          <section className="overview-plan-card" aria-labelledby="overview-plan-title">
            <span className="overview-card-kicker">Pénzügyi terv</span>
            <h2 id="overview-plan-title">{cashPlanAvailable ? 'Hó végi becslés' : 'Tervezz előre'}</h2>
            {cashPlanAvailable ? <>
              <strong className="overview-plan-amount">{money(rawSafeToSpend ?? 0)}</strong>
              <p>A mai egyenlegből indulva, a még várható számlák és a havi célra félretett összeg után.</p>
              <p className="overview-plan-caution">A nem rögzített napi költések nincsenek benne.</p>
            </> : <p>{monthOffset === 0 ? 'Add meg a mai egyenleged és a fizetésnapod, hogy lásd a hó végi becslést.' : 'A hó végi egyenleg becslése az aktuális hónapban érhető el. A kiválasztott hónap számláit itt is áttekintheted.'}</p>}
            <button type="button" onClick={() => setActive('planning')}>{cashPlanAvailable ? 'Terv megnyitása' : 'Terv beállítása'} <Icon name="ArrowRight" size={17}/></button>
          </section>
        </div>
        <section className="overview-section" aria-labelledby="overview-upcoming-title">
          <div className="overview-section-heading"><div><span className="overview-section-kicker">Következő lépések</span><h2 id="overview-upcoming-title">Esedékes számlák</h2><p>{activeBills.length ? 'A legközelebbi három rendezetlen tétel.' : 'Most nincs rendezetlen tétel.'}</p></div><div className="overview-section-actions"><button className="primary-button" type="button" onClick={() => openActualEntry()} disabled={!billsForPeriod.length}>Számla megérkezett</button><button className="overview-section-link" type="button" onClick={() => setActive('bills')}>Összes számla <Icon name="ArrowRight" size={17}/></button></div></div>
          <div className="upcoming-grid overview-upcoming">{[...activeBills.slice(0, 3), ...(settlingBillId && !activeBills.slice(0, 3).some(bill => bill.id === settlingBillId) ? billsForPeriod.filter(bill => bill.id === settlingBillId) : [])].map((bill, index) => <BillCard key={bill.id} period={selectedPeriod} bill={bill} index={index} paid={isPaid(bill)} settling={settlingBillId === bill.id} onPay={() => toggleUpcomingPaid(bill.id)} onActual={() => openActualEntry(bill.id)} onDetails={() => openDetails(bill.id)} />)}{activeBills.length === 0 && !settlingBillId && <div className="overview-empty"><Icon name="Check" size={22}/><strong>{billsForPeriod.length ? 'Minden számla rendezve' : 'Még nincs számla erre a hónapra'}</strong><span>{billsForPeriod.length ? 'Nézz vissza, ha új tétel érkezik.' : 'Vedd fel az első havi tételt.'}</span></div>}<button className="add-bill-card" onClick={openNewBill}><span className="add-circle"><Icon name="Plus" size={19} /></span><strong>Új számla</strong><span>Írd be a tényleges összeget</span></button></div>
        </section>
        <section className="overview-section overview-insights" aria-labelledby="overview-insights-title">
          <div className="overview-section-heading"><div><span className="overview-section-kicker">Részletek</span><h2 id="overview-insights-title">Hová megy a pénz?</h2><p>A rögzített számlák trendje és megoszlása.</p></div><button className="overview-section-link" type="button" onClick={() => setActive('reports')}>Kimutatások <Icon name="ArrowRight" size={17}/></button></div>
          <div className="visual-guides"><SpendingTrend bills={bills} offset={monthOffset} /><SpendingCard bills={billsForPeriod} total={totalEstimate} period={selectedPeriod} /></div>
          <p className="overview-estimate-note">Becsült összegnél a saját tervedet vagy a legutóbbi három ismert hónap átlagát használjuk. Az adott havi tényleges számla felülírja a becslést.</p>
        </section>
        {notificationsEnabled && <PriceAlerts bills={bills} onDetails={openDetails} />}
        <PageFooter />
      </section>}
      {active === 'bills' && <section className="page-content"><div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> HAVI KIADÁSOK</div><h1>Számláim</h1><p className="subtitle">A havi tételek és a számláid előzményei egy helyen.</p></div><div className="bill-header-actions"><button className="primary-button" onClick={() => openActualEntry()} disabled={!billsForPeriod.length}>Számla megérkezett</button><button className="secondary-button" onClick={openNewBill}><Icon name="Plus" size={18} /> Új tétel</button></div></div><div className="bill-summary-row"><Summary label="Havi kötelezettség" amount={totalEstimate} note="számlákból és tervezett összegekből" featured /><Summary label="Rendezetlen" amount={pendingEstimate} note={`${activeBills.length} számla van hátra`} /><Summary label="Rendezve" amount={paidAmount} note="ebben a hónapban" /></div><div className="list-toolbar"><MonthSelector month={month} previous={() => setMonthOffset(value => value - 1)} next={() => setMonthOffset(value => value + 1)} /><div className="filter-tabs" aria-label="Számlák szűrése">{[['all', 'Összes'], ['pending', 'Rendezetlen'], ['paid', 'Rendezett']].map(([value, label]) => <button key={value} aria-pressed={statusFilter === value} className={statusFilter === value ? 'active' : ''} onClick={() => setStatusFilter(value)}>{label}</button>)}</div><label className="sort-control">Rendezés<select value={sortOrder} onChange={event => setSortOrder(event.target.value)}><option value="due">Határidő szerint</option><option value="amount">Összeg szerint</option><option value="name">Név szerint</option></select></label></div><div className="bill-list-header"><div><span className="section-kicker">Összes rögzített tétel</span><h2>{month.charAt(0).toLocaleUpperCase('hu-HU') + month.slice(1)} <span className="heading-count">{bills.length}</span></h2></div><label className="search-box"><Icon name="Search" size={17} /><input value={search} onChange={event => setSearch(event.target.value)} aria-label="Keresés név, szolgáltató vagy kategória szerint" placeholder="Név, szolgáltató, kategória…" /></label></div><div className="bill-list">{filteredBills.map(bill => <BillRow key={bill.id} period={selectedPeriod} bill={bill} paid={isPaid(bill)} active={appliesToPeriod(bill, selectedPeriod)} onPay={() => togglePaid(bill.id)} onActual={() => openActualEntry(bill.id)} onDetails={() => openDetails(bill.id)} />)}{filteredBills.length === 0 && <div className="empty-state">Nincs a szűrésnek megfelelő számla. <button className="text-link" onClick={() => { setSearch(''); setStatusFilter('all') }}>Szűrés törlése</button></div>}</div><PageFooter /></section>}

      {active === 'calendar' && <CalendarPage bills={billsForPeriod} month={month} monthInfo={monthInfo} monthOffset={monthOffset} setMonthOffset={setMonthOffset} onDetails={openDetails} onToggle={togglePaid} isPaid={isPaid} />}
      {active === 'reports' && <section className="page-content"><div className="welcome-row"><div><div className="eyebrow">A SZÁMOK MÖGÖTT</div><h1>Kimutatások</h1><p className="subtitle">Értsd meg a kiadásaidat, és vedd észre a változásokat.</p></div><button className="secondary-button" onClick={exportBackup}>Adatok exportálása <Icon name="ArrowRight"/></button></div><BillAnalytics bills={bills} onDetails={openDetails}/><div className="feature-grid"><BillChanges bills={bills} onDetails={openDetails}/><SubscriptionOverview bills={bills} onDetails={openDetails}/></div><PageFooter/></section>}
      {active === 'planning' && <section className="page-content"><div className="welcome-row"><div><div className="eyebrow">TERET A FONTOS DOLGOKNAK</div><h1>A te pénzügyi terved</h1><p className="subtitle">Egyenleg, bevétel és megtakarítás — átláthatóan.</p></div></div><CashflowTimeline bills={bills} cashPlan={{ ...cashPlan, balance: currentCashBalance }} projection={monthProjection} goalName={savingsGoal.name || 'megtakarítási cél'} onDetails={openDetails} onConfigure={() => document.querySelector('.cash-plan-card input')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}/><div className="planning-grid">
        <section className="cash-plan-card"><div><span className="section-kicker">PÉNZÁRAMLÁS-ELŐREJELZÉS</span><h2>Bevétel és egyenleg</h2><p>Add meg a mai tényleges egyenleged, a havi bevételedet és a fizetés napját. Ha ma frissíted az egyenleget, a mai fizetést nem adjuk hozzá újra. A rendezett számlákat nem vonjuk le; a napi vásárlásokat viszont csak akkor követjük, ha frissíted az egyenleget.</p></div><form key={JSON.stringify(cashPlan)} className="cash-plan-form" onSubmit={saveCashPlan}><label className="field-label">Mai elérhető egyenleg (lei)<input name="cash-balance" type="number" min="0" step="1" defaultValue={currentCashBalance ?? ''} placeholder="Például 3500" required /></label><label className="field-label">Rendszeres havi bevétel (lei)<input name="cash-income" type="number" min="1" step="1" defaultValue={cashPlan.income ?? ''} placeholder="Például 6000" required /></label><label className="field-label">Fizetés napja minden hónapban<input name="cash-payday" type="number" min="1" max="31" defaultValue={cashPlan.payday ?? ''} placeholder="1–31" required /></label><button className="primary-button" type="submit">Előrejelzés frissítése</button></form></section>
        <section className="savings-goal-card"><div><span className="section-kicker">MEGTAKARÍTÁSI CÉL</span><h2>{savingsGoal.name || 'Tegyél félre valami fontosra'}</h2><p>A cél hátralévő összegét a határidőig fennmaradó hónapokra osztjuk. A havi részletet csak akkor számoljuk, ha a várható egyenleg fedezi.</p></div>{savingsGoal.target > 0 && <div className="goal-progress"><div className="goal-progress-track"><i style={{ width: `${Math.min(100, goalProjectedByDeadline / savingsGoal.target * 100)}%` }} /></div><span>{money(savingsGoal.saved)} biztosan félretéve · {Math.round(Math.min(100, savingsGoal.saved / savingsGoal.target * 100))}%</span><small>Erre a hónapra tervezett félretétel: {money(goalReserveThisMonth)} · határidőre becsülve {money(goalProjectedByDeadline)}</small>{savingsGoal.deadline && <small>{weeksToGoalDeadline} hét van hátra · heti cél {money(weeklyGoalContribution)}</small>}</div>}<form key={JSON.stringify(savingsGoal)} className="goal-form" onSubmit={saveSavingsGoal}><label className="field-label">Cél neve<input name="goal-name" maxLength={200} defaultValue={savingsGoal.name} placeholder="Például nyaralás" /></label><div className="field-row"><label className="field-label">Célösszeg (lei)<input name="goal-target" type="number" min="1" step="1" defaultValue={savingsGoal.target || ''} required /></label><label className="field-label">Már félretett összeg<input name="goal-saved" type="number" min="0" step="1" defaultValue={savingsGoal.saved || 0} required /></label></div><label className="field-label">Határidő<input name="goal-deadline" type="month" min={monthKey()} defaultValue={savingsGoal.deadline} required /></label><button className="primary-button" type="submit">Cél mentése</button></form></section>
</div><UpcomingWeek bills={bills} onDetails={openDetails}/><PageFooter/></section>}
      {active === 'settings' && <section className="page-content">
        <div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> SZEMÉLYRE SZABÁS</div><h1>Beállítások</h1><p className="subtitle">Állítsd be úgy, ahogy neked kényelmes.</p></div></div>
        <div className="settings-card">
          <div className="settings-section"><div className="settings-icon"><Icon name="FileText" size={19} /></div><div className="settings-copy"><strong>Romániai próbaadatok</strong><span>22 hónapnyi becsült víz-, gáz-, mobil-, üzemanyag- és lakbéradat visszatöltése.</span></div><button className="secondary-button" onClick={restoreBenchmarkData}>Minta visszaállítása</button></div>
          <div className="settings-section"><div className="settings-icon"><Icon name="Wallet" size={19} /></div><div className="settings-copy"><strong>Pénznem</strong><span>Az összegek lejben jelennek meg.</span></div><span className="setting-value">RON</span></div>
          <div className="settings-section"><div className="settings-icon"><Icon name="Moon" size={19} /></div><div className="settings-copy"><strong>Sötét mód</strong><span>Kényelmesebb esti megjelenés.</span></div><button className={`toggle ${darkMode ? 'on' : ''}`} aria-label="Sötét mód beállítása" aria-pressed={darkMode} onClick={() => setDarkMode(enabled => !enabled)}><span /></button></div>
          <div className="settings-section"><div className="settings-icon"><Icon name="Bell" size={19} /></div><div className="settings-copy"><strong>Emlékeztetők</strong><span>Bekapcsolva a következő 3 nap esedékességéről a böngésző is jelezhet, ha engedélyezed az értesítést.</span></div><button className={`toggle ${notificationsEnabled ? 'on' : ''}`} aria-label="Emlékeztetők beállítása" aria-pressed={notificationsEnabled} onClick={() => void toggleReminders()}><span /></button></div>
          <div className="settings-section"><div className="settings-icon"><Icon name="ShieldCheck" size={19} /></div><div className="settings-copy"><strong>Adatvédelem</strong><span>A számláid, bevételi terved és megtakarítási célod ezen a készüléken, a böngésződben tárolódnak.</span></div><Icon name="ShieldCheck" size={18} className="settings-chevron" /></div>
        </div>
        <section className="data-tools"><div><span className="section-kicker">ADATKEZELÉS</span><h2>Adatmentés és próbaadatok</h2><p>Töltsd le a romániai mintaadatokat, majd a mentés visszaállításával importáld őket. Az import lecseréli a számlalistát és a pénzügyi tervet.</p></div><div className="data-tools-actions"><button className="secondary-button" onClick={exportDemoData}><Icon name="ArrowRight" size={16} /> Próbaadatok letöltése</button><button className="secondary-button" onClick={exportBackup}><Icon name="ArrowRight" size={16} /> Saját adatmentés letöltése</button><label className="secondary-button import-button"><Icon name="Plus" size={16} /> Mentés visszaállítása<input type="file" accept="application/json,.json" onChange={importBackup} /></label></div></section>
        <div className="settings-note"><Icon name="ShieldCheck" size={17} /><span>A számlalistát a böngésződ tárolja. A felismeréshez kiválasztott fájlt a Hóvége kiszolgálója dolgozza fel, majd törli. Az importált mentés felülírja a számlalistát, és visszaállítja a benne mentett pénzügyi tervet.</span></div>
      </section>}
    </main>

    <nav className="mobile-nav" aria-label="Mobil navigáció">{navItems.filter(item => item.id !== 'settings').map(item => <button key={item.id} aria-current={active === item.id ? 'page' : undefined} className={active === item.id ? 'active' : ''} onClick={() => setActive(item.id)}><Icon name={item.icon} size={20} /><span>{item.label}</span></button>)}</nav>

    {showActualEntry && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowActualEntry(false) }}><section className="add-modal actual-entry-modal" role="dialog" aria-modal="true" aria-labelledby="actual-entry-title"><div className="modal-top"><div><span className="section-kicker">MEGÉRKEZETT SZÁMLA</span><h2 id="actual-entry-title">Mennyi lett a számla?</h2></div><button className="icon-button" type="button" onClick={() => setShowActualEntry(false)} aria-label="Bezárás"><Icon name="X" size={20}/></button></div><p className="modal-intro">{month} hónap tényleges összegét rögzíted. A fizetést majd külön jelölheted.</p>{billsForPeriod.length ? <form onSubmit={saveActualEntry}><label className="field-label">Melyik számla érkezett meg?<select value={actualEntry.billId} onChange={event => { const bill = billsForPeriod.find(item => item.id === event.target.value); const actual = bill?.history.find(item => item.period === selectedPeriod && item.source === 'actual'); setActualEntry({ billId: bill?.id ?? '', amount: actual ? String(actual.amount) : '' }) }} autoFocus={!actualEntry.billId} required><option value="">Válassz a havi tételekből</option>{billsForPeriod.map(bill => <option key={bill.id} value={bill.id}>{bill.name}</option>)}</select></label><label className="field-label">A számlán szereplő összeg (lei)<input type="number" min="0.01" max="1000000000" step="0.01" inputMode="decimal" value={actualEntry.amount} onChange={event => setActualEntry(current => ({ ...current, amount: event.target.value }))} placeholder="Például 225" autoFocus={!!actualEntry.billId} required /></label>{actualEntryBill && <div className="actual-entry-context"><span>Korábbi havi terv</span><strong>{money(actualEntryBill.plannedAmount ?? actualEntryBill.amount)}</strong>{actualEntryExists && <small>A korábban rögzített tényleges összeget frissíted.</small>}</div>}<p className="actual-entry-note">A mentés lecseréli ennek a hónapnak a becsült összegét. A számla rendezetlen marad, amíg ki nem fizeted és külön meg nem jelölöd.</p><button className="primary-button modal-submit" type="submit" disabled={!actualEntry.billId}>{actualEntryExists ? 'Összeg frissítése' : 'Tényleges összeg mentése'}</button></form> : <p className="actual-entry-note">Erre a hónapra még nincs felvett tétel.</p>}<button className="quick-bill-detailed" type="button" onClick={() => { setShowActualEntry(false); openNewBill() }}>Új havi tételt veszek fel <Icon name="ArrowRight" size={16}/></button></section></div>}

    {showAdd && addMode === 'quick' && <div className="modal-backdrop wizard-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowAdd(false) }}><section className="add-modal wizard-modal quick-bill-modal" role="dialog" aria-modal="true" aria-labelledby="quick-bill-title"><div className="modal-top"><div><span className="section-kicker">ÚJ HAVI TÉTEL</span><h2 id="quick-bill-title">Írd be a számla összegét</h2></div><button className="icon-button" onClick={() => setShowAdd(false)} aria-label="Bezárás"><Icon name="X" size={20} /></button></div><p className="modal-intro">Amikor megjön egy új számla, írd be, mennyi szerepel rajta. A fizetést később külön jelölheted.</p><form onSubmit={addQuickBill}><label className="field-label">Mi ez a kiadás?<input maxLength={200} value={quickBill.name} onChange={event => setQuickBill(current => ({ ...current, name: event.target.value }))} placeholder="Például villanyszámla" autoFocus required /></label><label className="field-label">A számlán szereplő összeg (lei)<input type="number" min="0.01" max="1000000000" step="0.01" inputMode="decimal" value={quickBill.amount} onChange={event => setQuickBill(current => ({ ...current, amount: event.target.value }))} placeholder="Például 180" required /></label><label className="field-label">Esedékesség napja<input type="number" min="1" max="31" step="1" value={quickBill.dueDay} onChange={event => setQuickBill(current => ({ ...current, dueDay: event.target.value }))} required /></label><p className="quick-bill-note">A tényleges összeget {month} hónaphoz mentjük. A következő hónap tervében is ezt használjuk, amíg módosítod.</p><div className="wizard-actions"><button className="primary-button modal-submit" type="submit"><Icon name="Plus" size={18}/> Számla mentése</button></div></form><button className="quick-bill-detailed" type="button" onClick={() => { setBillForm(current => ({ ...current, name: quickBill.name, amount: quickBill.amount, dueDay: quickBill.dueDay, category: 'Egyéb', icon: 'other' })); setAddStep(0); setAddMode('detailed') }}>Részletes felvétel vagy számlafelismerés <Icon name="ArrowRight" size={16}/></button></section></div>}
    {showAdd && addMode === 'detailed' && <div className="modal-backdrop wizard-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowAdd(false) }}><section className="add-modal wizard-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-top"><div><span className="section-kicker">ÚJ FIZETÉS · {addStep + 1}/3. LÉPÉS</span><h2 id="modal-title">{['Mit fizetsz?', 'Mennyit és mikor?', 'Első számlaadat'][addStep]}</h2></div><button className="icon-button" onClick={() => setShowAdd(false)} aria-label="Bezárás"><Icon name="X" size={20} /></button></div><div className="wizard-progress" aria-label={`A folyamat ${addStep + 1}. lépése a 3-ból`}><i className={addStep >= 0 ? 'active' : ''}/><i className={addStep >= 1 ? 'active' : ''}/><i className={addStep >= 2 ? 'active' : ''}/></div><p className="modal-intro">{['Nevezz el egy fizetést, és válassz hozzá kategóriát.', 'Add meg a tervezett összeget, esedékességet és ismétlődést.', 'Rögzítsd az első időszakot és számlaadatot.'][addStep]}</p><form onSubmit={event => { event.preventDefault(); if (addStep === 0 && !billForm.name.trim()) { setToast('Add meg a fizetés nevét a továbblépéshez.'); return } if (addStep === 1 && (!Number(billForm.amount) || Number(billForm.amount) <= 0)) { setToast('Adj meg egy érvényes tervezett összeget.'); return } if (addStep === 1 && billForm.recurring === 'Évente' && billForm.period.slice(5, 7) !== billForm.startPeriod.slice(5, 7)) { setToast('Éves fizetésnél az első számlázás hónapja egyezzen a kezdő hónappal.'); return } if (addStep < 2) { setAddStep(step => step + 1); return } addBill(event) }}>
      {addStep === 0 && <><section className="invoice-ai-card new-bill-recognition" aria-label="Számla felismerése új fizetéshez"><div className="invoice-ai-heading"><span className="invoice-ai-mark"><Icon name="Sparkles" size={17}/></span><div><strong>Új fizetés számlából</strong><small>Töltsd fel a számlát, a helyi felismerés előtölti az adatokat</small></div></div><label className="invoice-file-button"><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0] ?? null; event.target.value = ''; if (!file) return; if (file.size > 10 * 1024 * 1024) { setInvoiceAIError('A fájl legfeljebb 10 MB lehet.'); setInvoiceFile(null); return } if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setInvoiceAIError('PDF, JPG, PNG vagy WebP fájlt válassz.'); setInvoiceFile(null); return } setInvoiceAIError(''); setInvoiceAIStatus(''); setInvoiceAI(null); setInvoiceFile(file) }} /><Icon name="Plus" size={16}/><span>{invoiceFile ? invoiceFile.name : 'Számla kiválasztása'}</span></label><p className="invoice-local-note">PDF, JPG, PNG vagy WebP · max. 10 MB. A fájlt a Hóvége kiszolgálója dolgozza fel.</p><button type="button" className="secondary-button invoice-ai-submit" disabled={!invoiceFile || invoiceAIWorking} onClick={() => void recognizeInvoice('new-bill')}><Icon name="Sparkles" size={16}/>{invoiceAIWorking ? 'Helyi felismerés folyamatban…' : 'Adatok felismerése'}</button>{invoiceAIStatus && <p className="invoice-ai-message" role="status">{invoiceAIStatus}</p>}{invoiceAIError && <p className="invoice-ai-error" role="alert">{invoiceAIError}</p>}{invoiceAI && <div className="invoice-ai-result"><strong>Felismerés kész{invoiceAI.supplier ? ` · ${invoiceAI.supplier}` : ''}</strong><span>{invoiceAI.billingPeriod ? `${invoiceAI.billingPeriod} · ` : ''}{invoiceAI.amount !== null ? money(invoiceAI.amount) : 'Összeg nem található'}{invoiceAI.dueDate ? ` · Határidő: ${invoiceAI.dueDate}` : ''}</span><small>Ellenőrizd a kitöltött adatokat. A helyi felismerés tévedhet.</small></div>}</section><div className="manual-entry-divider"><span>vagy add meg kézzel</span></div><label className="field-label">Mi ez a fizetés?<input maxLength={200} value={billForm.name} onChange={event => setBillForm({ ...billForm, name: event.target.value })} placeholder="Például villanyszámla" autoFocus required /></label><label className="field-label">Szolgáltató vagy megjegyzés<input maxLength={500} value={billForm.provider} onChange={event => setBillForm({ ...billForm, provider: event.target.value })} placeholder="Opcionális" /></label><CategoryPicker value={billForm.category} onChange={category => { const suggestedIcon = categoryOptions.find(option => option.label === category)?.icon ?? 'other'; setBillForm(current => ({ ...current, category, icon: suggestedIcon })) }} /><IconPicker value={billForm.icon} onChange={icon => setBillForm(current => ({ ...current, icon }))} /></>}
      {addStep === 1 && <><label className="field-label">Tervezett összeg<input type="number" min="0.01" step="0.01" value={billForm.amount} onChange={event => setBillForm({ ...billForm, amount: event.target.value })} placeholder="Például 180" autoFocus required /></label><div className="field-row"><label className="field-label">Esedékesség napja<input type="number" min="1" max="31" value={billForm.dueDay} onChange={event => setBillForm({ ...billForm, dueDay: event.target.value })} required /></label><label className="field-label">Ismétlődés<select value={billForm.recurring} onChange={event => setBillForm({ ...billForm, recurring: event.target.value })}><option>Havonta</option><option>Évente</option><option>Egyszeri</option></select></label></div><label className="field-label">Érvényes ettől<input type="month" value={billForm.startPeriod} onChange={event => setBillForm({ ...billForm, startPeriod: event.target.value })} required /></label></>}
      {addStep === 2 && <><div className="wizard-summary"><img src={`/images/bill-icons/${billForm.icon === 'other' ? 'common' : billForm.icon}.png`} alt=""/><div><strong>{billForm.name || 'Új fizetés'}</strong><span>{billForm.category} · {billForm.recurring.toLowerCase()}</span></div><b>{billForm.amount ? money(Number(billForm.amount)) : '—'}</b></div><div className="field-row"><label className="field-label">Első számlázási időszak<input type="month" value={billForm.period} onChange={event => setBillForm({ ...billForm, period: event.target.value })} required /></label><label className="field-label">Első számla típusa<select value={billForm.source} onChange={event => setBillForm({ ...billForm, source: event.target.value as Source })}><option value="actual">Tényleges számla</option><option value="estimated">Becsült összeg</option></select></label></div><label className="field-label">Fogyasztás <span className="optional">KWH / M³ · OPCIONÁLIS</span><input type="number" min="0" step="0.01" value={billForm.consumption} onChange={event => setBillForm({ ...billForm, consumption: event.target.value })} placeholder="Opcionális" /></label></>}
      <div className="wizard-actions">{addStep > 0 && <button type="button" className="secondary-button" onClick={() => setAddStep(step => step - 1)}>Vissza</button>}<button className="primary-button modal-submit" type="submit">{addStep === 2 ? <><Icon name="Plus" size={18}/> Hozzáadás a tervhez</> : <>Tovább <Icon name="ArrowRight" size={17}/></>}</button></div>
    </form><button className="quick-bill-detailed" type="button" onClick={() => { setQuickBill({ name: billForm.name, amount: billForm.amount, dueDay: billForm.dueDay }); setAddMode('quick') }}>Vissza a gyors bevitelhez</button></section></div>}

    {selectedBill && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedId(null) }}><section className="add-modal details-modal" role="dialog" aria-modal="true" aria-labelledby="details-title"><div className="modal-top"><div><span className="section-kicker">SZÁMLAELŐZMÉNY</span><h2 id="details-title">{selectedBill.name}</h2></div><button className="icon-button" onClick={() => setSelectedId(null)} aria-label="Bezárás"><Icon name="X" size={20} /></button></div><p className="modal-intro">{selectedBill.provider} · {selectedBill.recurring.toLowerCase()} tétel</p><div className="estimate-summary"><span>Havi becsült átlag</span><strong>{money(forecast(selectedBill).amount)}</strong><small>{forecast(selectedBill).count} nem korrekciós adat alapján, legfeljebb 3 számlából</small></div><BillHistoryInsights bill={selectedBill} bills={bills} /><details className="bill-settings"><summary>Fizetési adatok szerkesztése</summary><form onSubmit={saveBillSettings}><BillSetupFields value={editForm} onChange={changes => setEditForm(current => ({ ...current, ...changes }))} /><button className="primary-button modal-submit" type="submit">Beállítások mentése</button></form></details><div className="history-list"><div className="history-list-heading"><strong>Előzmények</strong><span>{selectedBill.history.length} adat</span></div>{selectedBill.history.slice().sort((a, b) => b.period.localeCompare(a.period) || b.id.localeCompare(a.id)).map(invoice => <div className="history-entry history-entry-manage" key={invoice.id}>{editingInvoiceId === invoice.id ? <form className="invoice-edit-form" onSubmit={saveInvoiceEdit}><div className="field-row"><label className="field-label">Időszak<input type="month" value={invoiceEditForm.period} onChange={event => setInvoiceEditForm({ ...invoiceEditForm, period: event.target.value })} required /></label><label className="field-label">Összeg<input type="number" min={invoiceEditForm.source === 'adjustment' ? undefined : '0.01'} max={1000000000} step="0.01" value={invoiceEditForm.amount} onChange={event => setInvoiceEditForm({ ...invoiceEditForm, amount: event.target.value })} required /></label></div><div className="field-row"><label className="field-label">Típus<select value={invoiceEditForm.source} onChange={event => setInvoiceEditForm({ ...invoiceEditForm, source: event.target.value as Source })}><option value="actual">Tényleges számla</option><option value="estimated">Becsült összeg</option><option value="adjustment">Korrekció</option></select></label><label className="field-label">Fogyasztás<input type="number" min="0" step="0.01" value={invoiceEditForm.consumption} onChange={event => setInvoiceEditForm({ ...invoiceEditForm, consumption: event.target.value })} placeholder="Opcionális" /></label></div><button className="secondary-button" type="submit">Mentés</button><button className="cancel-delete" type="button" onClick={() => setEditingInvoiceId(null)}>Mégse</button></form> : <><div className="history-entry-copy"><strong>{formatPeriod(invoice.period)}</strong><span>{sourceLabel(invoice.source)}{invoice.consumption ? ` · ${invoice.consumption} egység` : ''}</span></div><strong>{money(invoice.amount)}</strong><div className="invoice-actions">{invoiceDeleteId === invoice.id ? <><button className="danger-button" onClick={() => removeInvoice(invoice.id)}>Törlés</button><button className="cancel-delete" onClick={() => setInvoiceDeleteId(null)}>Mégse</button></> : <><button className="history-action" onClick={() => startInvoiceEdit(invoice)}>Szerkesztés</button><button className="history-action delete" onClick={() => setInvoiceDeleteId(invoice.id)}>Törlés</button></>}</div></>}</div>)}</div><section className="invoice-ai-card" aria-label="Helyi számlafelismerés"><div className="invoice-ai-heading"><span className="invoice-ai-mark"><Icon name="Sparkles" size={17}/></span><div><strong>Helyi számlafelismerés</strong><small>Szövegfelismerés, ellenőrizhető eredménnyel</small></div></div><label className="invoice-file-button"><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0] ?? null; event.target.value = ''; if (!file) return; if (file.size > 10 * 1024 * 1024) { setInvoiceAIError('A fájl legfeljebb 10 MB lehet.'); setInvoiceFile(null); return } if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setInvoiceAIError('PDF, JPG, PNG vagy WebP fájlt válassz.'); setInvoiceFile(null); return } setInvoiceAIError(''); setInvoiceAIStatus(''); setInvoiceAI(null); setInvoiceFile(file) }} /><Icon name="Plus" size={16}/><span>{invoiceFile ? invoiceFile.name : 'Számla kiválasztása'}</span></label><p className="invoice-local-note">A fájlt a Hóvége kiszolgálója dolgozza fel, és feldolgozás után törli az ideiglenes tárhelyről.</p><button type="button" className="secondary-button invoice-ai-submit" disabled={!invoiceFile || invoiceAIWorking} onClick={() => void recognizeInvoice()}><Icon name="Sparkles" size={16}/>{invoiceAIWorking ? 'Helyi felismerés folyamatban…' : 'Adatok felismerése'}</button>{invoiceAIStatus && <p className="invoice-ai-message" role="status">{invoiceAIStatus}</p>}{invoiceAIError && <p className="invoice-ai-error" role="alert">{invoiceAIError}</p>}{invoiceAI && <div className="invoice-ai-result"><strong>Felismert szolgáltató: {invoiceAI.supplier || 'nem található'}</strong><span>{invoiceAI.dueDate ? `Határidő: ${invoiceAI.dueDate} · ` : ''}{invoiceAI.currency || 'Pénznem nem ismert'} · {invoiceAI.confidence === 'high' ? 'nagy' : invoiceAI.confidence === 'medium' ? 'közepes' : 'alacsony'} bizonyosság</span><small>A helyi OCR tévedhet. Ellenőrizd a szerkeszthető mezőket mentés előtt.</small></div>}</section><form className="invoice-form" onSubmit={addInvoice}><div className="history-list-heading"><strong>Új számlaadat</strong></div><div className="field-row"><label className="field-label">Számlázási időszak<input type="month" value={invoiceForm.period} onChange={event => setInvoiceForm({ ...invoiceForm, period: event.target.value })} required /></label><label className="field-label">Fizetendő összeg<input type="number" min={invoiceForm.source === 'adjustment' ? undefined : '0.01'} max={1000000000} step="0.01" value={invoiceForm.amount} onChange={event => setInvoiceForm({ ...invoiceForm, amount: event.target.value })} placeholder="0" required /></label></div><div className="field-row"><label className="field-label">Elszámolás módja<select value={invoiceForm.source} onChange={event => setInvoiceForm({ ...invoiceForm, source: event.target.value as Source })}><option value="actual">Tényleges számla</option><option value="estimated">Becsült fogyasztás</option><option value="adjustment">Korrekció / elszámolás</option></select></label><label className="field-label">Fogyasztás <span className="optional">KWH / M³</span><input type="number" min="0" step="0.01" value={invoiceForm.consumption} onChange={event => setInvoiceForm({ ...invoiceForm, consumption: event.target.value })} placeholder="Opcionális" /></label></div><button className="primary-button modal-submit" type="submit"><Icon name="Plus" size={18} /> Előzmény mentése</button></form><div className="field-hint"><Icon name="Lightbulb" size={15} /> A korrekció módosítja a havi fizetendőt, de nem része az átlagbecslésnek. Jóváírásnál negatív összeget adj meg.</div><div className="remove-area">{confirmRemove ? <><span>Biztosan törlöd ezt a számlát és az összes előzményét?</span><button className="danger-button" onClick={removeSelectedBill}>Törlés</button><button className="cancel-delete" onClick={() => setConfirmRemove(false)}>Mégse</button></> : <button className="remove-link" onClick={() => setConfirmRemove(true)}>Számla és előzményei törlése</button>}</div></section></div>}
    {showHelp && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowHelp(false) }}><section className="add-modal help-modal" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="modal-top"><div><span className="section-kicker">HÓVÉGE · GYORS ÚTMUTATÓ</span><h2 id="help-title">Így használd az alkalmazást</h2></div><button className="icon-button" onClick={() => setShowHelp(false)} aria-label="Útmutató bezárása"><Icon name="X" size={20} /></button></div><p className="modal-intro">A Hóvége a háztartási kiadásaid megtervezésére, követésére és a számlaelőzmények áttekintésére szolgál.</p><div className="help-guide-list"><section><span>01</span><div><strong>Rögzítsd az első számlád</strong><p>Az első megérkezett számlát három mezőből felveheted: név, tényleges összeg, esedékességi nap. A részletes felvételben kategóriát, éves vagy egyszeri ismétlődést is beállíthatsz.</p></div></section><section><span>02</span><div><strong>Add meg a számlaadataidat</strong><p>A következő hónapban a „Számla megérkezett” gombbal válaszd ki a tételt, és írd be a számlán szereplő összeget. Ez még nem jelöli fizetettnek. A részleteknél további adatokat is rögzíthetsz, a helyi felismerés pedig segíthet a számla beolvasásában.</p></div></section><section><span>03</span><div><strong>Nézd át a becsléseket</strong><p>A havi áttekintő a tényleges számlával számol, ha van. Egyébként a havi becsült adatot, a megadott tervezett összeget vagy a korábbi három hónap átlagát használja. A korrekció a havi fizetendőt módosítja, az átlagot nem.</p></div></section><section><span>04</span><div><strong>Kövesd a fizetéseket és határidőket</strong><p>A „Rendezem” vagy „Jelölés rendezettként” gombbal jelöld az adott havi számlát rendezettnek. A „Naptár” oldalon nézd meg az esedékességeket; a hónapválasztóval más időszakra is léphetsz.</p></div></section><section><span>05</span><div><strong>Kezeld a tételeket és az adatokat</strong><p>A „Számláim” oldalon keress név vagy szolgáltató szerint. Egy tételre kattintva szerkesztheted a beállításait és előzményeit, illetve törölheted. A „Tervezés” oldalon megadhatod a havi bevételedet, fizetésnapodat és induló egyenlegedet, valamint beállíthatsz megtakarítási célt. Az adatmentés a pénzügyi tervet is tartalmazza.</p></div></section><section><span>06</span><div><strong>Személyes adatok és tárolás</strong><p>A profilneved, pénzügyi terved és számláid a böngésző helyi tárhelyén maradnak. Bekapcsolt emlékeztetőkkel, engedélyezett böngészőértesítés esetén a következő három nap esedékességeiről és jelentős számlanövekedésről kapsz jelzést, amikor az alkalmazás nyitva van. A számlafelismerés a helyi API-n keresztül működik, és az alkalmazás a fájlt ideiglenesen kezeli.</p></div></section></div><button className="primary-button modal-submit" onClick={() => setShowHelp(false)}>Értem, bezárás</button></section></div>}
    {toast && <div className="toast" role="status"><span className="toast-check"><Icon name="Check" size={16} /></span>{toast}<button onClick={() => setToast('')} aria-label="Bezárás"><Icon name="X" size={15} /></button></div>}
  </div>
}

function MonthSelector({ month, previous, next }: { month: string; previous: () => void; next: () => void }) {
  return <div className="month-select" role="group" aria-label="Hónapválasztó"><button className="month-arrow" type="button" onClick={previous} aria-label="Előző hónap"><Icon name="ArrowLeft" size={16} /></button><span>{month}</span><button className="month-arrow" type="button" onClick={next} aria-label="Következő hónap"><Icon name="ArrowRight" size={16} /></button></div>
}

function BillCard({ bill, period, index, paid, settling = false, onPay, onActual, onDetails }: { bill: Bill; period: string; index: number; paid: boolean; settling?: boolean; onPay: () => void; onActual: () => void; onDetails: () => void }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const daysLeft = Math.round((dueDate(bill, period).getTime() - today.getTime()) / 86400000)
  return <article className={`upcoming-card card-${index} ${settling ? 'settling' : ''}`}><div className="bill-card-top"><span className={`bill-icon ${bill.color}`}><BillIcon type={bill.icon} /></span><button className="bill-actual-link" type="button" onClick={onActual}>{bill.history.some(item => item.period === period && item.source === 'actual') ? 'Összeg módosítása' : 'Számla megérkezett'}</button></div><h3><button className="card-title" onClick={onDetails}>{bill.name}</button></h3><p className="bill-provider">{bill.provider}</p><div className="card-amount-row"><div><span className="muted-label">Havi összeg</span><strong>{money(periodAmount(bill, period))}</strong></div><span className="due-date"><Icon name="Clock3" size={13} /> {daysLeft === 0 ? 'Ma' : daysLeft < 0 ? `${Math.abs(daysLeft)} napja lejárt` : `${daysLeft} nap múlva`}</span></div><div className="bill-card-bottom"><span>{bill.dueDay}. napjáig</span><button onClick={onPay}>{paid ? <><Icon name="Check" size={14} /> Rendezve</> : 'Rendezem'}</button></div></article>
}

function BillRow({ bill, period = monthKey(), paid, active = true, onPay, onActual, onDetails }: { bill: Bill; period?: string; paid: boolean; active?: boolean; onPay: () => void; onActual?: () => void; onDetails: () => void }) {
  const data = forecast(bill, period)
  return <article className={`bill-row ${paid ? 'is-paid' : ''} ${!active ? 'not-due' : ''}`}><span className={`bill-icon ${bill.color}`}><BillIcon type={bill.icon} /></span><div className="bill-row-copy"><button className="bill-name" onClick={onDetails}>{bill.name}</button><span>{bill.provider} <i /> {bill.recurring}</span></div><div className="bill-row-date"><Icon name="CalendarDays" size={15} /><span>{bill.dueDay}. napjáig</span></div><div className="bill-row-amount"><strong>{money(periodAmount(bill, period))}</strong><span>{bill.history.some(item => item.period === period && item.source === 'actual') ? 'Rögzített számla' : bill.plannedAmount !== undefined ? 'Tervezett összeg' : `${data.count} előzményből`}</span>{onActual && <button className="bill-actual-link" type="button" onClick={onActual}>Tényleges összeg</button>}</div><button className={`status-button ${paid ? 'paid' : ''}`} onClick={onPay} disabled={!active}>{!active ? 'Nem esedékes' : paid ? <><Icon name="Check" size={14} /> Rendezve</> : 'Jelölés rendezettként'}</button></article>
}

function Summary({ label, amount, note, featured = false }: { label: string; amount: number; note: string; featured?: boolean }) {
  return <div className={`bill-summary ${featured ? 'featured' : ''}`}><span>{label}</span><strong>{money(amount)}</strong><small>{note}</small></div>
}

function SpendingCard({ bills, total, period }: { bills: Bill[]; total: number; period: string }) {
  const mainCategories = ['Lakhatás', 'Közüzem', 'Előfizetés', 'Közös költség']
  const rows = [
    { label: 'Lakhatás', color: 'green' }, { label: 'Közüzem', color: 'yellow' },
    { label: 'Előfizetés', color: 'purple' }, { label: 'Közös költség', color: 'blue' }, { label: 'Egyéb', color: 'blue' },
  ].map(row => ({ ...row, amount: bills.filter(bill => row.label === 'Egyéb' ? !mainCategories.includes(bill.category) : bill.category === row.label).reduce((sum, bill) => sum + periodAmount(bill, period), 0) }))
  let position = 0
  const positiveTotal = rows.reduce((sum, row) => sum + Math.max(0, row.amount), 0)
  const colors = ['#22634f', '#d5ad52', '#9d88bb', '#70a5b4', '#d78a6b']
  const gradient = rows.map((row, index) => { const start = position; position += positiveTotal ? Math.max(0, row.amount) / positiveTotal * 100 : 0; return `${colors[index]} ${start}% ${position}%` }).join(', ')
  return <section className="spending-card"><div className="section-heading compact"><div><span className="section-kicker">KIADÁSOK MEGOSZLÁSA</span><h2>Hova megy a pénz?</h2></div></div><div className="spending-content"><div className="donut-wrap"><div className="donut" style={{ background: positiveTotal ? `conic-gradient(${gradient})` : 'var(--line)' }}><div className="donut-hole"><strong>{money(total)}</strong><span>összesen</span></div></div></div><div className="legend-list">{rows.map(row => <div className="legend-row" key={row.label}><span className={`legend-dot ${row.color}`} /><span>{row.label}</span><strong>{money(row.amount)}</strong></div>)}</div></div></section>
}

function SpendingTrend({ bills, offset }: { bills: Bill[]; offset: number }) {
  const months = Array.from({ length: 6 }, (_, index) => {
    const relative = offset - 5 + index
    const period = monthKey(relative)
    const date = new Date(new Date().getFullYear(), new Date().getMonth() + relative, 1)
    const amount = bills.filter(bill => appliesToPeriod(bill, period)).reduce((sum, bill) => {
      return sum + periodAmount(bill, period)
    }, 0)
    return { period, amount, label: new Intl.DateTimeFormat('hu-HU', { month: 'short' }).format(date).replace('.', '') }
  })
  const max = Math.max(...months.map(item => item.amount), 1)
  const current = months.at(-1)?.amount ?? 0
  const previous = months.at(-2)?.amount ?? 0
  const change = previous > 0 ? Math.round((current - previous) / previous * 100) : null
  return <section className="guide-card trend-card"><div className="guide-heading"><div><span className="section-kicker">HAVI ÖSSZEVETÉS</span><h2>Fizetési trend</h2></div><span className="guide-badge">6 hónap</span></div><p className="guide-description">A számláid havi összegének változása, az előzmények alapján.</p><div className="trend-summary"><div><span>Ebben a hónapban</span><strong>{money(current)}</strong></div><div className={change !== null && change > 0 ? 'trend-up' : change !== null && change < 0 ? 'trend-down' : ''}><span>Változás az előző hónaphoz</span><strong>{change === null ? '—' : `${change > 0 ? '+' : ''}${change}%`}</strong></div></div><div className="trend-chart" role="img" aria-label={`Hat havi kiadási trend: ${months.map(item => `${item.label} ${money(item.amount)}`).join(', ')}`}>
    {months.map(item => <div className={`trend-column ${item.period === monthKey(offset) ? 'current' : ''}`} key={item.period}><strong>{money(item.amount)}</strong><div className="trend-track"><i style={{ height: `${Math.max(8, item.amount / max * 100)}%` }} /></div><span>{item.label}</span></div>)}
  </div><div className="trend-caption"><span><i /> Becsült vagy számlázott összeg</span><strong>Alap: 0 lei · havi bontás</strong></div></section>
}

function BillChanges({ bills, onDetails }: { bills: Bill[]; onDetails: (id: string) => void }) {
  const changes = bills.flatMap(bill => {
    const entries = [...new Set(bill.history.filter(entry => entry.period <= monthKey() && entry.source !== 'adjustment').map(entry => entry.period))].sort((a, b) => b.localeCompare(a)).map(period => ({ period, amount: recordedAmount(bill, period) ?? 0 }))
    if (entries.length < 2) return []
    const [latest, previous] = entries
    return [{ bill, latest, previous, change: latest.amount - previous.amount, percent: previous.amount ? Math.round((latest.amount - previous.amount) / previous.amount * 100) : 0 }]
  }).sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent)).slice(0, 4)
  return <section className="guide-card changes-card"><div className="guide-heading"><div><span className="section-kicker">HISTÓRIA ALAPJÁN</span><h2>Mi változott a számláidban?</h2></div><span className="guide-badge">Legutóbbi adatok</span></div><p className="guide-description">Hasonlítsd össze a legutóbbi két rögzített összeget, és nézd meg, melyik tétel tért el a legjobban.</p>{changes.length ? <div className="bill-change-list">{changes.map(({ bill, latest, previous, change, percent }) => <article className="bill-change-row" key={bill.id}><span className={`bill-icon ${bill.color}`}><BillIcon type={bill.icon} /></span><div className="bill-change-copy"><strong>{bill.name}</strong><span>{formatPeriod(previous.period)} → {formatPeriod(latest.period)}</span></div><div className={`bill-change-value ${change > 0 ? 'increase' : change < 0 ? 'decrease' : ''}`}><strong>{change > 0 ? '+' : ''}{money(change)}</strong><span>{percent > 0 ? '+' : ''}{percent}%</span></div><button className="bill-change-open" onClick={() => onDetails(bill.id)} aria-label={`${bill.name} előzményeinek megnyitása`}><Icon name="ArrowRight" size={17} /></button></article>)}</div> : <div className="changes-empty"><span className="changes-empty-icon"><Icon name="Sparkles" size={18} /></span><div><strong>Még nincs összehasonlítható előzmény</strong><p>Rögzíts legalább két számlaadatot egy tételhez, és itt megjelenik az összeg változása.</p></div></div>}</section>
}

function SubscriptionOverview({ bills, onDetails }: { bills: Bill[]; onDetails: (id: string) => void }) {
  const subscriptions = bills.filter(bill => bill.category === 'Előfizetés' && bill.recurring !== 'Egyszeri').map(bill => ({ bill, monthly: (bill.plannedAmount ?? bill.amount) / (bill.recurring === 'Évente' ? 12 : 1) })).sort((a, b) => b.monthly - a.monthly)
  const annualTotal = subscriptions.reduce((sum, item) => sum + item.monthly * 12, 0)
  return <section className="guide-card subscription-card"><div className="guide-heading"><div><span className="section-kicker">ISMÉTLŐDŐ ELŐFIZETÉSEK</span><h2>Ennyibe kerülnek egy évben</h2></div><span className="guide-badge">{subscriptions.length} tétel</span></div><div className="subscription-total"><strong>{money(annualTotal)}</strong><span>becsült éves költség</span></div>{subscriptions.length ? <div className="subscription-list">{subscriptions.map(({ bill, monthly }) => <button className="subscription-row" key={bill.id} onClick={() => onDetails(bill.id)}><span className={`bill-icon ${bill.color}`}><BillIcon type={bill.icon} /></span><span><strong>{bill.name}</strong><small>{bill.provider}</small></span><b>{money(monthly)}<small>/ hó</small></b><Icon name="ChevronRight" size={16} /></button>)}</div> : <p className="guide-description">Az „Előfizetés” kategóriába sorolt rendszeres tételek itt jelennek meg.</p>}</section>
}

function PriceAlerts({ bills, onDetails }: { bills: Bill[]; onDetails: (id: string) => void }) {
  const alerts = bills.flatMap(bill => {
    const entries = [...new Set(bill.history.filter(item => item.period <= monthKey() && item.source !== 'adjustment').map(item => item.period))].sort((a, b) => b.localeCompare(a)).map(period => ({ period, amount: recordedAmount(bill, period) ?? 0 }))
    if (entries.length < 2 || entries[1].amount <= 0) return []
    const change = (entries[0].amount - entries[1].amount) / entries[1].amount
    return change >= 0.15 ? [{ bill, change, latest: entries[0].amount, previous: entries[1].amount }] : []
  }).sort((a, b) => b.change - a.change)
  if (!alerts.length) return null
  const alert = alerts[0]
  return <section className="price-alert-card"><span className="price-alert-icon"><Icon name="Bell" size={18} /></span><div><span className="section-kicker">SZÁMLAVÁLTOZÁS</span><strong>{alert.bill.name} összege {Math.round(alert.change * 100)}%-kal nőtt</strong><p>{money(alert.previous)} helyett most {money(alert.latest)}. Ellenőrizd a legutóbbi számla adatait.</p></div><button className="secondary-button" onClick={() => onDetails(alert.bill.id)}>Részletek <Icon name="ArrowRight" size={15} /></button></section>
}

function UpcomingWeek({ bills, onDetails }: { bills: Bill[]; onDetails: (id: string) => void }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const end = new Date(today); end.setDate(today.getDate() + 7)
  const due = bills.flatMap(bill => {
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), Math.min(bill.dueDay, new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()))
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, Math.min(bill.dueDay, new Date(today.getFullYear(), today.getMonth() + 2, 0).getDate()))
    const date = thisMonth >= today ? thisMonth : nextMonth
    const period = monthKey(date.getMonth() - today.getMonth() + (date.getFullYear() - today.getFullYear()) * 12)
    return date <= end && appliesToPeriod(bill, period) && !bill.paidPeriods.includes(period) ? [{ bill, date, amount: periodAmount(bill, period) }] : []
  }).sort((a, b) => a.date.getTime() - b.date.getTime())
  const total = due.reduce((sum, row) => sum + row.amount, 0)
  return <section className="guide-card week-card"><div className="guide-heading"><div><span className="section-kicker">KÖVETKEZŐ HÉT</span><h2>Amire érdemes készülni</h2></div><span className="guide-badge">7 nap</span></div><p className="guide-description">A következő hétre eső, még rendezetlen tételek.</p>{due.length ? <><div className="week-total"><span>Várhatóan esedékes</span><strong>{money(total)}</strong></div><div className="week-list">{due.map(({ bill, date, amount }) => <button key={bill.id} className="week-row" onClick={() => onDetails(bill.id)}><span className="week-date"><strong>{date.getDate()}</strong><small>{new Intl.DateTimeFormat('hu-HU', { month: 'short' }).format(date)}</small></span><span className="week-bill"><strong>{bill.name}</strong><small>{bill.provider}</small></span><b>{money(amount)}</b><Icon name="ChevronRight" size={16} /></button>)}</div></> : <div className="changes-empty"><span className="changes-empty-icon"><Icon name="Check" size={18} /></span><div><strong>Nincs esedékes számla a következő 7 napban</strong><p>Ha új tételt adsz hozzá, a határidő előtt itt fog megjelenni.</p></div></div>}</section>
}

function CashflowTimeline({ bills, cashPlan, projection, goalName, onDetails, onConfigure }: { bills: Bill[]; cashPlan: CashPlan; projection: ReturnType<typeof currentMonthProjection> | null; goalName: string; onDetails: (id: string) => void; onConfigure: () => void }) {
  const ready = cashPlan.balance !== null && cashPlan.income !== null && cashPlan.payday !== null
  if (!ready) return <section className="guide-card cashflow-card"><div className="guide-heading"><div><span className="section-kicker">PÉNZÁRAMLÁS</span><h2>Hogyan alakul a hónapod?</h2></div><span className="guide-badge">Előrejelzés</span></div><p className="guide-description">Add meg az egyenleged és a fizetésnapod, hogy lásd a várható pénzmozgásokat.</p><button className="primary-button" onClick={onConfigure}>Pénzügyi terv beállítása <Icon name="ArrowRight" size={15} /></button></section>
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const monthPeriod = monthKey()
  const events: { id: string; date: Date; name: string; amount: number; income: boolean; goal?: boolean; bill?: Bill }[] = []
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  if (projection?.income) events.push({ id: 'income', date: new Date(now.getFullYear(), now.getMonth(), Math.min(cashPlan.payday!, lastDay)), name: 'Rendszeres bevétel', amount: projection.income, income: true })
  if (projection?.reserve) events.push({ id: 'goal-reserve', date: new Date(now.getFullYear(), now.getMonth(), lastDay), name: `Havi félretétel · ${goalName}`, amount: projection.reserve, income: false, goal: true })
  bills.filter(bill => appliesToPeriod(bill, monthPeriod) && !bill.paidPeriods.includes(monthPeriod)).forEach(bill => events.push({ id: bill.id, date: new Date(now.getFullYear(), now.getMonth(), Math.min(bill.dueDay, lastDay)) < now ? new Date(now) : new Date(now.getFullYear(), now.getMonth(), Math.min(bill.dueDay, lastDay)), name: bill.name, amount: periodAmount(bill, monthPeriod), income: false, bill }))
  events.sort((a, b) => a.date.getTime() - b.date.getTime() || Number(b.income) - Number(a.income))
  let projected = cashPlan.balance!
  const rows = events.map(event => { projected += event.income ? event.amount : -event.amount; return { ...event, projected } })
  const chartDays = Array.from({ length: lastDay - now.getDate() + 1 }, (_, index) => now.getDate() + index)
  let runningBalance = cashPlan.balance!
  const points = chartDays.map(day => {
    const dayEvents = events.filter(event => event.date.getDate() === day)
    const income = dayEvents.filter(event => event.income).reduce((sum, event) => sum + event.amount, 0)
    const expense = dayEvents.filter(event => !event.income).reduce((sum, event) => sum + event.amount, 0)
    runningBalance += income - expense
    return { day, income, expense, balance: runningBalance }
  })
  const width = 720, height = 210, padX = 34, padY = 20
  const minBalance = Math.min(0, ...points.map(point => point.balance))
  const maxBalance = Math.max(1, ...points.map(point => point.balance))
  const balanceRange = Math.max(1, maxBalance - minBalance)
  const xFor = (index: number) => padX + (points.length <= 1 ? 0 : index * (width - 2 * padX) / (points.length - 1))
  const yFor = (balance: number) => padY + (maxBalance - balance) / balanceRange * (height - 2 * padY)
  const linePath = points.map((point, index) => `${index ? 'L' : 'M'} ${xFor(index)} ${yFor(point.balance)}`).join(' ')
  const rowsToShow = rows.slice(0, 8)
  return <section className="guide-card cashflow-card"><div className="guide-heading"><div><span className="section-kicker">PÉNZÁRAMLÁS-ELŐREJELZÉS</span><h2>Hogyan alakul a hónapod?</h2></div><span className="guide-badge">Hóvégi becslés</span></div><p className="guide-description">A megadott egyenlegből indulunk. Csak a még várható bevételt és a rendezetlen számlákat számoljuk hozzá.</p><div className="cashflow-start"><span>{cashPlan.balanceDate === localDateKey(now) ? 'Ma megadott egyenleg' : 'Becsült mai egyenleg'}</span><strong>{money(cashPlan.balance!)}</strong></div>{cashPlan.balanceDate && cashPlan.balanceDate !== localDateKey(now) && <p className="cashflow-stale-note">Az egyenleget utoljára {cashPlan.balanceDate} napon adtad meg. A becslés a nem rögzített vásárlásokat nem követi; érdemes frissíteni.</p>}{projection && <div className="cashflow-breakdown" aria-label="Hóvégi számítás részletei"><div><span>Mai egyenleg</span><strong>{money(projection.balance)}</strong></div><div><span>Még várható havi bevétel</span><strong>+{money(projection.income)}</strong></div><div><span>Rendezetlen számlák ({projection.unpaidCount})</span><strong>−{money(projection.unpaidBills)}</strong></div><div><span>Erre a hónapra tervezett félretétel</span><strong>−{money(projection.reserve)}</strong></div><div className="cashflow-breakdown-total"><span>Hó végére tervezett maradék</span><strong>{money(projection.afterSaving)}</strong></div></div>}
    {points.length > 0 && <div className="cashflow-chart-wrap"><div className="cashflow-chart-heading"><div><strong>Várható egyenleg a hónap végéig</strong><span>A szaggatott vonal a még hátralévő napokat jelöli</span></div><span className={`cashflow-chart-total ${runningBalance < 0 ? 'negative' : ''}`}>{money(runningBalance)}</span></div><div className="cashflow-chart" role="img" aria-label={`Az egyenleg a mai ${money(cashPlan.balance!)} összegről várhatóan ${money(runningBalance)} összegre változik a hónap végére`}><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="cashflowFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8eb58a" stopOpacity=".22"/><stop offset="100%" stopColor="#8eb58a" stopOpacity="0"/></linearGradient></defs>{[0, .5, 1].map(fraction => <line key={fraction} x1={padX} x2={width - padX} y1={padY + fraction * (height - 2 * padY)} y2={padY + fraction * (height - 2 * padY)} className="cashflow-gridline" />)}<path d={`${linePath} L ${xFor(points.length - 1)} ${height - padY} L ${xFor(0)} ${height - padY} Z`} fill="url(#cashflowFill)"/><path d={linePath} fill="none" stroke="#5f8964" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeDasharray="8 6" strokeLinecap="round" strokeLinejoin="round"/>{points.filter((_, index) => index === 0 || index === points.length - 1 || points[index].income || points[index].expense).map(point => { const index = points.indexOf(point); return <circle key={point.day} cx={xFor(index)} cy={yFor(point.balance)} r="4" className={`cashflow-point ${point.balance < 0 ? 'negative' : ''} ${point.income && point.expense ? 'mixed' : point.income ? 'income' : point.expense ? 'expense' : ''}`}><title>{`${point.day}. nap · ${money(point.balance)} egyenleg · +${money(point.income)} bevétel · −${money(point.expense)} kiadás`}</title></circle> })}<text x={padX} y={height - 2} className="cashflow-axis-label">{now.getDate()}.</text><text x={width / 2} y={height - 2} textAnchor="middle" className="cashflow-axis-label">{Math.round((now.getDate() + lastDay) / 2)}.</text><text x={width - padX} y={height - 2} textAnchor="end" className="cashflow-axis-label">{lastDay}.</text></svg></div><div className="cashflow-chart-legend"><span><i /> Várható egyenleg</span><span><i className="income-dot" /> Bevételes nap</span><span><i className="expense-dot" /> Kiadásos nap</span></div></div>}
    {rowsToShow.length ? <div className="cashflow-list">{rowsToShow.map(row => <button disabled={!row.bill} className={`cashflow-row ${row.income ? 'cashflow-income' : ''} ${row.goal ? 'cashflow-goal' : ''}`} key={row.id} onClick={() => row.bill && onDetails(row.bill.id)}><span className="cashflow-date">{new Intl.DateTimeFormat('hu-HU', { day: 'numeric', month: 'short' }).format(row.date)}</span><span className="cashflow-event"><strong>{row.name}</strong><small>{row.income ? 'Várható bevétel' : row.goal ? 'Tervezett havi félretétel a célra' : row.date.getTime() === now.getTime() && row.date.getDate() !== (row.bill?.dueDay ?? row.date.getDate()) ? 'Lejárt esedékesség' : 'Várható kiadás'}</small></span><b>{row.income ? '+' : '−'}{money(row.amount)}</b><span className="cashflow-balance">{money(row.projected)}</span></button>)}</div> : <div className="changes-empty"><span className="changes-empty-icon"><Icon name="Check" size={18} /></span><div><strong>Nincs további ismert pénzmozgás ebben a hónapban</strong><p>A terv a megadott adatok alapján készül, nem kapcsolódik bankszámládhoz.</p></div></div>}<div className="cashflow-footnote">A félretétel csak terv, nem banki tranzakció. A ténylegesen félretett pénzt a cél „Már félretett összeg” mezőjében rögzítsd; a kifizetett számlákat jelöld rendezettnek.</div></section>
}

function PageFooter() {
  return <footer className="page-footer"><span><Icon name="ShieldCheck" size={14} /> Az adataid csak a tiéid.</span><span>Egyszerű tervezés, nyugodtabb hónapok.</span></footer>
}

function CalendarPage({ bills, month, monthInfo, monthOffset, setMonthOffset, onDetails, onToggle, isPaid }: {
  bills: Bill[]; month: string; monthInfo: { year: number; monthIndex: number; days: number; offset: number }
  monthOffset: number; setMonthOffset: Dispatch<SetStateAction<number>>; onDetails: (id: string) => void; onToggle: (id: string) => void; isPaid: (bill: Bill) => boolean
}) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  useEffect(() => setSelectedDay(null), [monthOffset])
  const period = monthKey(monthOffset)
  const billsByDay = new Map<number, Bill[]>()
  for (const bill of bills) {
    const day = Math.min(bill.dueDay, monthInfo.days)
    billsByDay.set(day, [...(billsByDay.get(day) ?? []), bill])
  }
  const visibleBills = [...(selectedDay === null ? bills : billsByDay.get(selectedDay) ?? [])].sort((a, b) => a.dueDay - b.dueDay || a.name.localeCompare(b.name, 'hu'))
  const unpaidBills = bills.filter(bill => !isPaid(bill))
  const paidCount = bills.length - unpaidBills.length
  const unpaidAmount = unpaidBills.reduce((sum, bill) => sum + periodAmount(bill, period), 0)
  const today = new Date()
  const isCurrentMonth = period === monthKey()
  return <section className="page-content calendar-page">
    <div className="welcome-row calendar-welcome"><div><div className="eyebrow">HATÁRIDŐK ÁTTEKINTÉSE</div><h1>Naptár</h1><p className="subtitle">Egy pillantással látod, mikor melyik számla esedékes.</p></div><MonthSelector month={month} previous={() => setMonthOffset(value => value - 1)} next={() => setMonthOffset(value => value + 1)} /></div>
    <div className="calendar-overview" aria-label="Havi összesítés"><div><span>Havi számlák</span><strong>{bills.length} <small>tétel</small></strong></div><div><span>Még rendezendő</span><strong>{money(unpaidAmount)}</strong><small>{unpaidBills.length} számla</small></div><div><span>Rendezve</span><strong>{paidCount} <small>tétel</small></strong></div></div>
    <div className="calendar-card"><div className="calendar-card-head"><div className="calendar-head-icon"><Icon name="CalendarDays" size={21}/></div><div><span className="section-kicker">HAVI NÉZET</span><h2>{month}</h2><p>Koppints egy napra a részletekhez.</p></div><div className="calendar-key"><span><i className="calendar-key-dot pending"/> Rendezendő</span><span><i className="calendar-key-dot complete"/> Rendezve</span></div></div>
      <div className="calendar-days">{['H', 'K', 'Sz', 'Cs', 'P', 'Szo', 'V'].map((day, index) => <span className="day-label" key={day} aria-label={['Hétfő','Kedd','Szerda','Csütörtök','Péntek','Szombat','Vasárnap'][index]}>{day}</span>)}{Array.from({ length: monthInfo.offset }, (_, index) => <span className="calendar-spacer" key={`space-${index}`} aria-hidden="true"/>)}{Array.from({ length: monthInfo.days }, (_, index) => {
        const day = index + 1
        const entries = billsByDay.get(day) ?? []
        const pending = entries.filter(bill => !isPaid(bill))
        const ordered = [...pending, ...entries.filter(isPaid)]
        const dayLabel = `${month} ${day}. nap${entries.length ? `: ${entries.map(bill => `${bill.name} (${isPaid(bill) ? 'rendezve' : 'rendezendő'})`).join(', ')}` : ', nincs esedékes számla'}`
        return <button key={day} type="button" aria-label={dayLabel} aria-pressed={selectedDay === day} className={`calendar-day ${isCurrentMonth && day === today.getDate() ? 'today' : ''} ${entries.length ? 'has-bill' : ''} ${pending.length ? 'has-pending' : ''} ${selectedDay === day ? 'selected-day' : ''}`} onClick={() => setSelectedDay(value => value === day ? null : day)}><span className="calendar-day-number">{day}</span>{entries.length > 1 && <span className="calendar-mobile-count" aria-hidden="true">{entries.length}</span>}{entries.length > 0 && <span className="calendar-day-icons" aria-hidden="true">{ordered.slice(0, 2).map(bill => <span className={`calendar-mini-icon ${isPaid(bill) ? 'is-complete' : ''}`} key={bill.id}><BillIcon type={bill.icon}/></span>)}{entries.length > 2 && <span className="calendar-more">+{entries.length - 2}</span>}</span>}</button>
      })}</div><div className="calendar-hint"><Icon name="CalendarDays" size={16}/><span>Az ikonok a számlák típusát mutatják. A hónap végére eső 29–31. napi tételek rövidebb hónapban az utolsó napon jelennek meg.</span></div></div>
    <div className="section-heading calendar-list-heading"><div><span className="section-kicker">{selectedDay ? `${month} ${selectedDay}.` : 'TELJES HÓNAP'}</span><h2>{selectedDay ? 'Ezen a napon' : 'Havi esedékességek'} <span className="heading-count">{visibleBills.length}</span></h2></div>{selectedDay && <button className="text-link" onClick={() => setSelectedDay(null)}>Egész hónap mutatása</button>}</div><div className="bill-list">{visibleBills.map(bill => <BillRow key={bill.id} bill={bill} period={period} paid={isPaid(bill)} onPay={() => onToggle(bill.id)} onDetails={() => onDetails(bill.id)}/>)}{!visibleBills.length && <div className="empty-state">{selectedDay ? 'Erre a napra nincs esedékes számla.' : 'Ebben a hónapban nincs esedékes számla.'}</div>}</div><PageFooter/>
  </section>
}

export default App
