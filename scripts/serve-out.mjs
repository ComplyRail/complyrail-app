// Minimal static server for the `next build` output (`output: 'export'`).
// `next start` does not run for static exports, so Playwright serves `out/` instead.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out')
const port = Number(process.env.PORT || 3100)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}

async function resolveFile(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  const candidates = [clean, path.join(clean, 'index.html'), `${clean}.html`]
  for (const candidate of candidates) {
    const full = path.join(root, candidate)
    if (!full.startsWith(root)) continue
    try {
      if ((await stat(full)).isFile()) return full
    } catch {
      /* try next */
    }
  }
  return null
}

createServer(async (req, res) => {
  const file = await resolveFile(req.url || '/')
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
    return
  }
  const body = await readFile(file)
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body)
}).listen(port, () => console.log(`Serving ${root} on http://localhost:${port}`))
