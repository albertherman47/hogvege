import type { Bill } from './data'
import { appliesToPeriod } from './data.ts'

export function currentPeriod() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function dueDate(bill: Bill, period: string) {
  const [year, month] = period.split('-').map(Number)
  return new Date(year, month - 1, Math.min(bill.dueDay, new Date(year, month, 0).getDate()))
}

/** Actual monthly totals replace estimates; corrections do not train the forecast. */
export function forecast(bill: Bill, period = currentPeriod()) {
  const periods = [...new Set(bill.history.filter(item => item.source !== 'adjustment' && item.period <= period).map(item => item.period))].sort((a, b) => b.localeCompare(a)).slice(0, 3)
  const amounts = periods.map(month => {
    const entries = bill.history.filter(item => item.period === month && item.source !== 'adjustment')
    const actual = entries.filter(item => item.source === 'actual')
    return (actual.length ? actual : entries).reduce((sum, item) => sum + item.amount, 0)
  })
  const amount = bill.plannedAmount ?? (amounts.length ? Math.round(amounts.reduce((sum, value) => sum + value, 0) / amounts.length * 100) / 100 : bill.amount)
  return { amount, low: amounts.length ? Math.min(...amounts) : amount, high: amounts.length ? Math.max(...amounts) : amount, count: amounts.length }
}

/** Actual invoices replace estimates for a period; adjustments are additive. */
export function periodAmount(bill: Bill, period: string) {
  const entries = bill.history.filter(item => item.period === period)
  const actual = entries.filter(item => item.source === 'actual')
  const estimated = entries.filter(item => item.source === 'estimated')
  const base = actual.length ? actual : estimated
  const amount = base.length ? base.reduce((sum, item) => sum + item.amount, 0) : forecast(bill, period).amount
  return Math.round((amount + entries.filter(item => item.source === 'adjustment').reduce((sum, item) => sum + item.amount, 0)) * 100) / 100
}

export function recordedAmount(bill: Bill, period: string): number | null {
  const entries = bill.history.filter(item => item.period === period)
  if (!entries.length) return null
  const actual = entries.filter(item => item.source === 'actual')
  const base = actual.length ? actual : entries.filter(item => item.source === 'estimated')
  return Math.round([...base, ...entries.filter(item => item.source === 'adjustment')].reduce((sum, item) => sum + item.amount, 0) * 100) / 100
}

/** Income arriving today is added only when the entered balance predates today. */
export function currentMonthProjection(
  plan: { balance: number; income: number; payday: number; balanceDate?: string },
  bills: Bill[],
  goal: { target: number; saved: number; deadline: string },
  today: Date,
) {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const period = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`
  const payday = new Date(day.getFullYear(), day.getMonth(), Math.min(plan.payday, new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate()))
  const income = payday > day || (payday.getTime() === day.getTime() && !!plan.balanceDate && plan.balanceDate < `${period}-${String(day.getDate()).padStart(2, '0')}`) ? plan.income : 0
  const unpaid = bills.filter(bill => appliesToPeriod(bill, period) && !bill.paidPeriods.includes(period))
  const unpaidBills = Math.round(unpaid.reduce((sum, bill) => sum + periodAmount(bill, period), 0) * 100) / 100
  const beforeSaving = Math.round((plan.balance + income - unpaidBills) * 100) / 100
  const remainingGoal = Math.max(0, goal.target - goal.saved)
  const deadlineMonths = goal.deadline ? Math.max(1, (Number(goal.deadline.slice(0, 4)) - day.getFullYear()) * 12 + Number(goal.deadline.slice(5, 7)) - day.getMonth()) : 1
  const monthlyGoal = Math.ceil(remainingGoal / deadlineMonths * 100) / 100
  const reserve = Math.min(monthlyGoal, Math.max(0, beforeSaving))
  return { balance: plan.balance, income, unpaidBills, unpaidCount: unpaid.length, beforeSaving, reserve, afterSaving: Math.round((beforeSaving - reserve) * 100) / 100 }
}

/** Rolls the entered starting balance forward using recurring income and bills. */
export function rolledCashBalance(
  plan: { balance: number | null; income: number | null; payday: number | null; balanceDate?: string },
  bills: Bill[],
  throughDate: Date,
) {
  if (plan.balance === null || plan.income === null || plan.payday === null) return null
  const through = new Date(throughDate.getFullYear(), throughDate.getMonth(), throughDate.getDate())
  const baseDate = plan.balanceDate
    ? (() => { const [year, month, day] = plan.balanceDate!.split('-').map(Number); return new Date(year, month - 1, day) })()
    : through
  let balance = plan.balance
  let month = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1)
  const targetPeriod = `${through.getFullYear()}-${String(through.getMonth() + 1).padStart(2, '0')}`

  while (month <= through) {
    const period = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    const payday = new Date(month.getFullYear(), month.getMonth(), Math.min(plan.payday, lastDay))
    if (payday > baseDate && payday < through) balance += plan.income

    for (const bill of bills) {
      if (!appliesToPeriod(bill, period)) continue
      const due = dueDate(bill, period)
      const baselineOverdue = period === `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}` && due <= baseDate && !bill.paidPeriods.includes(period)
      const chargeDate = baselineOverdue && period < targetPeriod ? new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + 1) : due
      const isPastPeriod = period < targetPeriod
      const alreadyPaidInCurrentPeriod = period === targetPeriod && bill.paidPeriods.includes(period)
      const paidAhead = alreadyPaidInCurrentPeriod && due >= through && due > baseDate
      if ((chargeDate > baseDate && chargeDate < through && (isPastPeriod || alreadyPaidInCurrentPeriod)) || paidAhead) {
        balance -= periodAmount(bill, period)
      }
    }

    month = new Date(month.getFullYear(), month.getMonth() + 1, 1)
  }
  return Math.round(balance * 100) / 100
}
