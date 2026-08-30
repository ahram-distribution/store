import { cairoDateComponents } from '../../lib/dateRange'

export function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  try {
    return new Intl.NumberFormat('ar-EG-u-nu-latn').format(Math.round(v))
  } catch { return String(Math.round(v)) }
}

export function fmtMoney(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  try {
    return new Intl.NumberFormat('ar-EG-u-nu-latn', { maximumFractionDigits: 0 }).format(v)
  } catch { return String(v) }
}

export function fmtDecimal(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  try {
    return new Intl.NumberFormat('ar-EG-u-nu-latn', { maximumFractionDigits: digits }).format(v)
  } catch { return String(v) }
}

export function fmtMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined || Number.isNaN(min)) return '—'
  if (min < 60) return `${fmtNum(Math.round(min))} دقيقة`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${fmtNum(h)} ساعة و${fmtNum(m)} دقيقة` : `${fmtNum(h)} ساعة`
}

export function fmtHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return '—'
  return fmtDecimal(hours)
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return '—'
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Cairo' }).format(d)
  } catch { return '—' }
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const [y, m, d] = cairoDateComponents(new Date(iso))
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    return `${d} ${months[m - 1]} ${y}`
  } catch { return iso.slice(0, 10) }
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return `${fmtDate(iso)} — ${fmtTime(iso)}`
}

export const CONNECTION_LABELS: Record<string, string> = {
  connected: 'متصل', delayed: 'متأخر', lost: 'مفقود', no_data: 'لا بيانات',
}

export const CONNECTION_COLORS: Record<string, string> = {
  connected: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  delayed: 'text-amber-600 bg-amber-50 border-amber-200',
  lost: 'text-red-600 bg-red-50 border-red-200',
  no_data: 'text-gray-500 bg-gray-50 border-gray-200',
}

export const STATUS_LABELS: Record<string, string> = {
  no_start: 'لم يبدأ', on_visit: 'على زيارة', on_break: 'في استراحة',
  working: 'يعمل الآن', auto_closed: 'إغلاق تلقائي', ended: 'أنهى اليوم',
}

export const STATUS_COLORS: Record<string, string> = {
  no_start: 'text-gray-500 bg-gray-100 border-gray-200',
  on_visit: 'text-blue-700 bg-blue-50 border-blue-200',
  on_break: 'text-violet-700 bg-violet-50 border-violet-200',
  working: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  auto_closed: 'text-red-700 bg-red-50 border-red-200',
  ended: 'text-slate-600 bg-slate-100 border-slate-200',
}

export const ATTENDANCE_LABELS: Record<string, string> = {
  late: 'متأخر', early_departure: 'مغادرة مبكرة', on_time: 'في الموعد',
  auto_closed: 'إغلاق تلقائي', absent: 'غائب',
}

export const CLOSE_REASON_LABELS: Record<string, string> = {
  auto_closed_inactivity: 'إغلاق تلقائي (عدم نشاط)',
  no_activity_timeout: 'انتهاء مهلة نشاط',
  day_rollover: 'انتقال يومي',
  manual: 'يدوي',
  left_early: 'مغادرة مبكرة',
  completed: 'مكتمل',
}

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  heartbeat: 'نبض التطبيق', gps: 'نقطة تتبع', visit: 'زيارة', order: 'طلب', collection: 'تحصيل',
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${fmtDecimal(v)}%`
}
