import http from 'node:http'
import { readFile, stat, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { handleInvoice } from './invoice-ocr.mjs'

// This product intentionally serves only the local machine, without user accounts.
const root = fileURLToPath(new URL('../dist/', import.meta.url))
const port = Number(process.env.PORT || 4173)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.')
await stat(path.join(root, 'index.html')).catch(() => { throw new Error('Run npm run build before npm start.') })
const rootReal = await realpath(root)
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }

function json(res, status, body) {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

const server = http.createServer(async (req, res) => {
  const requestId = randomUUID()
  res.setHeader('X-Request-ID', requestId)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
  // Host allowlist prevents DNS rebinding to the unauthenticated local service.
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) return json(res, 403, { error: 'Csak helyi elérés engedélyezett.' })
  // Cross-site pages may link to the local app. Keep that navigation usable,
  // while refusing cross-site access to the local API.
  if (req.headers['sec-fetch-site'] === 'cross-site' && new URL(req.url, `http://127.0.0.1:${port}`).pathname.startsWith('/api/')) return json(res, 403, { error: 'Külső oldalról érkező kérés nem engedélyezett.' })
  if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return json(res, 403, { error: 'Érvénytelen kérésforrás.' })
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    if (url.pathname === '/api/invoices/extract') return await handleInvoice(req, res)
    if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { status: 'ok', mode: 'local', version: '1.0.0' })
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Ismeretlen végpont.' })
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return json(res, 405, { error: 'Nem támogatott metódus.' }) }
    let pathname
    try { pathname = decodeURIComponent(url.pathname) } catch { return json(res, 400, { error: 'Érvénytelen cím.' }) }
    if (pathname.includes('\0') || pathname.includes('\\')) return json(res, 400, { error: 'Érvénytelen cím.' })
    const target = path.resolve(rootReal, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!target.startsWith(rootReal + path.sep)) return json(res, 404, { error: 'Nem található.' })
    let filename
    try { filename = await realpath(target) } catch { return json(res, 404, { error: 'Nem található.' }) }
    if (!filename.startsWith(rootReal + path.sep)) return json(res, 404, { error: 'Nem található.' })
    const metadata = await stat(filename)
    if (!metadata.isFile()) return json(res, 404, { error: 'Nem található.' })
    res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream')
    res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
    res.setHeader('Content-Length', metadata.size)
    if (req.method === 'HEAD') return res.end()
    res.end(await readFile(filename))
  } catch {
    console.error(JSON.stringify({ event: 'request_failed', requestId }))
    json(res, 500, { error: 'A kérés feldolgozása nem sikerült.', requestId })
  }
})
server.headersTimeout = 15_000
server.requestTimeout = 150_000
server.timeout = 150_000
server.keepAliveTimeout = 5_000
server.maxRequestsPerSocket = 100
server.listen(port, '127.0.0.1', () => console.log(`Hóvége: http://127.0.0.1:${port}`))
function shutdown() {
  server.close(() => process.exit(0))
  setTimeout(() => { server.closeAllConnections(); process.exit(0) }, 125_000).unref()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
