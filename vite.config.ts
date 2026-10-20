import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['water-drop.svg'],
      manifest: {
        name: 'Watermind · Seguimiento de hidratación',
        short_name: 'Watermind',
        description: 'Un espacio amable para seguir tu hidratación diaria.',
        theme_color: '#f6f9fb',
        background_color: '#f6f9fb',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/water-drop.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
})
