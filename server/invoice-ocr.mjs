import { execFile as nodeExecFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFile = promisify(nodeExecFile)
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_BODY_BYTES = 14 * 1024 * 1024
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const attempts = new Map()
let activeJobs = 0
const MAX_JOBS = 2

function normalize(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[șş]/gi, 's').replace(/[țţ]/gi, 't').toLowerCase()
}

function validIsoDate(year, month, day) {
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function datesIn(text) {
  const matches = []
  const pattern = /\b([0-3]?\d)[./-]([01]?\d)[./-](20\d{2})\b|\b(20\d{2})[-/.]([01]?\d)[-/.]([0-3]?\d)\b/g
  for (const match of text.matchAll(pattern)) {
    const [, d, m, y, isoY, isoM, isoD] = match
    const date = d ? validIsoDate(y, m, d) : validIsoDate(isoY, isoM, isoD)
    if (date) matches.push(date)
  }
  return [...new Set(matches)]
}

function parsePeriod(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const periodLine = lines.find(line => /\b(period|perioad|billing period|idoszak|elszamolas)/.test(normalize(line)))
  if (periodLine) {
    const dates = datesIn(periodLine)
    if (dates.length) return dates[0].slice(0, 7)
    const monthMatch = periodLine.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])\b/)
    if (monthMatch) return `${monthMatch[1]}-${monthMatch[2].padStart(2, '0')}`
  }
  const monthMatch = text.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])\b/)
  if (monthMatch) return `${monthMatch[1]}-${monthMatch[2].padStart(2, '0')}`
  return null
}

