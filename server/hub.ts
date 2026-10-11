// Server-Sent Events fan-out. Each topic keeps its latest payload so a new
// browser gets the full picture the moment it connects.
import type { ServerResponse } from 'node:http'

const topics = new Map<string, () => string>()
const clients = new Set<ServerResponse>()

export const hasClients = (): boolean => clients.size > 0

// `snapshot` lets a topic hand new subscribers more than the incremental
// update (vehicles send full trails on connect, then only fresh positions).
export function publish(topic: string, update: unknown, snapshot?: () => unknown): void {
  const data = JSON.stringify(update)
  topics.set(topic, snapshot ? () => JSON.stringify(snapshot()) : () => data)
  for (const res of clients) send(res, topic, data)
}

export function subscribe(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write('retry: 3000\n\n')
  for (const [topic, snapshot] of topics) send(res, topic, snapshot())
  clients.add(res)
  res.on('close', () => clients.delete(res))
}

function send(res: ServerResponse, topic: string, data: string): void {
  res.write(`event: ${topic}\ndata: ${data}\n\n`)
}

// Comment frames keep idle connections alive through proxies.
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n')
}, 25_000).unref()
