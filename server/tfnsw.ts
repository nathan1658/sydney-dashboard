// Transport for NSW Open Data: GTFS-realtime vehicle positions, trip updates
// and service alerts. Free API key: https://opendata.transport.nsw.gov.au
import GtfsRealtime from 'gtfs-realtime-bindings'

const { FeedMessage } = GtfsRealtime.transit_realtime
const API = 'https://api.transport.nsw.gov.au/'

export type Mode = 'train' | 'metro' | 'lightrail' | 'ferry' | 'bus'

const VEHICLE_FEEDS: [Mode, string][] = [
  ['train', 'v2/gtfs/vehiclepos/sydneytrains'],
  ['metro', 'v2/gtfs/vehiclepos/metro'],
  ['lightrail', 'v1/gtfs/vehiclepos/lightrail/innerwest'],
  ['lightrail', 'v1/gtfs/vehiclepos/lightrail/cbdandsoutheast'],
  ['lightrail', 'v1/gtfs/vehiclepos/lightrail/parramatta'],
  ['ferry', 'v1/gtfs/vehiclepos/ferries/sydneyferries'],
  ['ferry', 'v1/gtfs/vehiclepos/ferries/MFF'],
  ['bus', 'v1/gtfs/vehiclepos/buses'],
]
const TRIP_FEEDS: [Mode, string][] = [
  ['train', 'v2/gtfs/realtime/sydneytrains'],
  ['metro', 'v2/gtfs/realtime/metro'],
]
const ALERT_FEEDS: [Mode, string][] = [
  ['train', 'v2/gtfs/alerts/sydneytrains'],
  ['metro', 'v2/gtfs/alerts/metro'],
  ['lightrail', 'v2/gtfs/alerts/lightrail'],
  ['ferry', 'v2/gtfs/alerts/ferries'],
  ['bus', 'v2/gtfs/alerts/buses'],
]

export const VEHICLE_SECONDS = Number(process.env.VEHICLE_POLL_SECONDS ?? 20)
const TRAIL_SECONDS = 150
const GONE_SECONDS = 300

// toObject() output: longs as numbers, enums as their names.
type Feed = { header: { timestamp?: number }; entity?: Record<string, any>[] }

