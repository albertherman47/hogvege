import test from 'node:test'
import assert from 'node:assert/strict'
import { storage, readStored, validCashPlan, validSavingsGoal } from '../src/storage.ts'
const values = new Map()
globalThis.window = new EventTarget()
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
test('corrupt data is preserved and protected against automatic overwrite', () => {
  values.set('broken', '{broken')
  assert.deepEqual(readStored('broken', { value: 1 }, () => false), { value: 1 })
  storage.setItem('broken', 'replacement')
  assert.equal(values.get('broken'), '{broken')
  storage.release('broken')
  storage.setItem('broken', 'restored')
  assert.equal(values.get('broken'), 'restored')
})
test('cash plan validates bounds and missing fields', () => {
  assert.equal(validCashPlan({ balance: 10, income: 20, payday: 31 }), true)
  assert.equal(validCashPlan({ balance: 10, income: 20, payday: 32 }), false)
  assert.equal(validCashPlan({ balance: '10', income: 20, payday: 1 }), false)
  assert.equal(validCashPlan(null), false)
})
test('savings validation rejects invalid months and negative values', () => {
  assert.equal(validSavingsGoal({ name: 'Utazás', target: 1000, saved: 20, deadline: '2026-12' }), true)
  assert.equal(validSavingsGoal({ name: 'Utazás', target: 1000, saved: 20, deadline: '2026-99' }), false)
  assert.equal(validSavingsGoal({ name: 'Utazás', target: -1, saved: 20, deadline: '' }), false)
})
