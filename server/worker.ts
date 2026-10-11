// The live API: a Cloudflare Worker in front of one Durable Object. The
// object is the single place that polls the upstream feeds and holds the
// TfNSW key, so every browser shares one set of upstream requests.
import { DurableObject } from 'cloudflare:workers'
import * as bom from './bom.ts'
import { hasClients, ping, subscribe } from './hub.ts'
import { feedHealth, tick, type Job } from './jobs.ts'
import * as tfnsw from './tfnsw.ts'

const JOBS: Job[] = [
  { name: 'vehicles', every: tfnsw.VEHICLE_SECONDS, run: tfnsw.vehicles, snapshot: tfnsw.vehicleTracks },
  { name: 'punctuality', every: 60, run: tfnsw.punctuality },
  { name: 'alerts', every: 120, run: tfnsw.alerts },
  { name: 'observations', every: 300, run: bom.observations },
  { name: 'radar', every: 120, run: bom.radar },
  { name: 'warnings', every: 300, run: bom.warnings },
  { name: 'forecast', every: 1800, run: bom.forecast },
]

// Pages allowed to read the API from a browser: the Firebase site and local dev.
const ORIGINS = [/^https:\/\/sydney-live-dashboard\.(web\.app|firebaseapp\.com)$/, /^http:\/\/localhost:\d+$/]

export class Live extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname
    if (path === '/api/live') {
      if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now())
      return subscribe()
    }
    if (path === '/api/health') return Response.json(feedHealth())
    if (path.startsWith('/api/radar/')) return radarImage(path.slice('/api/radar/'.length))
    return Response.json({ error: 'not found' }, { status: 404 })
  }

  // Polling stops with the last viewer; the next one re-arms it.
  async alarm(): Promise<void> {
    if (!hasClients()) return
    ping()
    await this.ctx.storage.setAlarm(await tick(JOBS))
  }
}

function radarImage(name: string): Response {
  const png = bom.radarImage(name)
  if (!png) return Response.json({ error: 'unknown frame' }, { status: 404 })
  return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, immutable' } })
}

export default {
  async fetch(req, env): Promise<Response> {
    if (req.method !== 'GET' || !new URL(req.url).pathname.startsWith('/api/')) {
      return Response.json({ error: 'not found' }, { status: 404 })
    }
    // Created once, next to its upstreams (TfNSW and BoM are in Australia).
    const live = env.LIVE.get(env.LIVE.idFromName('sydney'), { locationHint: 'oc' })
    const res = await live.fetch(req)
    const origin = req.headers.get('Origin')
    if (!origin || !ORIGINS.some(o => o.test(origin))) return res
    const out = new Response(res.body, res)
    out.headers.set('Access-Control-Allow-Origin', origin)
    out.headers.append('Vary', 'Origin')
    return out
  },
} satisfies ExportedHandler<Env>
