import test from 'node:test'
import assert from 'node:assert/strict'
import { appliesToPeriod, createBackup, createPlannedBill, parseBackup, recordActualInvoice } from '../src/data.ts'
import { dueDate, forecast, periodAmount, recordedAmount, rolledCashBalance, currentMonthProjection } from '../src/finance.ts'

const monthly = {
  id: 'electricity', name: 'Villany', category: 'Közüzem', provider: 'Szolgáltató',
  amount: 180, plannedAmount: 180, dueDay: 31, startPeriod: '2026-01',
  color: 'green', icon: 'electricity', recurring: 'Havonta', paidPeriods: [], history: [],
}

test('a household plan includes monthly, annual and one-off costs only when due', () => {
  const insurance = { ...monthly, id: 'insurance', amount: 600, plannedAmount: 600, recurring: 'Évente', startPeriod: '2026-02' }
  const schoolTrip = { ...monthly, id: 'trip', amount: 120, plannedAmount: 120, recurring: 'Egyszeri', startPeriod: '2026-02' }
  const bills = [monthly, insurance, schoolTrip]
  const total = period => bills.filter(bill => appliesToPeriod(bill, period)).reduce((sum, bill) => sum + periodAmount(bill, period), 0)

  assert.equal(total('2026-01'), 180)
  assert.equal(total('2026-02'), 900)
  assert.equal(total('2026-03'), 180)
  assert.equal(total('2027-02'), 780)
})

test('a real invoice overrides the plan while a credit lowers only that month', () => {
  const bill = { ...monthly, history: [
    { id: 'estimate', period: '2026-09', source: 'estimated', amount: 170 },
    { id: 'actual', period: '2026-09', source: 'actual', amount: 200 },
    { id: 'credit', period: '2026-09', source: 'adjustment', amount: -30 },
  ] }

  assert.equal(periodAmount(bill, '2026-09'), 170)
  assert.equal(recordedAmount(bill, '2026-09'), 170)
  assert.equal(periodAmount(bill, '2026-10'), 180)
  assert.equal(forecast({ ...bill, plannedAmount: undefined }, '2026-10').amount, 200)
})

test('a 31st-day salary and bill both land on February 28', () => {
  const plan = { balance: 1000, income: 2000, payday: 31, balanceDate: '2026-02-01' }
  assert.equal(dueDate(monthly, '2026-02').getDate(), 28)
  assert.equal(rolledCashBalance(plan, [monthly], new Date(2026, 2, 1)), 2820)
})

test('future monthly costs do not reduce a freshly entered current balance', () => {
  const plan = { balance: 1000, income: 2000, payday: 20, balanceDate: '2026-10-10' }
  assert.equal(rolledCashBalance(plan, [monthly], new Date(2026, 9, 15)), 1000)
})

test('cash planning stays unavailable until all three inputs are present', () => {
  assert.equal(rolledCashBalance({ balance: 1000, income: null, payday: 5 }, [monthly], new Date(2026, 9, 15)), null)
})

test('salary due today is still upcoming from an earlier entered balance', () => {
  const plan = { balance: 1000, income: 2000, payday: 15, balanceDate: '2026-10-01' }
  assert.equal(rolledCashBalance(plan, [], new Date(2026, 9, 15)), 1000)
  assert.equal(rolledCashBalance(plan, [], new Date(2026, 9, 16)), 3000)
})

test('a bill paid ahead is charged once while rolling the entered balance forward', () => {
  const plan = { balance: 1000, income: 1, payday: 31, balanceDate: '2026-10-01' }
  const paidBill = { ...monthly, dueDay: 20, paidPeriods: ['2026-10'] }
  assert.equal(rolledCashBalance(plan, [paidBill], new Date(2026, 9, 15)), 820)
  assert.equal(rolledCashBalance(plan, [paidBill], new Date(2026, 9, 25)), 820)
})

test('a savings goal is not treated as a transfer out of the entered bank balance', () => {
  const balance = rolledCashBalance({ balance: 1000, income: 2000, payday: 5, balanceDate: '2026-01-01' }, [monthly], new Date(2026, 2, 1))
  const projection = currentMonthProjection({ balance, income: 2000, payday: 5 }, [monthly], { target: 3500, saved: 0, deadline: '2026-12' }, new Date(2026, 2, 1))
  assert.equal(balance, 4640)
  assert.equal(projection.balance, 4640)
})

test('quick planning creates a recurring estimate without inventing a paid invoice', () => {
  const bill = createPlannedBill({ name: '  Villany  ', amount: 180, dueDay: 15, startPeriod: '2026-10' })
  assert.equal(bill.name, 'Villany')
  assert.equal(bill.recurring, 'Havonta')
  assert.deepEqual(bill.history, [])
  assert.deepEqual(bill.paidPeriods, [])
  assert.equal(periodAmount(bill, '2026-10'), 180)
  assert.equal(periodAmount(bill, '2026-11'), 180)
  assert.throws(() => createPlannedBill({ name: ' ', amount: 180, dueDay: 15, startPeriod: '2026-10' }))
  assert.throws(() => createPlannedBill({ name: 'Villany', amount: 180, dueDay: 32, startPeriod: '2026-10' }))
})

test('entering an arrived bill replaces that month’s estimate without marking it paid', () => {
  const planned = createPlannedBill({ name: 'Villany', amount: 180, dueDay: 25, startPeriod: '2026-10' })
  const received = recordActualInvoice(planned, '2026-10', 225, 'invoice-1')
  assert.equal(periodAmount(received, '2026-10'), 225)
  assert.equal(periodAmount(received, '2026-11'), 180)
  assert.deepEqual(received.paidPeriods, [])
  assert.equal(received.plannedAmount, 180)
  const corrected = recordActualInvoice(received, '2026-10', 232, 'invoice-2')
  assert.equal(corrected.history.length, 1)
  assert.equal(corrected.history[0].id, 'invoice-1')
  assert.equal(periodAmount(corrected, '2026-10'), 232)
  assert.throws(() => recordActualInvoice(planned, '2026-10', 0, 'bad'))
})

test('a downloaded household backup preserves payment marks and rejects broken bill data', () => {
  const bills = [{ ...monthly, paidPeriods: ['2026-10'], history: [{ id: 'oct', period: '2026-10', source: 'actual', amount: 190 }] }]
  const backup = createBackup(bills, {
    cashPlan: { balance: 2400, income: 5000, payday: 5, balanceDate: '2026-10-17' },
    savingsGoal: { name: 'Iskolakezdés', target: 1200, saved: 300, deadline: '2027-08' },
  })

  assert.deepEqual(parseBackup(JSON.stringify(backup), '2026-10'), bills)
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, bills: [{ ...bills[0], dueDay: 0 }] }), '2026-10'))
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, bills: [{ ...bills[0], history: [bills[0].history[0], bills[0].history[0]] }] }), '2026-10'))
})
