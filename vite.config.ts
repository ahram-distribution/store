import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'

const certPath = '.certs/dev-cert.pem'
const keyPath = '.certs/dev-key.pem'
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath)
const isMobileBuild = process.env.MOBILE_BUILD === 'true'

export default defineConfig({
  server: {
    host: '0.0.0.0',
    ...(hasCerts
      ? {
          https: {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath),
          },
        }
      : {}),
  },

  plugins: [
    react(),
    tailwindcss(),

    ...(isMobileBuild
      ? []
      : [
          VitePWA({
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.ts',
            registerType: 'autoUpdate',

            includeAssets: ['pwa/**/*'],

            manifest: {
              name: 'شركة الأهرام للتجارة والتوزيع',
              short_name: 'الأهرام',
              description: 'نظام تشغيل متكامل للتوزيع والمبيعات',

              theme_color: '#0B3D91',
              background_color: '#0B3D91',

              display: 'standalone',
              orientation: 'portrait',

              start_url: '/ahram-distribution/',
              scope: '/ahram-distribution/',

              lang: 'ar',
              dir: 'rtl',

              categories: ['business', 'shopping'],
              prefer_related_applications: false,

              icons: [
                {
                  src: 'pwa/icons/icon-192x192.png',
                  sizes: '192x192',
                  type: 'image/png',
                },
                {
                  src: 'pwa/icons/icon-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                },
                {
                  src: 'pwa/icons/maskable-192x192.png',
                  sizes: '192x192',
                  type: 'image/png',
                  purpose: 'maskable',
                },
                {
                  src: 'pwa/icons/maskable-512x512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
              ],
            },

            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
            },
          }),
        ]),
  ],

  base: isMobileBuild ? './' : '/ahram-distribution/',
})
