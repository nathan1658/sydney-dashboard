// One Server-Sent Events stream carries every topic. EventSource reconnects
// on its own; the server replays the latest state on each (re)connect.
import type { Day, Radar, Station, Warning } from '../server/bom.ts'
import type { Health } from '../server/jobs.ts'
import type { Alert, Punctuality, WireTrack } from '../server/tfnsw.ts'

export type Topics = {
  vehicles: WireTrack[]
  punctuality: Punctuality[]
  alerts: Alert[]
  observations: Station[]
  forecast: { issued: string; days: Day[] }
  warnings: Warning[]
  radar: Radar
  feeds: Health[]
}

type Handlers = { [K in keyof Topics]: (data: Topics[K]) => void }

export function connect(handlers: Handlers, onConnection: (live: boolean) => void): void {
  const source = new EventSource('/api/live')
  for (const topic of Object.keys(handlers) as (keyof Topics)[]) {
    source.addEventListener(topic, e => (handlers[topic] as (d: unknown) => void)(JSON.parse((e as MessageEvent).data)))
  }
  source.onopen = () => onConnection(true)
  source.onerror = () => onConnection(false)
}
