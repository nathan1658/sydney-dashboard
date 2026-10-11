import { spawn } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'

const API_PORT = 8788

// `npm run dev` also runs the live API locally (the Worker and its Durable
// Object under `wrangler dev`, which reads TFNSW_API_KEY from .env).
function liveApi(): Plugin {
  return {
    name: 'live-api',
    apply: 'serve',
    configureServer(server) {
      const api = spawn('npx', ['wrangler', 'dev', '--port', String(API_PORT)], { stdio: 'inherit' })
      server.httpServer?.on('close', () => api.kill())
    },
  }
}

export default defineConfig({
  plugins: [liveApi()],
  server: {
    port: 8787,
    strictPort: true,
    proxy: { '/api': `http://localhost:${API_PORT}` },
  },
})
