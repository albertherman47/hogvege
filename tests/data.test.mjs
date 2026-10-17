import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBills, parseBackup, createBackup, appliesToPeriod } from '../src/data.ts'
const bill = { id: 'one', name: 'Villany', category: 'Közüzem', provider: 'Supplier', amount: 100, dueDay: 31, startPeriod: '2026-01', color: 'green', icon: 'electricity', recurring: 'Havonta', paidPeriods: [], history: [] }
test('empty history stays empty across reloads', () => assert.deepEqual(normalizeBills([bill], '2026-10')[0].history, []))
test('duplicate bill ids and nonfinite amounts are rejected', () => {
  assert.equal(normalizeBills([bill, bill], '2026-10'), null)
  assert.equal(normalizeBills([{ ...bill, amount: Infinity }], '2026-10'), null)
})
test('signed corrections are allowed but negative invoices are rejected', () => {
  const correction = { id: 'credit', period: '2026-10', amount: -20, source: 'adjustment' }
  assert.equal(normalizeBills([{ ...bill, history: [correction] }], '2026-10')[0].history[0].amount, -20)
  assert.equal(normalizeBills([{ ...bill, history: [{ ...correction, source: 'actual' }] }], '2026-10'), null)
})
test('backup round trip preserves invoice and payment history', () => {
  const input = [{ ...bill, paidPeriods: ['2026-10'] }]
  assert.deepEqual(parseBackup(JSON.stringify(createBackup(input)), '2026-10'), input)
  assert.throws(() => parseBackup('{"app":"other","bills":[]}', '2026-10'))
})
test('annual and one-off bills do not appear outside their periods', () => {
  assert.equal(appliesToPeriod({ ...bill, recurring: 'Évente' }, '2026-02'), false)
  assert.equal(appliesToPeriod({ ...bill, recurring: 'Évente' }, '2027-01'), true)
  assert.equal(appliesToPeriod({ ...bill, recurring: 'Egyszeri' }, '2027-01'), false)
})
