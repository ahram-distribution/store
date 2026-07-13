import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const certPath = '.certs/dev-cert.pem'
const keyPath = '.certs/dev-key.pem'
const hasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath)
const isMobileBuild = process.env.MOBILE_BUILD === 'true'

const pwaManifest = {
  name: 'شركة الأهرام للتجارة والتوزيع',
  short_name: 'الأهرام',
  description: 'نظام تشغيل متكامل للتوزيع والمبيعات',
  theme_color: '#0B3D91',
  background_color: '#0B3D91',
  display: 'standalone',
  orientation: 'portrait',
  start_url: '/store/',
  scope: '/store/',
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
  base: isMobileBuild ? './' : '/store/',
  define: {
    __BUILD_ID__: JSON.stringify(process.env.BUILD_ID || 'dev'),
    __COMMIT_HASH__: JSON.stringify(process.env.COMMIT_HASH || 'dev'),
  },
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
            injectManifest: {
              maximumFileSizeToCacheInBytes: 5_000_000,
            },
          }),
        ]),
    {
      name: 'generate-404',
      closeBundle() {
        if (isMobileBuild) return
        const distDir = path.resolve(__dirname, 'dist')
        const indexPath = path.join(distDir, 'index.html')
        if (!fs.existsSync(indexPath)) return
        fs.copyFileSync(indexPath, path.join(distDir, '404.html'))
      },
    },
    {
      name: 'build-manifest',
      closeBundle() {
        if (isMobileBuild) return
        const distDir = path.resolve(__dirname, 'dist')
        const assetsDir = path.join(distDir, 'assets')
        if (!fs.existsSync(assetsDir)) return
        const assets: Record<string, string> = {}
        for (const file of fs.readdirSync(assetsDir)) {
          const fullPath = path.join(assetsDir, file)
          if (fs.statSync(fullPath).isFile()) {
            const content = fs.readFileSync(fullPath)
            assets[file] = crypto.createHash('sha256').update(content).digest('hex')
          }
        }
        const manifest = {
          build_id: process.env.BUILD_ID || 'dev',
          commit_hash: process.env.COMMIT_HASH || 'dev',
          build_date: new Date().toISOString(),
          assets,
        }
        fs.writeFileSync(path.join(distDir, 'build-manifest.json'), JSON.stringify(manifest, null, 2))
      },
    },
   ],
})