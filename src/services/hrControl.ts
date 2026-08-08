export interface AttendanceZoneConfig {
  location_id: string
  name: string
  address: string
  latitude: number
  longitude: number
  radius_meters: number
  official_start_time: string
  official_end_time: string
  is_active: boolean
}

export const DEFAULT_ZONE_CONFIG: AttendanceZoneConfig = {
  location_id: 'main_branch',
  name: 'الفرع الرئيسي (القاهرة)',
  address: 'التجمع الخامس، شارع 90',
  latitude: 30.0444,
  longitude: 31.2357,
  radius_meters: 50,
  official_start_time: '09:00',
  official_end_time: '17:00',
  is_active: true,
}

const ZONE_KEY = 'hr_attendance_zone_config_v1'
const AUDIT_KEY = 'hr_audit_log_v1'

export interface AuditEntry {
  id: string
  ts: string
  actor_name: string
  action: string
  target: string
  before: unknown
  after: unknown
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota / privacy-mode failures
  }
}

/**
 * Attendance geo-fence configuration.
 *
 * Owned by HR Control. Employee attendance logic MUST read the radius from here
 * (never hard-codes a value). Local-first storage; swap to an RPC when the
 * backend capability exists.
 */
export const hrControlService = {
  getZoneConfig(): AttendanceZoneConfig {
    const cfg = readJson<AttendanceZoneConfig>(ZONE_KEY, DEFAULT_ZONE_CONFIG)
    if (!cfg || typeof cfg.latitude !== 'number' || typeof cfg.radius_meters !== 'number') {
      return DEFAULT_ZONE_CONFIG
    }
    return cfg
  },

  saveZoneConfig(patch: Partial<AttendanceZoneConfig>, actorName = ''): AttendanceZoneConfig {
    const before = this.getZoneConfig()
    const after: AttendanceZoneConfig = { ...before, ...patch }
    writeJson(ZONE_KEY, after)
    this.appendAudit({
      actor_name: actorName || 'غير معروف',
      action: 'تحديث إعدادات نطاق الحضور',
      target: after.name,
      before,
      after,
    })
    return after
  },

  getAuditLog(): AuditEntry[] {
    return readJson<AuditEntry[]>(AUDIT_KEY, [])
  },

  appendAudit(entry: Omit<AuditEntry, 'id' | 'ts'>): void {
    const log = this.getAuditLog()
    log.unshift({ ...entry, id: crypto.randomUUID?.() ?? String(Date.now() + Math.random()), ts: new Date().toISOString() })
    writeJson(AUDIT_KEY, log.slice(0, 500))
  },
}

/** Haversine distance in meters between two lat/lng points. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** True when the point is within the configured zone radius. */
export function isWithinZone(lat: number, lng: number, cfg: AttendanceZoneConfig = hrControlService.getZoneConfig()): boolean {
  return distanceMeters(lat, lng, cfg.latitude, cfg.longitude) <= cfg.radius_meters
}

export type WorkType = 'office' | 'field' | 'hybrid'
export type AttendanceMethod = 'premises' | 'app'

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  office: 'مكتبي',
  field: 'ميداني',
  hybrid: 'هجين',
}

export const ATTENDANCE_METHOD_LABELS: Record<AttendanceMethod, string> = {
  premises: 'بصمة المقر',
  app: 'بصمة التطبيق',
}

/**
 * Extended HR settings for an employee, owned by HR Control.
 *
 * Fields that the existing backend/data model already persists (personal
 * basics via `governed_update_employee`, shift times/hours/location via
 * `upsert_employee_work_policy`) are saved through those RPCs. The fields
 * below have NO backend column/RPC yet (national id, residential location,
 * work type, attendance method, salary). They are kept structurally ready and
 * stored local-first (same pattern as the zone config) so the employee-facing
 * screen has a single source of truth; swap to an RPC when the backend
 * capability exists.
 */
export interface EmployeeHRSettings {
  employee_id: string
  national_id?: string
  residential_location?: string
  job_title?: string
  department?: string
  hire_date?: string
  work_type?: WorkType
  attendance_method?: AttendanceMethod
  primary_work_location_id?: string
  work_start_time?: string
  work_end_time?: string
  daily_working_hours?: number
  overtime_eligible?: boolean
  salary_category?: string
  monthly_salary?: number
  daily_rate?: number
  hourly_rate?: number
  updated_at?: string
  updated_by?: string
}

const EMP_HR_KEY = 'hr_employee_hr_settings_v1'

function readEmployeeSettings(): EmployeeHRSettings[] {
  return readJson<EmployeeHRSettings[]>(EMP_HR_KEY, [])
}

export function getEmployeeHRSettings(employeeId: string): EmployeeHRSettings | null {
  return readEmployeeSettings().find((s) => s.employee_id === employeeId) ?? null
}

export function saveEmployeeHRSettings(
  employeeId: string,
  patch: Partial<EmployeeHRSettings>,
  actorName = '',
): EmployeeHRSettings {
  const before = getEmployeeHRSettings(employeeId) ?? { employee_id: employeeId }
  const after: EmployeeHRSettings = {
    ...before,
    ...patch,
    employee_id: employeeId,
    updated_at: new Date().toISOString(),
    updated_by: actorName || undefined,
  }
  const all = readEmployeeSettings().filter((s) => s.employee_id !== employeeId)
  all.unshift(after)
  writeJson(EMP_HR_KEY, all)
  hrControlService.appendAudit({
    actor_name: actorName || 'غير معروف',
    action: 'تعديل الملف التعريفي للموظف',
    target: employeeId,
    before,
    after,
  })
  return after
}

/** Append one immutable audit entry per changed field (preserves original values). */
export function auditFieldChanges(
  actorName: string,
  target: string,
  changes: { field: string; before: unknown; after: unknown }[],
): void {
  for (const c of changes) {
    hrControlService.appendAudit({
      actor_name: actorName || 'غير معروف',
      action: `تعديل يدوي - ${c.field}`,
      target,
      before: c.before,
      after: c.after,
    })
  }
}

/**
 * Resolve the attendance geo rule for an employee.
 *
 * - بصمة المقر (premises): validation uses the configured zone radius (never
 *   hard-coded; the Main Branch 50m default lives in the zone config and is
 *   editable from HR Control → مقار العمل).
 * - بصمة التطبيق (app): no forced main-branch radius is applied.
 */
export function employeeAttendanceRule(
  settings: EmployeeHRSettings | null,
): { method: AttendanceMethod | null; inZoneRadius: boolean } {
  const method: AttendanceMethod = settings?.attendance_method ?? 'premises'
  if (method === 'app') {
    return { method, inZoneRadius: false }
  }
  return { method, inZoneRadius: true }
}
