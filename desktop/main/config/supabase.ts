import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'

export interface SupabaseConfig {
  url: string
  anonKey: string
}

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) return null
  const key = trimmed.slice(0, eqIdx).trim()
  let value = trimmed.slice(eqIdx + 1).trim()
  // Strip surrounding quotes
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return [key, value]
}

function tryReadAppPath(): string | null {
  // electron app has `app.getAppPath()`, but we can't require('electron') outside Electron
  // Try common locations relative to this file
  const candidates = [
    // During dev: repo root via __dirname from compiled desktop/build/main/config/
    join(__dirname, '..', '..', '..', '..', '..', '.env.local'),
    // Fallback: cwd
    join(process.cwd(), '.env.local'),
    // During test: repo root
    join(__dirname, '..', '..', '..', '.env.local'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

export function getSupabaseConfig(): SupabaseConfig | null {
  // 1. Prefer process.env (set by CI or shell)
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    return { url: process.env.VITE_SUPABASE_URL, anonKey: process.env.VITE_SUPABASE_ANON_KEY }
  }

  // 2. Try .env.local from various locations
  const envPath = tryReadAppPath()
  if (envPath) {
    try {
      const content = readFileSync(envPath, 'utf8')
      const lines = content.split('\n')
      let url = ''
      let key = ''
      for (const line of lines) {
        const parsed = parseEnvLine(line)
        if (!parsed) continue
        const [k, v] = parsed
        if (k === 'VITE_SUPABASE_URL') url = v
        else if (k === 'VITE_SUPABASE_ANON_KEY') key = v
      }
      if (url && key) return { url, anonKey: key }
    } catch { /* try next */ }
  }

  // 3. Fallback: try bundled resources (production)
  try {
    const resPath = process.resourcesPath
      ? join(process.resourcesPath, 'supabase.json')
      : join(__dirname, '..', '..', '..', '..', 'resources', 'supabase.json')
    if (existsSync(resPath)) {
      return JSON.parse(readFileSync(resPath, 'utf8'))
    }
  } catch { /* no bundled config */ }

  console.warn('[Config] Supabase configuration not found. Sync will be unavailable.')
  return null
}
