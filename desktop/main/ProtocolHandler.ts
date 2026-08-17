import { app, protocol, net } from 'electron'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { existsSync } from 'fs'

const PROTOCOL = 'ahram'

let activeDistDir: string | null = null

export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

export function setActiveRendererDirectory(dir: string | null): void {
  activeDistDir = dir
  console.log('[Protocol] Active renderer:', dir || '(bundled)')
}

export function registerProtocolHandler(): void {
  const bundledDistDir = app.isPackaged
    ? path.join(process.resourcesPath, 'dist')
    : path.resolve(__dirname, '..', '..', '..', 'dist')

  protocol.handle(PROTOCOL, (request) => {
    const url = new URL(request.url)
    let filePath = decodeURIComponent(url.pathname)

    // Strip /store prefix (matches Vite base)
    filePath = filePath.replace(/^\/store/, '')

    // SPA fallback — serve index.html for non-file routes
    const hasExtension = path.extname(filePath) !== ''
    if (!hasExtension || filePath === '/' || filePath === '') {
      filePath = '/index.html'
    }

    // Check for updated renderer from auto-update cache
    if (activeDistDir) {
      const fullPath = path.join(activeDistDir, filePath)
      if (existsSync(fullPath)) {
        return net.fetch(pathToFileURL(fullPath).toString())
      }
    }

    const fullPath = path.join(bundledDistDir, filePath)
    return net.fetch(pathToFileURL(fullPath).toString())
  })
}

export function getAppURL(): string {
  return `${PROTOCOL}://app/store/`
}
