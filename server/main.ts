// One process serves the live API and the frontend: Vite middleware in dev,
// the built dist/ folder in production.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import * as bom from './bom.ts'
import { subscribe } from './hub.ts'
import { feedHealth, start } from './jobs.ts'
import * as tfnsw from './tfnsw.ts'

const PORT = Number(process.env.PORT ?? 8787)
const DEV = process.argv.includes('--dev')

type Handler = (req: IncomingMessage, res: ServerResponse) => void

start([
  { name: 'vehicles', every: tfnsw.VEHICLE_SECONDS, run: tfnsw.vehicles, snapshot: tfnsw.vehicleTracks },
  { name: 'punctuality', every: 60, run: tfnsw.punctuality },
  { name: 'alerts', every: 120, run: tfnsw.alerts },
  { name: 'observations', every: 300, run: bom.observations },
  { name: 'radar', every: 120, run: bom.radar },
  { name: 'warnings', every: 300, run: bom.warnings },
  { name: 'forecast', every: 1800, run: bom.forecast },
])

const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname
  if (path === '/api/live') return subscribe(res)
  if (path === '/api/health') return json(res, feedHealth())
  if (path.startsWith('/api/radar/')) return radarImage(res, path.slice('/api/radar/'.length))
  if (path.startsWith('/api/')) return json(res, { error: 'not found' }, 404)
  frontend(req, res)
})

const frontend: Handler = DEV ? await viteFrontend() : staticFrontend(resolve('dist'))

server.listen(PORT, () => {
  console.log(`Sydney dashboard on http://localhost:${PORT}${DEV ? ' (dev)' : ''}`)
  if (!process.env.TFNSW_API_KEY) console.warn('TFNSW_API_KEY is not set: transport layers stay empty (see README).')
})

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function radarImage(res: ServerResponse, name: string): void {
  const png = bom.radarImage(name)
  if (!png) return json(res, { error: 'unknown frame' }, 404)
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, immutable' })
  res.end(png)
}

async function viteFrontend(): Promise<Handler> {
  const { createServer: createVite } = await import('vite')
  const vite = await createVite({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' })
  return (req, res) => vite.middlewares(req, res)
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
}

function staticFrontend(root: string): Handler {
  return async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    let file = join(root, path)
    if (file !== root && !file.startsWith(root + sep)) return json(res, { error: 'forbidden' }, 403)
    let body: Buffer
    try {
      body = await readFile(file)
    } catch {
      file = join(root, 'index.html') // directories and unknown paths get the app shell
      body = await readFile(file)
    }
    const immutable = file.startsWith(join(root, 'assets') + sep)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    res.end(body)
  }
}
