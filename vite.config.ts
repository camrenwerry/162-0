import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'Pennant Pursuit',
        short_name: 'Pennant Pursuit',
        description: 'Build the greatest roster in baseball history.',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#0D1117',
        theme_color: '#0D1117',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp}'],
        globIgnores: [
          '**/assets/ClassicMode-*.js',
          'branding/pennant-pursuit-master.png',
          'branding/pennant-pursuit-logo.png',
          'branding/pennant-pursuit-logo-dark.webp',
          'branding/pennant-pursuit-logo-light.webp',
          'branding/pennant-pursuit-promotional-square.png',
          'pennant-pursuit-icon-source.png',
          'branding/pennant-pursuit-favicon-mark.png',
          'icons.svg',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'maskable-icon-512x512.png',
        ],
      },
    }),
  ],
})
