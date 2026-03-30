import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

/**
 * In dev, mirrors published grid snapshots from the builder (Mac) into memory on the Vite process.
 * Phones on the same LAN poll GET and apply to their own localStorage + grid event — localStorage
 * alone cannot sync across devices.
 */
function devRuntimeGridRelayPlugin(): Plugin {
  let lastPayload = ''
  return {
    name: 'iki-dev-runtime-grid-relay',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathOnly = req.url?.split('?')[0] ?? ''
        if (pathOnly !== '/__iki/dev-runtime-packages') {
          next()
          return
        }
        if (req.method === 'GET') {
          res.statusCode = 200
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(lastPayload)
          return
        }
        if (req.method === 'POST') {
          const chunks: Buffer[] = []
          req.on('data', (chunk: Buffer) => {
            chunks.push(chunk)
          })
          req.on('end', () => {
            lastPayload = Buffer.concat(chunks).toString('utf8')
            res.statusCode = 204
            res.end()
          })
          req.on('error', () => {
            res.statusCode = 500
            res.end()
          })
          return
        }
        res.statusCode = 405
        res.end()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devRuntimeGridRelayPlugin()],
  server: {
    // Listen on all interfaces so phones/tablets on the same LAN can open http://<your-mac-ip>:5173
    host: true,
    port: 5173,
  },
})
