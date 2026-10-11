// The two rails (weather, transport), the feed status and the clock. Each
// section re-renders from its own slice of state; upstream text is escaped.
import type { Alert, Day, Health, Mode, Punctuality, Station, Warning } from '../server/types.ts'
import { forecastIcon } from './icons.ts'
import { MODE_ORDER, MODES } from './modes.ts'
import { tempGradient } from './temperature.ts'
import { tracks } from './vehicles.ts'

const TZ = 'Australia/Sydney'
const PRIMARY_STATION = '94768' // Sydney (Observatory Hill), the city's reference station

const state = {
  stations: [] as Station[],
  forecast: [] as Day[],
  warnings: [] as Warning[],
  // null until the feed has answered at least once: no data is not good news.
  alerts: null as Alert[] | null,
  vehiclesSeen: false,
  punctuality: [] as Punctuality[],
  feeds: [] as Health[],
  focus: null as Mode | null,
}

const $ = (id: string): HTMLElement => document.getElementById(id)!
const esc = (s: string): string => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const time = (iso: string | number, opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }): string =>
  new Intl.DateTimeFormat('en-AU', { timeZone: TZ, ...opts }).format(new Date(typeof iso === 'number' ? iso * 1000 : iso))
const one = (x: number | null, unit = ''): string => (x === null ? '–' : `${x.toFixed(1)}${unit}`)
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

// Live updates replace a section's markup. Elements tagged data-key keep
// their keyboard focus and open/closed state across the swap.
function patch(el: HTMLElement, html: string): void {
  const active = document.activeElement
  const focusKey = el.contains(active) ? active?.closest<HTMLElement>('[data-key]')?.dataset.key : undefined
  const open = new Set([...el.querySelectorAll<HTMLElement>('details[open][data-key]')].map(d => d.dataset.key))
  el.innerHTML = html
  for (const d of el.querySelectorAll<HTMLDetailsElement>('details[data-key]')) d.open = open.has(d.dataset.key)
  if (!focusKey) return
  const target = el.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)
  ;(target instanceof HTMLDetailsElement ? target.querySelector('summary') : target)?.focus()
}

// --- Weather --------------------------------------------------------------

export function setObservations(s: Station[]): void {
  state.stations = s
  renderNow()
}
export function setForecast(f: { days: Day[] }): void {
  state.forecast = f.days
  renderNow()
  renderForecast()
}
export function setWarnings(w: Warning[]): void {
  state.warnings = w
  renderWarnings()
}

function renderNow(): void {
  const s = state.stations.find(x => x.id === PRIMARY_STATION)
  if (!s) return
  const today = state.forecast[0]
  const temps = state.stations.filter(x => x.temp !== null).sort((a, b) => a.temp! - b.temp!)
  const [cool, warm] = [temps[0], temps[temps.length - 1]]
  $('now').innerHTML = `
    <p class="eyebrow">Observatory Hill <span>${time(s.time)}</span></p>
    <p class="temp">${one(s.temp)}<span>°C</span></p>
    <p class="summary">${today ? esc(today.summary) : ''} <span>Feels like ${one(s.feels, '°')}</span></p>
    <dl class="facts">
      <div><dt>Wind</dt><dd>${esc(s.windDir ?? '')} ${s.wind ?? '–'}<small> km/h</small></dd></div>
      <div><dt>Humidity</dt><dd>${s.humidity ?? '–'}<small>%</small></dd></div>
      <div><dt>Rain since 9am</dt><dd>${one(s.rain)}<small> mm</small></dd></div>
      <div><dt>Today so far</dt><dd>${one(s.min, '°')} – ${one(s.max, '°')}</dd></div>
    </dl>
    ${temps.length > 1 ? `<p class="spread">Across ${temps.length} stations, <b>${one(cool.temp, '°')}</b> ${esc(cool.name)} to <b>${one(warm.temp, '°')}</b> ${esc(warm.name)}</p>` : ''}`
}

