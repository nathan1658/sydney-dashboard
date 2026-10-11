// The 3D scene: MapLibre renders the sandstone city (terrain of buildings,
// water, rain radar) and deck.gl draws the live data on top. deck.gl owns the
// camera; MapLibre follows it, which keeps the two independent of each
// other's internals.
import { Map as MapLibre, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { Deck, FlyToInterpolator, type MapViewState, type PickingInfo } from '@deck.gl/core'
import { ColumnLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import type { Radar, Station } from '../server/bom.ts'
import type { Mode } from '../server/tfnsw.ts'
import { mapStyle } from './mapstyle.ts'
import { MODES } from './modes.ts'
import { tempRgb } from './temperature.ts'
import { advance, renderTime, trail, tracks, type Trail, type Track } from './vehicles.ts'

export const VIEWS = {
  city: { longitude: 151.2068, latitude: -33.8752, zoom: 13.7, pitch: 62, bearing: -24 },
  harbour: { longitude: 151.2128, latitude: -33.8492, zoom: 14.4, pitch: 68, bearing: 168 },
  sydney: { longitude: 151.0, latitude: -33.87, zoom: 9.75, pitch: 26, bearing: 0 },
} satisfies Record<string, Partial<MapViewState>>

export type View = keyof typeof VIEWS

const LIMITS = { minZoom: 8, maxZoom: 18, maxPitch: 75 }
const INK: [number, number, number] = [44, 38, 30]
const PAPER: [number, number, number, number] = [250, 246, 238, 235]
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

// MapLibre v6 runs its tile worker from a URL; Vite bundles it on its own.
setWorkerUrl(workerUrl)

let view: MapViewState = { ...VIEWS.sydney, ...LIMITS }
let stations: Station[] = []
let focus: Mode | null = null
let showStations = true
let trails: Trail[] = []
let trailsAt = 0
let frame = 0

const map = new MapLibre({
  container: 'map',
  style: mapStyle,
  interactive: false,
  attributionControl: false,
  maxPitch: LIMITS.maxPitch,
  center: [view.longitude, view.latitude],
  zoom: view.zoom,
  pitch: view.pitch,
  bearing: view.bearing,
})
const styleReady = new Promise<void>(resolve => map.once('load', () => resolve()))

const deck = new Deck({
  canvas: 'deck',
  initialViewState: view,
  controller: { inertia: 400 },
  onViewStateChange: ({ viewState }) => sync(viewState as MapViewState),
  getTooltip: tooltip,
  layers: [],
})

function sync(next: MapViewState): void {
  view = next
  map.jumpTo({ center: [view.longitude, view.latitude], zoom: view.zoom, pitch: view.pitch, bearing: view.bearing })
}

export function fly(name: View, duration = 2600): void {
  const ms = reducedMotion ? 0 : duration
  const target = { ...VIEWS[name], ...LIMITS }
  deck.setProps({
    initialViewState: { ...target, transitionDuration: ms, transitionInterpolator: new FlyToInterpolator({ curve: 1.3 }) },
  })
  // deck.gl reports animated camera moves but not instant ones; mirror those by hand.
  if (!ms) sync(target)
}

export function setFocus(mode: Mode | null): void {
  focus = mode
  trailsAt = 0
}

export function setStations(next: Station[]): void {
  stations = next.filter(s => s.temp !== null)
}

export function setStationsVisible(on: boolean): void {
  showStations = on
}

// --- Render loop ----------------------------------------------------------

let visible: Track[] = []

function tick(): void {
  const T = renderTime()
  advance(T)
  frame++
  if (visible.length !== tracks.size || frame % 30 === 0) visible = [...tracks.values()]
  if (performance.now() - trailsAt > 100) {
    trailsAt = performance.now()
    trails = []
    for (const t of visible) {
      if (focus && t.mode !== focus) continue
      const tr = trail(t, T, MODES[t.mode].rgb)
      if (tr) trails.push(tr)
    }
  }
  deck.setProps({ layers: [...stationLayers(), ...vehicleLayers()] })
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

function vehicleLayers() {
  return [
    new PathLayer<Trail>({
      id: 'trails',
      data: trails,
      getPath: d => d.path,
      getColor: d => d.colors,
      getWidth: d => MODES[d.mode].width,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
    }),
    new ScatterplotLayer<Track>({
      id: 'vehicles',
      data: visible,
      getPosition: d => d.pos,
      getRadius: d => MODES[d.mode].radius,
      getFillColor: d => [...MODES[d.mode].rgb, focus && d.mode !== focus ? 40 : 255],
      getLineColor: d => [250, 246, 238, focus && d.mode !== focus ? 40 : 255],
      radiusUnits: 'meters',
      radiusMinPixels: 2.2,
      radiusMaxPixels: 9,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
      pickable: true,
      autoHighlight: true,
      highlightColor: [44, 38, 30, 255],
      updateTriggers: { getPosition: frame, getFillColor: focus, getLineColor: focus },
    }),
  ]
}

// Columns are sized in screen pixels so the temperature skyline reads the
// same from a suburb or from across the basin.
function stationLayers() {
  if (!showStations || !stations.length) return []
  const mpp = (156543.03392 * Math.cos((view.latitude * Math.PI) / 180)) / 2 ** view.zoom
  const height = (s: Station) => Math.max(1, (s.temp ?? 0) + 2) * 1.5 * mpp
  return [
    new ColumnLayer<Station>({
      id: 'stations',
      data: stations,
      diskResolution: 20,
      radius: 4 * mpp,
      extruded: true,
      getPosition: s => [s.lon, s.lat],
      getElevation: height,
      getFillColor: s => [...tempRgb(s.temp ?? 0), 235],
      material: { ambient: 0.55, diffuse: 0.6, shininess: 12 },
      pickable: true,
      updateTriggers: { getElevation: mpp },
    }),
    new TextLayer<Station>({
      id: 'station-temps',
      data: stations,
      getPosition: s => [s.lon, s.lat, height(s) + 4 * mpp],
      getText: s => `${Math.round(s.temp ?? 0)}°`,
      getColor: INK,
      getSize: 13,
      fontFamily: 'Archivo, sans-serif',
      fontWeight: 600,
      characterSet: 'auto',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'bottom',
      background: true,
      getBackgroundColor: PAPER,
      backgroundPadding: [5, 2, 5, 2],
      parameters: { depthCompare: 'always' }, // labels never hide behind columns
      updateTriggers: { getPosition: mpp },
    }),
  ]
}

// --- Rain radar -----------------------------------------------------------

let radarFrames: Radar['frames'] = []
let radarOn = true
let radarIndex = 0
const RADAR_OPACITY = 0.72

export async function setRadar(r: Radar): Promise<void> {
  await styleReady
  const want = new Set(r.frames.map(f => f.url))
  for (const f of radarFrames) {
    if (want.has(f.url)) continue
    map.removeLayer(f.url)
    map.removeSource(f.url)
  }
  for (const f of r.frames) {
    if (map.getSource(f.url)) continue
    map.addSource(f.url, { type: 'image', url: f.url, coordinates: r.bounds as [[number, number], [number, number], [number, number], [number, number]] })
    map.addLayer(
      {
        id: f.url,
        type: 'raster',
        source: f.url,
        paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 0 }, 'raster-fade-duration': 0 },
      },
      'buildings',
    )
  }
  radarFrames = r.frames
  radarIndex = Math.min(radarIndex, radarFrames.length - 1)
}

export function setRadarVisible(on: boolean): void {
  radarOn = on
}

// Steps through the frames, holding on the newest for a beat. Returns the
// time of the frame now on screen.
export function stepRadar(): string | null {
  if (!radarFrames.length) return null
  const hold = 4
  radarIndex = (radarIndex + 1) % (radarFrames.length + hold)
  const shown = Math.min(radarIndex, radarFrames.length - 1)
  radarFrames.forEach((f, i) => map.setPaintProperty(f.url, 'raster-opacity', radarOn && i === shown ? RADAR_OPACITY : 0))
  return radarFrames[shown].time
}

// --- Intro ----------------------------------------------------------------

styleReady.then(() => setTimeout(() => fly('city', 4200), reducedMotion ? 0 : 600))

// --- Tooltips -------------------------------------------------------------

const esc = (s: string): string => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const ago = (t: number): string => {
  const s = Math.max(0, Math.round(Date.now() / 1000 - t))
  return s < 90 ? `${s}s ago` : `${Math.round(s / 60)} min ago`
}

function tooltip({ object, layer }: PickingInfo) {
  if (!object) return null
  let html = ''
  if (layer?.id === 'vehicles') {
    const t = object as Track
    const m = MODES[t.mode]
    html = `<div class="tip-head"><span class="badge" style="--c:rgb(${m.rgb.join(' ')})">${m.letter}</span>${esc(t.route || m.name)}</div>
      ${t.label ? `<div class="tip-body">${esc(t.label)}</div>` : ''}
      <div class="tip-meta">GPS fix ${ago(t.pts[t.pts.length - 1])}</div>`
  } else if (layer?.id === 'stations') {
    const s = object as Station
    html = `<div class="tip-head">${esc(s.name)}</div>
      <div class="tip-body"><b>${s.temp}°</b> feels ${s.feels ?? '–'}°</div>
      <div class="tip-meta">${esc(s.windDir ?? '')} ${s.wind ?? '–'} km/h · ${s.humidity ?? '–'}% · ${s.rain ?? 0} mm since 9am</div>`
  }
  // Blank deck.gl's inline colours so the .tip stylesheet applies.
  return { html, className: 'tip', style: { backgroundColor: '', color: '', padding: '' } }
}
