import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream, unlinkSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { createHash } from 'crypto'
import type { ReleaseManifest } from './ReleaseManifest'

const BASE_URL = 'https://ahram-distribution.github.io/store/'
const ASSETS_URL = 'https://ahram-distribution.github.io/store/assets/'
const ASSET_TIMEOUT_MS = 15000
const MAX_PARALLEL = 4

export interface DownloadResult {
  success: boolean
  downloaded: number
  failed: number
  errors: string[]
}

export async function downloadRendererAssets(
  manifest: ReleaseManifest,
  targetDir: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<DownloadResult> {
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true })

  const assetEntries = Object.entries(manifest.assets)
  const total = assetEntries.length
  let downloaded = 0
  let failed = 0
  const errors: string[] = []

  writeFileSync(join(targetDir, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  const extraFiles = [
    { name: 'index.html', isAsset: false },
    { name: 'build-manifest.json', isAsset: false },
  ]
  for (const ef of extraFiles) {
    if (!existsSync(join(targetDir, ef.name))) {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), ASSET_TIMEOUT_MS)
        const res = await fetch(`${BASE_URL}${ef.name}`, { signal: ctrl.signal })
        clearTimeout(timer)
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer())
          writeFileSync(join(targetDir, ef.name), buf)
        }
      } catch { /* non-fatal */ }
    }
  }

  for (let i = 0; i < assetEntries.length; i += MAX_PARALLEL) {
    const batch = assetEntries.slice(i, i + MAX_PARALLEL)
    const results = await Promise.allSettled(
      batch.map(([filename, expectedHash]) =>
        downloadAsset(filename, expectedHash, targetDir)
      )
    )
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        downloaded++
      } else {
        failed++
        const reason = r.status === 'rejected' ? String(r.reason) : 'hash mismatch'
        errors.push(reason)
      }
    }
    onProgress?.(downloaded + failed, total)
  }

  return {
    success: failed === 0 && downloaded > 0,
    downloaded,
    failed,
    errors,
  }
}

async function downloadAsset(
  filename: string,
  expectedHash: string,
  targetDir: string,
): Promise<boolean> {
  const filePath = join(targetDir, 'assets', filename)
  const dir = join(targetDir, 'assets', ...filename.split('/').slice(0, -1))
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })

  const url = `${ASSETS_URL}${filename}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ASSET_TIMEOUT_MS)

  try {
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const buffer = Buffer.from(await res.arrayBuffer())

    const hash = createHash('sha256').update(buffer).digest('hex')
    const expectedClean = expectedHash.replace(/^sha256:/, '')
    if (hash !== expectedClean) {
      throw new Error(`Hash mismatch for ${filename}: got ${hash}, expected ${expectedClean}`)
    }

    writeFileSync(filePath, buffer)
    return true
  } catch (err) {
    clearTimeout(timer)
    if (existsSync(filePath)) {
      try { unlinkSync(filePath) } catch { /* ignore */ }
    }
    throw new Error(`Failed to download ${filename}: ${(err as Error).message}`)
  }
}
