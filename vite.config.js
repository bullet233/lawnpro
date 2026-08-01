import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/lawnpro/',   // ← must match your GitHub repo name exactly
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // The embedded Lawn Measure tool loads in an iframe (a navigation
        // request). Without this, the SW's SPA navigate-fallback serves the
        // React app INTO that iframe instead of lawn-measure/index.html.
        navigateFallbackDenylist: [/\/lawn-measure\//],
      },
      manifest: {
        name: 'Lawn Route Tracker',
        short_name: 'Lawn Tracker',
        description: 'Solo lawn care routing and tracking application',
        theme_color: '#10b981', // Emerald 500
        background_color: '#f8fafc',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
})
