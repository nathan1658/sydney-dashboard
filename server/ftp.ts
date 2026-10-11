// The Bureau of Meteorology's anonymous FTP server is its published channel
// for automated access (the website rejects non-browser clients). Requests
// are queued so we never hold more than one connection at a time.
import { Client } from 'basic-ftp'
import { Writable } from 'node:stream'

let queue: Promise<unknown> = Promise.resolve()

export function bomFtp<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const c = new Client(20_000)
    try {
      await c.access({ host: 'ftp.bom.gov.au' })
      return await fn(c)
    } finally {
      c.close()
    }
  })
  queue = run.catch(() => {})
  return run
}

export async function download(c: Client, path: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk)
      done()
    },
  })
  await c.downloadTo(sink, path)
  return Buffer.concat(chunks)
}

// A glob that matches nothing is an FTP error, not an empty list.
export async function list(c: Client, glob: string): Promise<string[]> {
  try {
    return (await c.list(glob)).map(f => f.name).sort()
  } catch {
    return []
  }
}
