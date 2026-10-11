// Polls each upstream feed on its own cadence, but only while someone is
// watching: no open dashboards means no upstream requests and no API quota.
import { hasClients, publish } from './hub.ts'

export type Job = {
  name: string
  every: number // seconds
  run: () => Promise<unknown>
  snapshot?: () => unknown
}

export type Health = { name: string; ok: boolean; at: number; error?: string }

const health = new Map<string, Health>()

export const feedHealth = (): Health[] => [...health.values()]

export function start(jobs: Job[]): void {
  const last = new Map<string, number>()
  const busy = new Set<string>()

  setInterval(() => {
    if (!hasClients()) return
    for (const job of jobs) {
      if (busy.has(job.name) || Date.now() - (last.get(job.name) ?? 0) < job.every * 1000) continue
      busy.add(job.name)
      job
        .run()
        .then(data => {
          publish(job.name, data, job.snapshot)
          report(job.name)
        })
        .catch((err: unknown) => report(job.name, err))
        .finally(() => {
          last.set(job.name, Date.now())
          busy.delete(job.name)
        })
    }
  }, 1000)
}

function report(name: string, err?: unknown): void {
  const error = err instanceof Error ? err.message : err === undefined ? undefined : String(err)
  if (error) console.warn(`[${name}] ${error}`)
  health.set(name, { name, ok: !error, at: Date.now(), error })
  publish('feeds', feedHealth())
}
