import { app, protocol, net } from 'electron'
import * as path from 'path'
import { pathToFileURL } from 'url'

const PROTOCOL = 'ahram'

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

export function registerProtocolHandler(): void {
  const distDir = app.isPackaged
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

    const fullPath = path.join(distDir, filePath)
    return net.fetch(pathToFileURL(fullPath).toString())
  })
}

export function getAppURL(): string {
  return `${PROTOCOL}://app/store/`
}
