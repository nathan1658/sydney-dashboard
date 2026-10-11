// One Server-Sent Events stream carries every topic. EventSource reconnects
// on its own; the server replays the latest state on each (re)connect.
import type { Alert, Forecast, Health, Punctuality, Radar, Station, Warning, WireTrack } from '../server/types.ts'

// The live API's origin: empty in dev (Vite proxies /api), the Worker's URL in
// production builds (VITE_API_ORIGIN in .env.production).
export const api = (path: string): string => (import.meta.env.VITE_API_ORIGIN ?? '') + path

export type Topics = {
  vehicles: WireTrack[]
  punctuality: Punctuality[]
  alerts: Alert[]
  observations: Station[]
  forecast: Forecast
  warnings: Warning[]
  radar: Radar
  feeds: Health[]
}

type Handlers = { [K in keyof Topics]: (data: Topics[K]) => void }

export function connect(handlers: Handlers, onConnection: (live: boolean) => void): void {
  const source = new EventSource(api('/api/live'))
  for (const topic of Object.keys(handlers) as (keyof Topics)[]) {
    source.addEventListener(topic, e => (handlers[topic] as (d: unknown) => void)(JSON.parse((e as MessageEvent).data)))
  }
  source.onopen = () => onConnection(true)
  source.onerror = () => onConnection(false)
}
