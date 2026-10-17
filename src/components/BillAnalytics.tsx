import { useState } from 'react'
import type { Bill } from '../data'
import { recordedAmount } from '../finance'
const money = (value: number) => `${new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 }).format(value)} lei`

type AnalyticsMode = 'month' | 'quarter' | 'year'
const analyticsColors = ['#244b37', '#5b8296', '#d4a27e']

function analyticsBuckets(mode: AnalyticsMode, offset: number) {
  const now = new Date()
  const count = mode === 'month' ? 6 : 4
  return Array.from({ length: count }, (_, index) => {
    const distance = offset + count - 1 - index
    const start = mode === 'month'
      ? new Date(now.getFullYear(), now.getMonth() - distance, 1)
      : mode === 'quarter'
        ? new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 - distance * 3, 1)
        : new Date(now.getFullYear() - distance, 0, 1)
    const end = mode === 'month'
      ? new Date(start.getFullYear(), start.getMonth() + 1, 1)
      : mode === 'quarter'
        ? new Date(start.getFullYear(), start.getMonth() + 3, 1)
        : new Date(start.getFullYear() + 1, 0, 1)
    const label = mode === 'month'
      ? new Intl.DateTimeFormat('hu-HU', { month: 'short' }).format(start)
      : mode === 'quarter'
        ? `${Math.floor(start.getMonth() / 3) + 1}. n.é. ${String(start.getFullYear()).slice(-2)}`
        : String(start.getFullYear())
    return { start, end, label, key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}` }
  })
}

export function BillAnalytics({ bills, onDetails }: { bills: Bill[]; onDetails: (id: string) => void }) {
  const [mode, setMode] = useState<AnalyticsMode>('month')
  const [offset, setOffset] = useState(0)
  const [category, setCategory] = useState('Összes kategória')
  const categories = [...new Set(bills.map(bill => bill.category))].sort((a, b) => a.localeCompare(b, 'hu'))
  const buckets = analyticsBuckets(mode, offset)
  const amountInBucket = (bill: Bill, bucket: { start: Date; end: Date }) => [...new Set(bill.history.map(invoice => invoice.period))].filter(period => {
    const date = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1)
    return date >= bucket.start && date < bucket.end
  }).reduce((sum, period) => sum + (recordedAmount(bill, period) ?? 0), 0)
  const categoryAmounts = buckets.map(bucket => categories.map(name => ({ name, amount: bills.filter(bill => bill.category === name).reduce((sum, bill) => sum + amountInBucket(bill, bucket), 0) })))
  const totals = categoryAmounts.map(rows => rows.reduce((sum, row) => sum + row.amount, 0))
  const selectedAmounts = categoryAmounts.map(rows => category === 'Összes kategória' ? rows.reduce((sum, row) => sum + row.amount, 0) : rows.find(row => row.name === category)?.amount ?? 0)
  const current = selectedAmounts.at(-1) ?? 0
  const previous = selectedAmounts.at(-2) ?? 0
  const difference = current - previous
  const changePercent = previous > 0 ? Math.round(difference / previous * 100) : null
  const average = Math.round(selectedAmounts.filter(amount => amount > 0).reduce((sum, amount) => sum + amount, 0) / Math.max(1, selectedAmounts.filter(amount => amount > 0).length))
  const maxTotal = Math.max(1, ...(category === 'Összes kategória' ? totals : selectedAmounts))
  const contributors = bills.map(bill => ({ bill, amount: amountInBucket(bill, buckets.at(-1)!) })).filter(item => (category === 'Összes kategória' || item.bill.category === category) && item.amount > 0).sort((a, b) => b.amount - a.amount)
  const amountLabel = mode === 'month' ? 'hónap' : mode === 'quarter' ? 'negyedév' : 'év'

  return <section className="bill-analytics" aria-labelledby="bill-analytics-title">
    <div className="bill-analytics-head"><div><span className="section-kicker">KÖLTSÉGELEMZÉS</span><h2 id="bill-analytics-title">Lásd, mire megy el a pénz</h2><p>Kategóriánként hasonlítsd össze a rögzített számláidat.</p></div><div className="analytics-period-controls"><div className="analytics-mode" role="group" aria-label="Összehasonlítás időegysége">{([['month', 'Havi'], ['quarter', 'Negyedéves'], ['year', 'Éves']] as const).map(([value, label]) => <button key={value} className={mode === value ? 'active' : ''} aria-pressed={mode === value} onClick={() => { setMode(value); setOffset(0) }}>{label}</button>)}</div><div className="analytics-stepper"><button aria-label={`Korábbi ${amountLabel}`} onClick={() => setOffset(value => value + 1)}>‹</button><span>{offset ? `${offset} ${amountLabel} vissza` : 'Mostani időszakig'}</span><button aria-label={`Későbbi ${amountLabel}`} disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 1))}>›</button></div></div></div>
    <div className="analytics-category-strip"><button className={`analytics-category-chip ${category === 'Összes kategória' ? 'selected' : ''}`} onClick={() => setCategory('Összes kategória')} aria-pressed={category === 'Összes kategória'}><span className="analytics-chip-dot all-dot"/><span>Összes kategória</span><strong>{money(totals.at(-1) ?? 0)}</strong></button>{categories.map((name, index) => <button key={name} className={`analytics-category-chip ${category === name ? 'selected' : ''}`} onClick={() => setCategory(name)} aria-pressed={category === name}><span className="analytics-chip-dot" style={{ background: analyticsColors[index % analyticsColors.length] }}/><span>{name}</span><strong>{money(categoryAmounts.at(-1)?.[index]?.amount ?? 0)}</strong></button>)}</div>
    <div className="analytics-main-grid"><section className="analytics-chart-card"><div className="analytics-chart-title"><div><span className="section-kicker">{category.toLocaleUpperCase('hu-HU')} · {mode === 'month' ? '6 HÓNAP' : mode === 'quarter' ? '4 NEGYEDÉV' : '4 ÉV'}</span><h3>{category === 'Összes kategória' ? 'Kiadások alakulása' : `${category} alakulása`}</h3></div><span className={`analytics-change ${difference > 0 ? 'up' : difference < 0 ? 'down' : ''}`}>{changePercent === null ? 'Nincs előző adat' : `${difference > 0 ? '+' : ''}${changePercent}%`}<small>előző időszakhoz</small></span></div>
      <div className="analytics-chart" role="img" aria-label={`${category}: ${buckets.map((bucket, index) => `${bucket.label}: ${money(selectedAmounts[index])}`).join(', ')}`}><div className="analytics-chart-guides"><i/><i/><i/></div><div className="analytics-columns">{buckets.map((bucket, bucketIndex) => <div className="analytics-column" key={bucket.key}><strong>{money(selectedAmounts[bucketIndex])}</strong><div className="analytics-column-track">{category === 'Összes kategória' ? categoryAmounts[bucketIndex].map((row, rowIndex) => row.amount > 0 && <i key={row.name} title={`${row.name}: ${money(row.amount)}`} style={{ height: `${row.amount / maxTotal * 100}%`, background: analyticsColors[rowIndex % analyticsColors.length] }}/>) : <i className="analytics-single-bar" title={`${bucket.label}: ${category} · ${money(selectedAmounts[bucketIndex])}`} style={{ height: `${selectedAmounts[bucketIndex] / maxTotal * 100}%`, background: analyticsColors[Math.max(0, categories.indexOf(category)) % analyticsColors.length] }}/>}</div><span>{bucket.label}</span></div>)}</div></div>
      <div className="analytics-chart-legend">{category === 'Összes kategória' ? categories.map((name, index) => <button key={name} onClick={() => setCategory(name)}><i style={{ background: analyticsColors[index % analyticsColors.length] }}/>{name}</button>) : <span><i style={{ background: analyticsColors[Math.max(0, categories.indexOf(category)) % analyticsColors.length] }}/>{category}</span>}<small>Az oszlop fölé húzva a kategóriaösszeg látszik.</small></div>
    </section><aside className="analytics-summary"><span className="section-kicker">{buckets.at(-1)?.label.toLocaleUpperCase('hu-HU')} · AKTUÁLIS</span><span className="analytics-summary-label">Számlatörténet összege</span><strong>{money(current)}</strong><div className={`analytics-compare ${changePercent !== null && difference > 0 ? 'up' : changePercent !== null && difference < 0 ? 'down' : ''}`}><span>{changePercent === null ? 'Nincs előző időszaki adat' : difference > 0 ? 'Több kiadás' : difference < 0 ? 'Kevesebb kiadás' : 'Változatlan'}</span><b>{changePercent === null ? '—' : `${difference > 0 ? '+' : difference < 0 ? '−' : ''}${money(Math.abs(difference))}`}</b></div><div className="analytics-summary-divider"/><div className="analytics-mini-stat"><span>{amountLabel[0].toLocaleUpperCase('hu-HU') + amountLabel.slice(1)}i átlag a grafikonon</span><strong>{money(average)}</strong></div><div className="analytics-mini-stat"><span>Legnagyobb tétel</span><strong>{contributors[0]?.bill.name ?? 'Nincs rögzített adat'}</strong><small>{contributors[0] ? money(contributors[0].amount) : ''}</small></div><p>A tényleges számla felülírja a havi becslést; a korrekciókat hozzáadjuk. A próbaadatok becslések.</p></aside></div>
    <div className="analytics-contributors"><div className="analytics-contributors-head"><div><span className="section-kicker">TÉTELES BONTÁS</span><h3>{category === 'Összes kategória' ? 'Kategóriák és számlák' : category}</h3></div><span>{buckets.at(-1)?.label} · {money(current)}</span></div>{contributors.length ? <div className="analytics-contributor-list">{(category === 'Összes kategória' ? categories.map((name, index) => ({ name, index, amount: categoryAmounts.at(-1)?.[index]?.amount ?? 0 })).filter(item => item.amount > 0).sort((a, b) => b.amount - a.amount).map(item => ({ key: item.name, title: item.name, subtitle: `${bills.filter(bill => bill.category === item.name).length} tétel`, amount: item.amount, color: analyticsColors[item.index % analyticsColors.length], choose: () => setCategory(item.name) })) : contributors.map(({ bill, amount }) => ({ key: bill.id, title: bill.name, subtitle: bill.provider || bill.category, amount, color: analyticsColors[Math.max(0, categories.indexOf(bill.category)) % analyticsColors.length], choose: () => onDetails(bill.id) }))).map(item => <button key={item.key} onClick={item.choose}><span className="analytics-contributor-dot" style={{ background: item.color }}/><span className="analytics-contributor-copy"><strong>{item.title}</strong><small>{item.subtitle}</small></span><span className="analytics-contributor-bar"><i style={{ width: `${Math.max(4, item.amount / Math.max(1, current) * 100)}%`, background: item.color }}/></span><b>{money(item.amount)}</b></button>)}</div> : <div className="analytics-empty">Ehhez az időszakhoz még nincs számlatörténet. Válassz korábbi időszakot, vagy rögzíts számlát.</div>}</div>
  </section>
}