function renderForecast(): void {
  const days = state.forecast
  const temps = days.flatMap(d => [d.min, d.max]).filter((t): t is number => t !== null)
  if (!temps.length) return
  const lo = Math.min(...temps)
  const hi = Math.max(...temps)
  const pct = (t: number) => ((t - lo) / (hi - lo || 1)) * 100
  $('forecast').innerHTML = `
    <h2>Seven days</h2>
    <ol>${days
      .map((d, i) => {
        // Late in the day BoM drops today's temperatures: no bar, no stray degree sign.
        const min = d.min ?? d.max
        const max = d.max ?? d.min
        const name = i === 0 ? 'Today' : time(d.date, { weekday: 'short' })
        return `<li title="${esc(d.summary)}">
          <span class="day">${name}</span>
          <span class="icon">${forecastIcon(d.icon)}</span>
          <span class="lo">${d.min ?? ''}</span>
          <span class="range">${min === null || max === null ? '' : `<i style="left:${pct(min)}%;right:${100 - pct(max)}%;background:${tempGradient(min, max)}"></i>`}</span>
          <span class="hi">${d.max === null ? '' : `${d.max}°`}</span>
          <span class="pop">${d.rainChance ? `${d.rainChance}%` : ''}</span>
        </li>`
      })
      .join('')}</ol>`
}

function renderWarnings(): void {
  const local = state.warnings.filter(w => w.sydney)
  const rest = state.warnings.filter(w => !w.sydney)
  const item = (w: Warning) =>
    `<li><a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.headline)}</a><small>Until ${time(w.expires, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small></li>`
  patch($('warnings'), `
    <h2>Warnings</h2>
    ${local.length ? `<ul class="warn-list is-local">${local.map(item).join('')}</ul>` : '<p class="quiet">No warnings for Sydney.</p>'}
    ${rest.length ? `<details data-key="elsewhere"><summary>${plural(rest.length, 'warning')} elsewhere in NSW</summary><ul class="warn-list">${rest.map(item).join('')}</ul></details>` : ''}`)
}

// --- Transport ------------------------------------------------------------

const EFFECTS: Record<string, [label: string, rank: number]> = {
  NO_SERVICE: ['No service', 0],
  REDUCED_SERVICE: ['Reduced service', 0],
  SIGNIFICANT_DELAYS: ['Delays', 0],
  DETOUR: ['Detour', 1],
  MODIFIED_SERVICE: ['Changed service', 1],
  STOP_MOVED: ['Stop moved', 1],
  ADDITIONAL_SERVICE: ['Extra service', 2],
  ACCESSIBILITY_ISSUE: ['Accessibility', 2],
}
const effect = (a: Alert): [string, number] => EFFECTS[a.effect] ?? ['Notice', 2]

let onFocus: (mode: Mode | null) => void = () => {}
export function handleFocus(fn: (mode: Mode | null) => void): void {
  onFocus = fn
}

export function setAlerts(a: Alert[]): void {
  state.alerts = a.sort((x, y) => effect(x)[1] - effect(y)[1] || (y.start ?? 0) - (x.start ?? 0))
  renderModes()
  renderAlerts()
}
export function setPunctuality(p: Punctuality[]): void {
  state.punctuality = p
  renderModes()
}
export function setVehicles(): void {
  state.vehiclesSeen = true
  renderModes()
}

function status(mode: Mode): [text: string, tone: string] {
  if (!state.alerts) return ['', '']
  const alerts = state.alerts.filter(a => a.mode === mode)
  const severe = alerts.filter(a => effect(a)[1] === 0).length
  const changes = alerts.filter(a => effect(a)[1] === 1).length
  if (severe) return [plural(severe, 'disruption'), 'is-severe']
  if (changes) return [plural(changes, 'change'), 'is-change']
  return ['Good service', 'is-good']
}

