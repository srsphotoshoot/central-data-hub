import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/cdh-api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cdh-api/, ''),
        // Without a timeout, a slow/stuck backend leaves proxied connections
        // open indefinitely. Over hours of the dev server staying up across
        // backend restarts, these piled up into hundreds of stuck sockets
        // that pegged the backend's CPU and made it unresponsive — this is
        // the same class of fix already applied to nginx's /cdh-api/ block.
        timeout: 10000,
        proxyTimeout: 10000
      }
    }
  }
})
