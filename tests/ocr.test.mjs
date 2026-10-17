import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { handleInvoice, parseInvoiceText } from '../server/invoice-ocr.mjs'

test('Romanian OCR extracts decimal amounts, period and due date', () => {
  const result = parseInvoiceText('Electrica\nPerioada: 01.09.2026 - 30.09.2026\nData scadenta: 15.10.2026\nTotal de plata: 1.234,56 RON\nConsum: 180 kWh')
  assert.equal(result.amount, 1234.56)
  assert.equal(result.billingPeriod, '2026-09')
  assert.equal(result.dueDate, '2026-10-15')
  assert.equal(result.currency, 'RON')
})
test('impossible dates are not accepted', () => {
  assert.equal(parseInvoiceText('Due date: 31.02.2026').dueDate, null)
})
let requestNumber = 0
async function request({ method = 'POST', headers = {}, body = '{}' } = {}) {
  const req = Readable.from([Buffer.from(body)])
  req.method = method
  req.headers = { host: 'localhost:4173', 'content-type': 'application/json', ...headers }
  req.socket = { remoteAddress: `test-${requestNumber++}` }
  const res = { statusCode: 0, headers: {}, setHeader(key, value) { this.headers[key] = value }, end(data) { this.body = JSON.parse(data); this.writableEnded = true } }
  await handleInvoice(req, res)
  return res
}
test('OCR only accepts POST', async () => assert.equal((await request({ method: 'GET' })).statusCode, 405))
test('OCR rejects foreign origins', async () => assert.equal((await request({ headers: { origin: 'https://untrusted.invalid' } })).statusCode, 403))
test('OCR rejects malformed JSON', async () => assert.equal((await request({ body: '{' })).statusCode, 400))
test('OCR rejects unsupported content types', async () => assert.equal((await request({ headers: { 'content-type': 'text/plain' } })).statusCode, 415))
test('OCR checks actual bytes, not just the claimed MIME type', async () => {
  const res = await request({ body: JSON.stringify({ mimeType: 'image/png', base64: Buffer.from('not an image').toString('base64') }) })
  assert.equal(res.statusCode, 400)
})
test('OCR rejects oversized body before processing', async () => assert.equal((await request({ headers: { 'content-length': String(15 * 1024 * 1024) } })).statusCode, 413))