function parseMoney(raw) {
  let value = raw.replace(/[\s\u00a0'’]/g, '')
  if (!value) return null
  const comma = value.lastIndexOf(',')
  const dot = value.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.'
    const grouping = decimal === ',' ? /\./g : /,/g
    value = value.replace(grouping, '').replace(decimal, '.')
  } else if (comma >= 0) {
    const decimals = value.length - comma - 1
    value = decimals > 0 && decimals <= 2 ? value.replace(',', '.') : value.replace(/,/g, '')
  } else if (dot >= 0) {
    const decimals = value.length - dot - 1
    value = decimals === 3 ? value.replace(/\./g, '') : value
  }
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function parseAmount(text) {
  const candidates = []
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  for (const line of lines) {
    const plain = normalize(line)
    let score = 0
    if (/total\s+(de\s+)?plata|suma\s+(de\s+)?plata|amount\s+(due|payable)|total\s+due|grand\s+total|total\s+(de\s+)?achitat|total\s+spre\s+plata|fizetendo|vegosszeg|osszesen/.test(plain)) score = 100
    else if (/\b(de\s+)?plata\b|\bachitat\b|\bpayable\b|\bto\s+pay\b/.test(plain)) score = 80
    else if (/valoare\s+totala|total\s+factura|factura\s+total/.test(plain)) score = 65
    else if (/\btotal\b/.test(plain)) score = 35
    if (!score || /subtotal|total\s+(consum|energie|tva|tax|without|fara)|previous|anterior/.test(plain)) continue
    const withoutDates = line.replace(/\b(?:[0-3]?\d)[./-](?:[01]?\d)[./-]20\d{2}\b|\b20\d{2}[-/.][01]?\d[-/.][0-3]?\d\b/g, ' ')
    const amounts = withoutDates.match(/\d(?:[\d \u00a0'’.,]*\d)?/g) || []
    const amount = amounts.map(parseMoney).filter(value => value !== null).at(-1)
    if (amount) candidates.push({ amount, score })
  }
  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]?.amount ?? null
}

function parseDueDate(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const dueLine = lines.find(line => /\b(scadenta?|esedekesseg|fizetesi hatarido|data limita|termen de plata|plata pana la|pay by|due date|payment deadline)\b/.test(normalize(line)))
  return dueLine ? datesIn(dueLine)[0] ?? null : null
}

function parseSupplier(text) {
  const known = /\b(electrica|e\.on|digi|enel|engie|orange|vodafone|ppc|delgaz|aquaserv|romgaz|restart|hidroelectrica|telekom)\b/i
  const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(line => line.length >= 3 && line.length <= 100)
  const recognized = lines.find(line => known.test(line))
  if (recognized) return recognized
  const generic = /^(factura|invoice|client|customer|furnizor|supplier|total|fizetendo|osszesen|cod|cui|cif|serie|numar|data|adresa|pagina|tel|www\.)\b/i
  return lines.slice(0, 12).find(line => /[a-zA-Z]{3}/.test(line) && !generic.test(normalize(line))) ?? null
}

function parseConsumption(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  for (const line of lines) {
    const plain = normalize(line)
    if (!/consum|cantitate|quantity|usage/.test(plain)) continue
    const match = line.match(/\d[\d\s\u00a0'’]*(?:[,.]\d{1,3})?/)
    const consumption = match ? parseMoney(match[0]) : null
    if (consumption === null) continue
    const unit = line.match(/kwh|kw\s*\/\s*h|m3|m³|mc|m\^3/i)?.[0] ?? null
    return { consumption, consumptionUnit: unit }
  }
  return { consumption: null, consumptionUnit: null }
}

export function parseInvoiceText(text) {
  const supplier = parseSupplier(text)
  const billingPeriod = parsePeriod(text)
  const dueDate = parseDueDate(text)
  const amount = parseAmount(text)
  const { consumption, consumptionUnit } = parseConsumption(text)
  const currency = /\b(RON|LEI)\b/i.test(text) ? 'RON' : /\b(EUR|EURO)\b/i.test(text) ? 'EUR' : null
  const fieldsFound = [supplier, billingPeriod, dueDate, amount, consumption].filter(value => value !== null).length
  const confidence = amount && billingPeriod && fieldsFound >= 3 ? 'high' : amount && billingPeriod ? 'medium' : 'low'
  return { supplier, billingPeriod, dueDate, amount, currency, consumption, consumptionUnit, confidence }
}

async function command(name, args, options = {}) {
  const result = await execFile(name, args, { encoding: 'utf8', timeout: 35_000, maxBuffer: 5 * 1024 * 1024, ...options })
  return result.stdout
}

async function availableTesseractLanguages(signal) {
  const listed = await command('tesseract', ['--list-langs'], { signal })
  return listed.split(/\r?\n/).slice(1).map(language => language.trim()).filter(Boolean)
}

async function ocrImage(imagePath, language, signal) {
  return command('tesseract', [imagePath, 'stdout', '-l', language, '--psm', '6'], { signal })
}

async function extractText(fileBytes, mimeType, env, signal) {
  async function language() {
    const available = await availableTesseractLanguages(signal)
    const preferred = env.TESSERACT_LANG && env.TESSERACT_LANG !== 'auto'
      ? env.TESSERACT_LANG.split('+').filter(lang => available.includes(lang))
      : ['eng', 'hun', 'ron'].filter(lang => available.includes(lang))
    const selected = preferred.join('+') || available.find(lang => lang !== 'osd')
    if (!selected) throw Object.assign(new Error('Nem található használható Tesseract nyelvi csomag.'), { status: 503 })
    return selected
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hogvege-invoice-'))
  try {
    const inputPath = path.join(dir, mimeType === 'application/pdf' ? 'invoice.pdf' : `invoice.${mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp'}`)
    await writeFile(inputPath, fileBytes, { mode: 0o600 })
    if (mimeType !== 'application/pdf') return await ocrImage(inputPath, await language(), signal)

    let text = ''
    try { text = await command('pdftotext', ['-f', '1', '-l', '3', '-layout', '-enc', 'UTF-8', inputPath, '-'], { signal }) }
    catch (error) { if (signal?.aborted) throw error; /* Scanned PDF: render below. */ }
    if (text.trim().length >= 40) return text

    const prefix = path.join(dir, 'page')
    await command('pdftoppm', ['-f', '1', '-l', '3', '-png', '-r', '220', inputPath, prefix], { signal })
    const pages = (await readdir(dir)).filter(name => /^page-\d+\.png$/.test(name)).sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
    if (!pages.length) throw new Error('A PDF oldalait nem sikerült képpé alakítani.')
    const selectedLanguage = await language()
    const pageText = []
    for (const page of pages) pageText.push(await ocrImage(path.join(dir, page), selectedLanguage, signal))
    return pageText.join('\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function send(res, status, body) {
  if (res.destroyed || res.writableEnded) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
      req.resume()
      return reject(Object.assign(new Error('A fájl legfeljebb 10 MB lehet.'), { status: 413 }))
    }
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0
        reject(Object.assign(new Error('A fájl legfeljebb 10 MB lehet.'), { status: 413 }))
      } else chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) return
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(Object.assign(new Error('Hibás kérés érkezett.'), { status: 400 })) }
    })
    req.on('error', reject)
    req.on('aborted', () => reject(Object.assign(new Error('A feltöltés megszakadt.'), { status: 400 })))
  })
}

function validFileSignature(bytes, type) {
  if (type === 'application/pdf') return bytes.subarray(0, 5).toString() === '%PDF-'
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (type === 'image/webp') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
  return false
}

function rateLimited(req) {
  const now = Date.now()
  for (const [key, value] of attempts) if (now - value.startedAt > 60_000) attempts.delete(key)
  const key = req.socket.remoteAddress || 'local'
  if (!attempts.has(key) && attempts.size >= 1000) return true
  const current = attempts.get(key)
  if (!current || now - current.startedAt > 60_000) {
    attempts.set(key, { startedAt: now, count: 1 })
    return false
  }
  current.count += 1
  return current.count > 12
}

export async function handleInvoice(req, res, env = process.env) {
  res.setHeader('Allow', 'POST')
  if (req.method !== 'POST') return send(res, 405, { error: 'Csak POST kérés használható.' })
  const origin = req.headers.origin
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return send(res, 403, { error: 'Külső forrásból érkező kérés nem engedélyezett.' }) }
    catch { return send(res, 403, { error: 'Érvénytelen kérésforrás.' }) }
  }
  if (rateLimited(req)) { res.setHeader('Retry-After', '60'); return send(res, 429, { error: 'Túl sok felismerési kérés. Várj egy percet, majd próbáld újra.' }) }
  if (!String(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'A kérés formátuma nem támogatott.' })
  let input
  try { input = await readJson(req) }
  catch (error) { return send(res, error.status || 400, { error: error.message || 'Hibás kérés.' }) }
  const { mimeType, base64 } = input || {}
  if (!ALLOWED_TYPES.has(mimeType) || typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return send(res, 400, { error: 'PDF, JPG, PNG vagy WebP fájlt tölts fel.' })
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) return send(res, 413, { error: 'A fájl üres vagy nagyobb 10 MB-nál.' })
  if (!validFileSignature(bytes, mimeType)) return send(res, 400, { error: 'A fájlformátum nem egyezik a kiválasztott fájllal.' })
  if (activeJobs >= MAX_JOBS) { res.setHeader('Retry-After', '10'); return send(res, 503, { error: 'A felismerő most foglalt. Próbáld újra néhány másodperc múlva.' }) }
  activeJobs += 1
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  const disconnected = () => { if (!res.writableEnded) controller.abort() }
  res.on('close', disconnected)
  try {
    const text = await extractText(bytes, mimeType, env, controller.signal)
    if (!text.trim()) return send(res, 422, { error: 'Nem sikerült szöveget kiolvasni. Próbálj élesebb képet vagy kereshető PDF-et.' })
    return send(res, 200, { invoice: parseInvoiceText(text) })
  } catch (error) {
    const commandMissing = error?.code === 'ENOENT'
    const message = commandMissing
      ? 'A helyi OCR-hez Tesseract és a PDF-feldolgozáshoz Poppler szükséges a gépen.'
      : error?.killed || controller.signal.aborted
        ? 'A helyi felismerés túl sokáig tartott. Próbálj kisebb vagy élesebb fájlt.'
        : 'Nem sikerült feldolgozni a számlát. Próbálj másik fájlt, vagy add meg kézzel az adatokat.'
    return send(res, commandMissing ? 503 : error.status || 422, { error: message })
  } finally {
    clearTimeout(timeout)
    res.off('close', disconnected)
    activeJobs -= 1
  }
}

function invoiceOcrPlugin(fileEnv = {}) {
  const env = { ...fileEnv, ...process.env }
  return {
    name: 'hogvege-local-invoice-ocr',
    configureServer(server) {
      server.middlewares.use('/api/invoices/extract', (req, res) => { void handleInvoice(req, res, env).catch(() => send(res, 500, { error: 'Váratlan feldolgozási hiba.' })) })
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/invoices/extract', (req, res) => { void handleInvoice(req, res, env).catch(() => send(res, 500, { error: 'Váratlan feldolgozási hiba.' })) })
    },
  }
}

export default invoiceOcrPlugin
