// The Bureau of Meteorology's anonymous FTP server is its published channel
// for automated access (the website rejects non-browser clients). A minimal
// passive-mode client over Workers TCP sockets: log in, then one data
// connection per transfer. Sessions are queued so we hold one at a time.
import { connect } from 'cloudflare:sockets'

type Socket = ReturnType<typeof connect>

const HOST = 'ftp.bom.gov.au'
const SESSION_MS = 60_000

const enc = new TextEncoder()
const dec = new TextDecoder()

let queue: Promise<unknown> = Promise.resolve()

export function bomFtp<T>(fn: (c: Ftp) => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const c = new Ftp(connect({ hostname: HOST, port: 21 }))
    const deadline = setTimeout(() => c.close(), SESSION_MS) // a stalled read then fails instead of hanging
    try {
      await c.login()
      return await fn(c)
    } finally {
      clearTimeout(deadline)
      c.close()
    }
  })
  queue = run.catch(() => {})
  return run
}

export class Ftp {
  private control: Socket
  private reader: ReadableStreamDefaultReader<Uint8Array>
  private writer: WritableStreamDefaultWriter<Uint8Array>
  private buf = ''
  private data: Socket | null = null

  constructor(control: Socket) {
    this.control = control
    this.reader = control.readable.getReader()
    this.writer = control.writable.getWriter()
  }

  async login(): Promise<void> {
    await this.expect(220)
    if ((await this.send('USER anonymous'))[0] === 331) await this.cmd('PASS anonymous@', 230)
    await this.cmd('TYPE I', 200)
  }

  async download(path: string): Promise<Uint8Array> {
    const body = await this.transfer(`RETR ${path}`)
    if (!body) throw new Error(`FTP: no ${path}`)
    return body
  }

  async list(glob: string): Promise<string[]> {
    const body = await this.transfer(`NLST ${glob}`)
    const names = body ? dec.decode(body).split(/\r?\n/) : []
    return names.filter(Boolean).map(n => n.split('/').pop()!).sort()
  }

  close(): void {
    this.data?.close().catch(() => {})
    this.control.close().catch(() => {})
  }

  // Null when the server says there is no such file (or, for a glob, no match).
  private async transfer(line: string): Promise<Uint8Array | null> {
    const epsv = await this.cmd('EPSV', 229)
    const port = Number(/\(\|\|\|(\d+)\|\)/.exec(epsv)?.[1])
    const data = (this.data = connect({ hostname: HOST, port }))
    try {
      const [code, reply] = await this.send(line)
      if (code === 450 || code === 550) return null
      if (code !== 150 && code !== 125) throw new Error(`FTP ${reply}`)
      const body = await readAll(data.readable)
      await this.expect(226)
      return body
    } finally {
      data.close().catch(() => {})
      this.data = null
    }
  }

  private async cmd(line: string, ok: number): Promise<string> {
    const [code, text] = await this.send(line)
    if (code !== ok) throw new Error(`FTP ${line.split(' ')[0]}: ${text}`)
    return text
  }

  private async send(line: string): Promise<[number, string]> {
    await this.writer.write(enc.encode(line + '\r\n'))
    return this.reply()
  }

  private async expect(ok: number): Promise<void> {
    const [code, text] = await this.reply()
    if (code !== ok) throw new Error(`FTP: ${text}`)
  }

  // "123-" opens a multi-line reply that the first "123 " line closes.
  private async reply(): Promise<[number, string]> {
    let code = ''
    for (;;) {
      const nl = this.buf.indexOf('\n')
      if (nl < 0) {
        const { value, done } = await this.reader.read()
        if (done) throw new Error('FTP connection closed')
        this.buf += dec.decode(value, { stream: true })
        continue
      }
      const line = this.buf.slice(0, nl).replace(/\r$/, '')
      this.buf = this.buf.slice(nl + 1)
      code ||= line.slice(0, 3)
      if (line === code || line.startsWith(code + ' ')) return [Number(code), line]
    }
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  for await (const chunk of stream) chunks.push(chunk)
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}
