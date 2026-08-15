export interface Migration {
  version: number
  file: string
  description: string
}

export interface MigrationManifest {
  baselineVersion: number
  schemaVersion: number
  migrations: Migration[]
}

export const BASELINE_SCHEMA_FILE = 'schema.sql'

// Minimum schema version each app release requires to function correctly.
// Ordered by sinceAppVersion ascending; highest matching entry wins.
const REQUIRED_SCHEMA_MAP: Array<{ sinceAppVersion: string; schemaVersion: number }> = [
  { sinceAppVersion: '0.0.0', schemaVersion: 1 },
  { sinceAppVersion: '1.3.0', schemaVersion: 2 },
]

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}

export function requiredSchemaVersion(appVersion: string): number {
  let result = 1
  for (const entry of REQUIRED_SCHEMA_MAP) {
    if (compareVersions(appVersion, entry.sinceAppVersion) >= 0) {
      result = entry.schemaVersion
    }
  }
  return result
}