async function feed(path: string): Promise<Feed> {
  const key = process.env.TFNSW_API_KEY
  if (!key) throw new Error('TFNSW_API_KEY is not set (see README)')
  const res = await fetch(API + path, {
    headers: { Authorization: `apikey ${key}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  const msg = FeedMessage.decode(new Uint8Array(await res.arrayBuffer()))
  return FeedMessage.toObject(msg, { longs: Number, enums: String }) as Feed
}

// One request at a time keeps us under TfNSW's per-second rate limit. A
// failing feed is logged and skipped; only a total failure fails the job.
async function feeds(list: [Mode, string][]): Promise<[Mode, string, Feed][]> {
  const out: [Mode, string, Feed][] = []
  const errors: string[] = []
  for (const [mode, path] of list) {
    try {
      out.push([mode, path, await feed(path)])
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }
  if (!out.length) throw new Error(errors[0])
  for (const e of errors) console.warn(`[tfnsw] ${e}`)
  return out
}

// --- Vehicles -----------------------------------------------------------

type Track = {
  id: string
  mode: Mode
  route: string
  trip: string // server-only: joins positions to trip updates
  label: string
  bearing: number | null
  points: number[] // flat [lon, lat, t, lon, lat, t, ...], t in epoch seconds
  seen: number
}

// Wire format: [id, mode, route, label, bearing, points]
export type WireTrack = [string, Mode, string, string, number | null, number[]]

const tracks = new Map<string, Track>()
const round = (x: number): number => Math.round(x * 1e5) / 1e5

const wire = (t: Track, points: number[]): WireTrack => [t.id, t.mode, t.route, t.label, t.bearing, points]

export const vehicleTracks = (): WireTrack[] => [...tracks.values()].map(t => wire(t, t.points))

export async function vehicles(): Promise<WireTrack[]> {
  const now = Date.now() / 1000
  const fresh: WireTrack[] = []

  for (const [mode, path, msg] of await feeds(VEHICLE_FEEDS)) {
    const feedName = path.split('/').pop()
    for (const e of msg.entity ?? []) {
      const v = e.vehicle
      const p = v?.position
      if (!p?.latitude || !p?.longitude) continue
      const id = `${feedName}:${v.vehicle?.id ?? e.id}`
      const t = v.timestamp ?? msg.header.timestamp ?? now

      let track = tracks.get(id)
      if (!track) tracks.set(id, (track = { id, mode, route: '', trip: '', label: '', bearing: null, points: [], seen: now }))
      track.route = v.trip?.routeId ?? ''
      track.trip = v.trip?.tripId ?? ''
      track.label = v.vehicle?.label ?? ''
      track.bearing = p.bearing ?? null
      track.seen = now

      const lastT = track.points.at(-1) ?? 0
      if (t <= lastT) continue
      const point = [round(p.longitude), round(p.latitude), t]
      track.points.push(...point)
      fresh.push(wire(track, point))
    }
  }

  for (const [id, track] of tracks) {
    if (now - track.seen > GONE_SECONDS) {
      tracks.delete(id)
      continue
    }
    // Keep one point older than the trail window so the client can interpolate into it.
    let cut = 0
    while (cut + 3 < track.points.length && track.points[cut + 5] < now - TRAIL_SECONDS) cut += 3
    if (cut) track.points.splice(0, cut)
  }
  return fresh
}

// --- Punctuality --------------------------------------------------------

export type Punctuality = { mode: Mode; running: number; onTime: number; avgDelay: number; cancelled: number }

const LATE_SECONDS = 5 * 60 // Sydney Trains' on-time standard for suburban services

// A trip counts as running when a vehicle on it reported its position in the
// last two polls. That holds however the feed shapes its stop lists.
export async function punctuality(): Promise<Punctuality[]> {
  const now = Date.now() / 1000
  const running = new Set<string>()
  for (const t of tracks.values()) if (t.trip && now - t.seen < VEHICLE_SECONDS * 2.5) running.add(t.trip)

  return (await feeds(TRIP_FEEDS)).map(([mode, , msg]) => {
    let measured = 0
    let onTime = 0
    let delaySum = 0
    let cancelled = 0
    for (const e of msg.entity ?? []) {
      const tu = e.tripUpdate
      if (!tu) continue
      if (tu.trip?.scheduleRelationship === 'CANCELED') {
        cancelled++
        continue
      }
      const stops: Record<string, any>[] = tu.stopTimeUpdate ?? []
      if (!running.has(tu.trip?.tripId) || !stops.length) continue
      const at = (s: Record<string, any>): number => s.arrival?.time ?? s.departure?.time ?? 0
      const next = stops.find(s => at(s) >= now) ?? stops[stops.length - 1]
      const delay = next.arrival?.delay ?? next.departure?.delay ?? tu.delay ?? 0
      measured++
      delaySum += Math.max(0, delay)
      if (delay < LATE_SECONDS) onTime++
    }
    return { mode, running: measured, onTime, avgDelay: measured ? delaySum / measured : 0, cancelled }
  })
}

// --- Alerts -------------------------------------------------------------

export type Alert = {
  id: string
  mode: Mode
  effect: string
  title: string
  detail: string
  url: string | null
  start: number | null
  end: number | null
}

function text(ts: Record<string, any> | undefined): string {
  const tr: Record<string, any>[] = ts?.translation ?? []
  const pick = tr.find(t => t.language === 'en') ?? tr.find(t => !String(t.language ?? '').includes('html')) ?? tr[0]
  return String(pick?.text ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function alerts(): Promise<Alert[]> {
  const now = Date.now() / 1000
  const out: Alert[] = []
  for (const [mode, , msg] of await feeds(ALERT_FEEDS)) {
    for (const e of msg.entity ?? []) {
      const a = e.alert
      if (!a) continue
      const periods: Record<string, any>[] = a.activePeriod ?? []
      const current = periods.find(p => (p.start ?? 0) <= now && (p.end ?? Infinity) >= now)
      if (periods.length && !current) continue
      const detail = text(a.descriptionText)
      const url = text(a.url)
      out.push({
        id: `${mode}:${e.id}`,
        mode,
        effect: a.effect ?? 'UNKNOWN_EFFECT',
        title: text(a.headerText) || detail.slice(0, 120),
        detail: detail.length > 600 ? detail.slice(0, 600) + '…' : detail,
        url: /^https?:\/\//i.test(url) ? url : null, // links go into hrefs: no other schemes
        start: current?.start ?? null,
        end: current?.end ?? null,
      })
    }
  }
  return out
}
