export interface ReleaseManifest {
  build_id: string
  commit_hash: string
  build_date: string
  app_version: string
  required_schema_version: number
  assets: Record<string, string>
}

export interface ManifestComparison {
  isCurrent: boolean
  rendererChanged: boolean
  schemaNeedsUpgrade: boolean
  appNeedsUpgrade: boolean
  remoteBuildId: string | null
  remoteSchemaVersion: number | null
  remoteAppVersion: string | null
}

const MANIFEST_URL = 'https://ahram-distribution.github.io/store/build-manifest.json'
const CHECK_TIMEOUT_MS = 8000

export async function fetchReleaseManifest(): Promise<ReleaseManifest | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS)
    const res = await fetch(MANIFEST_URL, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json()
    if (!data || typeof data.build_id !== 'string') return null
    return data as ReleaseManifest
  } catch {
    return null
  }
}

export function compareManifests(
  remote: ReleaseManifest,
  localBuildId: string | null,
  localSchemaVersion: number,
  localAppVersion: string,
): ManifestComparison {
  const rendererChanged = remote.build_id !== localBuildId
  const schemaNeedsUpgrade = remote.required_schema_version > localSchemaVersion
  const appNeedsUpgrade = compareVersions(remote.app_version, localAppVersion) > 0
  const isCurrent = !rendererChanged && !schemaNeedsUpgrade && !appNeedsUpgrade

  return {
    isCurrent,
    rendererChanged,
    schemaNeedsUpgrade,
    appNeedsUpgrade,
    remoteBuildId: remote.build_id,
    remoteSchemaVersion: remote.required_schema_version,
    remoteAppVersion: remote.app_version,
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0)
  const pb = b.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}
