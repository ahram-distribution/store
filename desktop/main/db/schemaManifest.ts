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
  { sinceAppVersion: '1.4.0', schemaVersion: 3 },
  { sinceAppVersion: '1.5.0', schemaVersion: 10 },
  { sinceAppVersion: '1.6.0', schemaVersion: 11 },
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

// ---------------------------------------------------------------------------
// Critical RPC surface
// ---------------------------------------------------------------------------
// Functions the renderer invokes through the desktop RPC shim (named-notation
// calls like "p_token" := $1). Each entry lists the parameter names that must
// resolve for the app version's screens to work. The migration runtime verifies
// the LOCAL database actually provides them before the app is marked READY.
// ---------------------------------------------------------------------------

export interface CriticalFunction {
  name: string
  args: string[]
}

const V1_CRITICAL_FUNCTIONS: CriticalFunction[] = [
  { name: 'login', args: ['p_phone', 'p_password'] },
  { name: 'validate_session', args: ['p_token'] },
  { name: 'check_capability', args: ['p_token', 'p_code'] },
]

// v2 adds the 9-arg get_unified_orders (OrdersPage always passes
// p_include_strict_previous, so the 8-arg baseline signature is insufficient).
const V2_CRITICAL_FUNCTIONS: CriticalFunction[] = [
  ...V1_CRITICAL_FUNCTIONS,
  {
    name: 'get_unified_orders',
    args: [
      'p_token',
      'p_search',
      'p_status',
      'p_customer_id',
      'p_created_by',
      'p_date_from',
      'p_date_to',
      'p_governorate_id',
      'p_include_strict_previous',
    ],
  },
]

// v3 adds the inventory global policy RPCs (ProductManagerPage).
const V3_CRITICAL_FUNCTIONS: CriticalFunction[] = [
  ...V2_CRITICAL_FUNCTIONS,
  { name: 'get_inventory_policies', args: ['p_token'] },
  { name: 'set_global_negative_selling_policy', args: ['p_token', 'p_value', 'p_scope'] },
  { name: 'set_global_inventory_deduction_status', args: ['p_token', 'p_value', 'p_scope'] },
]

const CRITICAL_FUNCTIONS_BY_VERSION: Record<number, CriticalFunction[]> = {
  1: V1_CRITICAL_FUNCTIONS,
  2: V2_CRITICAL_FUNCTIONS,
  3: V3_CRITICAL_FUNCTIONS,
}

export function requiredCriticalFunctions(appVersion: string): CriticalFunction[] {
  return CRITICAL_FUNCTIONS_BY_VERSION[requiredSchemaVersion(appVersion)] ?? []
}
