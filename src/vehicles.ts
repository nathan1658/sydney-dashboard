// Client-side vehicle tracks. Positions arrive every ~20 s; we render a fixed
// LAG behind real time so every vehicle is always between two known fixes and
// moves smoothly instead of jumping.
import type { Mode, WireTrack } from '../server/types.ts'

export const LAG = 45
export const TRAIL = 90
const STALE = 240

export type Track = {
  id: string
  mode: Mode
  route: string
  label: string
  bearing: number | null
  pts: number[] // flat [lon, lat, t, ...]
  pos: [number, number]
}

export type Trail = { mode: Mode; path: [number, number][]; colors: [number, number, number, number][] }

export const tracks = new Map<string, Track>()

export const renderTime = (): number => Date.now() / 1000 - LAG

export function ingest(rows: WireTrack[]): void {
  for (const [id, mode, route, label, bearing, pts] of rows) {
    let t = tracks.get(id)
    if (!t) tracks.set(id, (t = { id, mode, route, label, bearing, pts: [], pos: [pts[0], pts[1]] }))
    t.route = route
    t.label = label
    t.bearing = bearing
    for (let i = 0; i < pts.length; i += 3) {
      if (pts[i + 2] > (t.pts.at(-1) ?? 0)) t.pts.push(pts[i], pts[i + 1], pts[i + 2])
    }
  }
}

// Moves every track to its position at time T and forgets vehicles that
// stopped reporting.
export function advance(T: number): void {
  for (const [id, t] of tracks) {
    const p = t.pts
    if (T - p[p.length - 1] > STALE) {
      tracks.delete(id)
      continue
    }
    // Drop fixes we have fully moved past (keep one before the trail window).
    let cut = 0
    while (cut + 3 < p.length && p[cut + 5] < T - TRAIL) cut += 3
    if (cut) p.splice(0, cut)

    let i = 0
    while (i + 3 < p.length && p[i + 5] <= T) i += 3
    const j = i + 3 < p.length ? i + 3 : i
    const span = p[j + 2] - p[i + 2]
    const k = span > 0 ? Math.min(1, Math.max(0, (T - p[i + 2]) / span)) : 0
    t.pos[0] = p[i] + (p[j] - p[i]) * k
    t.pos[1] = p[i + 1] + (p[j + 1] - p[i + 1]) * k
  }
}

// Fading tail of recent fixes ending at the vehicle's current position.
export function trail(t: Track, T: number, rgb: [number, number, number]): Trail | null {
  const path: [number, number][] = []
  const colors: [number, number, number, number][] = []
  const fade = (age: number): [number, number, number, number] => [...rgb, Math.round(210 * (1 - age / TRAIL) ** 1.5)]
  for (let i = 0; i < t.pts.length; i += 3) {
    const age = T - t.pts[i + 2]
    if (age <= 0) break
    if (age >= TRAIL) continue
    path.push([t.pts[i], t.pts[i + 1]])
    colors.push(fade(age))
  }
  if (!path.length) return null
  path.push([t.pos[0], t.pos[1]])
  colors.push(fade(0))
  return { mode: t.mode, path, colors }
}
