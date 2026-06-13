import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import path from 'path'

const certPath = '.certs/dev-cert.pem'
const keyPath = '.certs/dev-key.pem'
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath)
const isMobileBuild = process.env.MOBILE_BUILD === 'true'
const basePath = process.env.VITE_BASE_PATH || '/'

const pwaManifest = {
  name: 'شركة الأهرام للتجارة والتوزيع',
  short_name: 'الأهرام',
  description: 'نظام تشغيل متكامل للتوزيع والمبيعات',
  theme_color: '#0B3D91',
  background_color: '#0B3D91',
  display: 'standalone',
  orientation: 'portrait',
  start_url: basePath,
  scope: basePath,
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
}

export default defineConfig({
  base: isMobileBuild ? './' : basePath,
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
            manifest: pwaManifest,
            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
            },
          }),
        ]),
    {
      name: 'generate-404',
      closeBundle() {
        if (isMobileBuild) return
        const distDir = path.resolve(__dirname, 'dist')
        const indexPath = path.join(distDir, 'index.html')
        const fourOhFourPath = path.join(distDir, '404.html')
        if (!fs.existsSync(indexPath)) return
        let html = fs.readFileSync(indexPath, 'utf-8')
        const redirectScript =
          `<script>(function(){var p=location.pathname+location.search+location.hash;sessionStorage.setItem('gh_pages_redirect',p);location.replace('${basePath}');})();</script>`
        html = html.replace('</head>', redirectScript + '</head>')
        fs.writeFileSync(fourOhFourPath, html)
      },
    },
   ],
})