function renderModes(): void {
  const counts = new Map<Mode, number>()
  for (const t of tracks.values()) counts.set(t.mode, (counts.get(t.mode) ?? 0) + 1)
  const offline = !state.vehiclesSeen && state.feeds.find(f => f.name === 'vehicles' && !f.ok)?.error

  patch($('modes'), `
    <h2>Network now</h2>
    ${offline ? `<p class="offline">Live transport is offline: ${esc(offline)}</p>` : ''}
    <ul>${MODE_ORDER.map(mode => {
      const m = MODES[mode]
      const [text, tone] = status(mode)
      const p = state.punctuality.find(x => x.mode === mode)
      const onTime = p?.running ? Math.round((p.onTime / p.running) * 100) : null
      return `<li><button class="mode" data-mode="${mode}" data-key="${mode}" aria-pressed="${state.focus === mode}" style="--c:rgb(${m.rgb.join(' ')})">
        <span class="badge">${m.letter}</span>
        <span class="name">${m.name}</span>
        <span class="count">${state.vehiclesSeen ? (counts.get(mode) ?? 0) : '–'}<small>live</small></span>
        <span class="status ${tone}">${text}</span>
        ${onTime === null ? '' : `<span class="ontime"><span class="meter"><i style="width:${onTime}%"></i></span>${onTime}% on time${p!.cancelled ? ` · ${p!.cancelled} cancelled` : ''}</span>`}
      </button></li>`
    }).join('')}</ul>`)
}

function renderAlerts(): void {
  if (!state.alerts) return
  const list = state.alerts.filter(a => !state.focus || a.mode === state.focus)
  const shown = list.slice(0, 60)
  const scope = state.focus ? MODES[state.focus].name : 'All modes'
  patch($('alerts'), `
    <h2>Service alerts <span>${scope} · ${list.length}</span></h2>
    ${shown.length ? `<ul>${shown.map(a => {
      const m = MODES[a.mode]
      const [label, rank] = effect(a)
      return `<li><details data-key="${esc(a.id)}">
        <summary><span class="badge" style="--c:rgb(${m.rgb.join(' ')})">${m.letter}</span><span class="effect rank-${rank}">${label}</span><span class="title">${esc(a.title)}</span></summary>
        <p>${esc(a.detail)}</p>
        ${a.end ? `<small>Until ${time(a.end, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</small>` : ''}
        ${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">Details</a>` : ''}
      </details></li>`
    }).join('')}</ul>${list.length > shown.length ? `<p class="quiet">${list.length - shown.length} more not shown.</p>` : ''}`
      : '<p class="quiet">No current alerts.</p>'}`)
}

document.addEventListener('click', e => {
  const button = (e.target as Element).closest<HTMLButtonElement>('button.mode')
  if (!button) return
  const mode = button.dataset.mode as Mode
  state.focus = state.focus === mode ? null : mode
  onFocus(state.focus)
  renderModes()
  renderAlerts()
})

// --- Status ---------------------------------------------------------------

const FEED_NAMES: Record<string, string> = {
  vehicles: 'Vehicle positions',
  punctuality: 'Trip updates',
  alerts: 'Service alerts',
  observations: 'Observations',
  radar: 'Rain radar',
  warnings: 'Warnings',
  forecast: 'Forecast',
}

export function setFeeds(f: Health[]): void {
  state.feeds = f
  const bad = f.filter(x => !x.ok)
  $('feeds').innerHTML = `
    <summary class="${bad.length ? 'has-errors' : ''}">${bad.length ? `${bad.length} of ${f.length} feeds failing` : `${f.length} feeds live`}</summary>
    <ul>${f.map(x => `<li class="${x.ok ? '' : 'is-error'}"><b>${FEED_NAMES[x.name] ?? esc(x.name)}</b> ${x.ok ? `updated ${time(x.at / 1000, { hour: 'numeric', minute: '2-digit', second: '2-digit' })}` : esc(x.error ?? 'error')}</li>`).join('')}</ul>`
  renderModes()
}

export function setConnected(live: boolean): void {
  const el = $('conn')
  el.textContent = live ? 'Live' : 'Reconnecting'
  el.classList.toggle('is-live', live)
}

export function setRadarTime(iso: string | null): void {
  $('radar-time').textContent = iso ? time(iso) : ''
}

const clock = (): void => {
  $('clock').textContent = time(Date.now() / 1000, { weekday: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' })
}
clock()
setInterval(clock, 1000)
