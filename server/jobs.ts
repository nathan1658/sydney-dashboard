// Polls each upstream feed on its own cadence. The Durable Object calls
// tick() from its alarm and sleeps until the next job is due, but only while
// someone is watching: no open dashboards means no upstream requests.
import { publish } from './hub.ts'
import type { Health } from './types.ts'

export type Job = {
  name: string
  every: number // seconds
  run: () => Promise<unknown>
  snapshot?: () => unknown
}

const last = new Map<string, number>()
const health = new Map<string, Health>()

export const feedHealth = (): Health[] => [...health.values()]

// Runs every due job (together) and returns when the next one falls due.
export async function tick(jobs: Job[]): Promise<number> {
  const now = Date.now()
  const due = jobs.filter(j => now - (last.get(j.name) ?? 0) >= j.every * 1000)
  await Promise.all(due.map(run))
  return Math.min(...jobs.map(j => (last.get(j.name) ?? 0) + j.every * 1000))
}

async function run(job: Job): Promise<void> {
  try {
    publish(job.name, await job.run(), job.snapshot)
    report(job.name)
  } catch (err) {
    report(job.name, err)
  } finally {
    last.set(job.name, Date.now())
  }
}

function report(name: string, err?: unknown): void {
  const error = err instanceof Error ? err.message : err === undefined ? undefined : String(err)
  if (error) console.warn(`[${name}] ${error}`)
  health.set(name, { name, ok: !error, at: Date.now(), error })
  publish('feeds', feedHealth())
}
