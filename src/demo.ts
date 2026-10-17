import type { Bill, Invoice } from './data'

export function markPastBenchmarkPeriodsPaid(bills: Bill[], currentPeriod: string): Bill[] {
  return bills.map(bill => {
    const pastPeriods = bill.history
      .filter(invoice => invoice.id.startsWith('ro-benchmark-') && invoice.period <= currentPeriod)
      .map(invoice => invoice.period)
    if (!pastPeriods.length) return bill
    const paidPeriods = new Set([...bill.paidPeriods, ...pastPeriods])
    return paidPeriods.size === bill.paidPeriods.length ? bill : { ...bill, paidPeriods: [...paidPeriods] }
  })
}

const benchmarkPeriods = Array.from({ length: 22 }, (_, index) => {
  const date = new Date(2025, index, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
})
const currentDate = new Date()
const currentPeriod = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`
const paidBenchmarkPeriods = benchmarkPeriods.filter(period => period <= currentPeriod)
function benchmarkHistory(id: string, amounts: number[]): Invoice[] {
  return benchmarkPeriods.map((period, index) => ({ id: `ro-benchmark-${id}-${period}`, period, amount: amounts[index], source: 'estimated' }))
}

// Romániai nyilvános tarifa- és piaci adatokból képzett, háztartási használatot modellező próbasorok.
const gasKwh = [1800, 1600, 1300, 800, 400, 200, 150, 150, 250, 600, 1200, 1700, 1750, 1500, 1200, 750, 350, 180, 130, 130, 220, 550]
const waterRates = [11.186, 11.186, 11.186, 11.186, 11.186, 11.186, 10.8, 10.8, 10.8, 10.8, 10.8, 10.8, 10.8, 10.8, 10.8, 10.8, 10.8, 10.8, 10.8, 10.8, 12.19, 12.19]
const fuelPrices = [7.28, 7.39, 7.30, 7.35, 7.30, 7.45, 7.39, 7.26, 7.18, 7.31, 7.23, 7.28, 7.28, 7.39, 9.18, 8.79, 9.15, 8.96, 8.82, 9.51, 9.89, 10.12]
export const initialBills: Bill[] = [
  { id: 'gas', name: 'Földgáz · Bukarest', category: 'Közüzem', provider: 'Háztartási referencia · fogyasztás × 0,31 lei/kWh', amount: Math.round(gasKwh[21] * 0.31), dueDay: 12, startPeriod: benchmarkPeriods[0], color: 'orange', icon: 'gas', recurring: 'Havonta', paidPeriods: [...paidBenchmarkPeriods], history: benchmarkHistory('gas', gasKwh.map(kwh => Math.round(kwh * 0.31))) },
  { id: 'water', name: 'Víz és csatorna · Bukarest', category: 'Közüzem', provider: 'Apa Nova · 6 m³/hó referenciafogyasztás', amount: 73, dueDay: 17, startPeriod: benchmarkPeriods[0], color: 'blue', icon: 'water', recurring: 'Havonta', paidPeriods: [...paidBenchmarkPeriods], history: benchmarkHistory('water', waterRates.map(rate => Math.round(rate * 6))) },
  { id: 'mobile', name: 'Mobiltelefon-előfizetés', category: 'Előfizetés', provider: 'DIGI Optim 2 · 1 előfizetés', amount: 10, dueDay: 21, startPeriod: benchmarkPeriods[0], color: 'purple', icon: 'mobile', recurring: 'Havonta', paidPeriods: [...paidBenchmarkPeriods], history: benchmarkHistory('mobile', Array(22).fill(10)) },
  { id: 'fuel', name: 'Üzemanyag · benzin 95', category: 'Közlekedés', provider: 'Országos havi ár × 40 liter', amount: Math.round(fuelPrices[21] * 40), dueDay: 25, startPeriod: benchmarkPeriods[0], color: 'yellow', icon: 'parking', recurring: 'Havonta', paidPeriods: [...paidBenchmarkPeriods], history: benchmarkHistory('fuel', fuelPrices.map(price => Math.round(price * 40))) },
  { id: 'rent', name: 'Lakbér · Bukarest, 2 szobás', category: 'Lakhatás', provider: 'Városi átlagár, EUR→RON kb. 5:1', amount: 2670, dueDay: 1, startPeriod: benchmarkPeriods[0], color: 'green', icon: 'rent', recurring: 'Havonta', paidPeriods: [...paidBenchmarkPeriods], history: benchmarkHistory('rent', [2780,2780,2780,2780,2780,2780,2780,2780,2780,2780,2780,2670,2670,2670,2670,2670,2670,2670,2670,2670,2670,2670]) },
]
