import test from 'node:test'
import assert from 'node:assert/strict'
import { forecast, periodAmount, dueDate, recordedAmount, rolledCashBalance, currentMonthProjection } from '../src/finance.ts'
const bill = { id: 'power', name: 'Villany', amount: 900, dueDay: 31, history: [
  { id: '1', period: '2026-01', source: 'actual', amount: 100 },
  { id: '2', period: '2026-02', source: 'estimated', amount: 180 },
  { id: '3', period: '2026-02', source: 'actual', amount: 200 },
  { id: '4', period: '2026-03', source: 'actual', amount: 300 },
  { id: '5', period: '2026-03', source: 'adjustment', amount: 25 },
  { id: '6', period: '2026-12', source: 'actual', amount: 900 },
] }
test('historical forecasts exclude future periods and count each month once', () => {
  assert.equal(forecast(bill, '2026-03').amount, 200)
  assert.equal(forecast(bill, '2026-02').amount, 150)
  assert.equal(forecast(bill, '2026-03').count, 3)
})
test('actual replaces estimate and adjustments affect the payable total', () => {
  assert.equal(periodAmount(bill, '2026-02'), 200)
  assert.equal(periodAmount(bill, '2026-03'), 325)
})
test('manual plan is only a fallback when there is no invoice', () => {
  assert.equal(periodAmount({ ...bill, plannedAmount: 250 }, '2026-02'), 200)
  assert.equal(periodAmount({ ...bill, plannedAmount: 250 }, '2026-04'), 250)
})
test('due dates clamp to month length including leap years', () => {
  assert.equal(dueDate(bill, '2026-02').getDate(), 28)
  assert.equal(dueDate(bill, '2024-02').getDate(), 29)
  assert.equal(dueDate(bill, '2026-04').getDate(), 30)
})
test('a standalone credit is not expanded into a planned expense in reports', () => {
  const credit = { ...bill, plannedAmount: 250, history: [{ id: 'credit', period: '2026-10', source: 'adjustment', amount: -20 }] }
  assert.equal(recordedAmount(credit, '2026-10'), -20)
  assert.equal(periodAmount(credit, '2026-10'), 230)
  assert.equal(recordedAmount(credit, '2026-09'), null)
})
test('monthly forecast includes all actual entries without also counting the estimate', () => {
  assert.equal(forecast({ ...bill, history: [...bill.history, { id: 'extra', period: '2026-02', source: 'actual', amount: 100 }] }, '2026-02').amount, 200)
})

test('cash planning carries the remaining balance through monthly income and bills', () => {
  const monthlyBill = { id: 'rent', name: 'Lakbér', amount: 300, dueDay: 10, startPeriod: '2026-01', recurring: 'Havonta', paidPeriods: [], history: [] }
  assert.equal(rolledCashBalance({ balance: 1000, income: 2000, payday: 5, balanceDate: '2026-01-01' }, [monthlyBill], new Date(2026, 2, 1)), 4400)
})

test('a monthly savings goal reserves one installment, not the entire remainder', () => {
  const plan = { balance: 1005, income: 2500, payday: 10 }
  const bill = { id: 'power', amount: 180, plannedAmount: 180, dueDay: 25, startPeriod: '2026-10', recurring: 'Havonta', paidPeriods: [], history: [] }
  const goal = { target: 3500, saved: 0, deadline: '2027-07' }
  assert.deepEqual(currentMonthProjection(plan, [bill], goal, new Date(2026, 9, 17)), {
    balance: 1005, income: 0, unpaidBills: 180, unpaidCount: 1, beforeSaving: 825, reserve: 350, afterSaving: 475,
  })
  assert.deepEqual(currentMonthProjection(plan, [{ ...bill, paidPeriods: ['2026-10'] }], goal, new Date(2026, 9, 17)), {
    balance: 1005, income: 0, unpaidBills: 0, unpaidCount: 0, beforeSaving: 1005, reserve: 350, afterSaving: 655,
  })
})

test('income due today is not added again to a balance entered today', () => {
  assert.equal(currentMonthProjection({ balance: 1005, income: 2500, payday: 17, balanceDate: '2026-10-17' }, [], { target: 0, saved: 0, deadline: '' }, new Date(2026, 9, 17)).afterSaving, 1005)
  assert.equal(currentMonthProjection({ balance: 1005, income: 2500, payday: 17, balanceDate: '2026-10-16' }, [], { target: 0, saved: 0, deadline: '' }, new Date(2026, 9, 17)).afterSaving, 3505)
  assert.equal(currentMonthProjection({ balance: 1005, income: 2500, payday: 18 }, [], { target: 0, saved: 0, deadline: '' }, new Date(2026, 9, 17)).afterSaving, 3505)
})
