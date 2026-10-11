// Server-Sent Events fan-out. Each topic keeps its latest payload so a new
// browser gets the full picture the moment it connects.
type Client = WritableStreamDefaultWriter<Uint8Array>

const topics = new Map<string, () => string>()
const clients = new Set<Client>()
const enc = new TextEncoder()

export const hasClients = (): boolean => clients.size > 0

// `snapshot` lets a topic hand new subscribers more than the incremental
// update (vehicles send full trails on connect, then only fresh positions).
export function publish(topic: string, update: unknown, snapshot?: () => unknown): void {
  const data = JSON.stringify(update)
  topics.set(topic, snapshot ? () => JSON.stringify(snapshot()) : () => data)
  for (const c of clients) send(c, frame(topic, data))
}

export function subscribe(): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const c = writable.getWriter()
  send(c, 'retry: 3000\n\n')
  for (const [topic, snapshot] of topics) send(c, frame(topic, snapshot()))
  clients.add(c)
  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  })
}

// Comment frames keep idle connections alive through proxies.
export function ping(): void {
  for (const c of clients) send(c, ': ping\n\n')
}

const frame = (topic: string, data: string): string => `event: ${topic}\ndata: ${data}\n\n`

// A browser that went away makes the write fail; that is our disconnect.
function send(c: Client, text: string): void {
  c.write(enc.encode(text)).catch(() => clients.delete(c))
}
