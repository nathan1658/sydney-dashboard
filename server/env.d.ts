// Bindings from wrangler.jsonc plus the TFNSW_API_KEY secret. Augmenting
// Cloudflare.Env types both the fetch handler's `env` and `cloudflare:workers`.
declare namespace Cloudflare {
  interface Env {
    LIVE: DurableObjectNamespace<import('./worker.ts').Live>
    TFNSW_API_KEY?: string
  }
}
interface Env extends Cloudflare.Env {}
