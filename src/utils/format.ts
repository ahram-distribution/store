import { formatInteger, formatNumber, toEnglishDigits } from './numbers'

export { toEnglishDigits }

export function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount)) return 'ج.م 0'
  return `ج.م ${formatNumber(amount, { minFractionDigits: 2, maxFractionDigits: 2 })}`
}

export function formatCurrencyShort(amount: number): string {
  if (!Number.isFinite(amount)) return '0 ج.م'
  const formatted = formatNumber(amount, { minFractionDigits: 2, maxFractionDigits: 2 })
  return formatted.replace(/\.00$/, '') + ' ج.م'
}

export function formatCurrencyWhole(amount: number): string {
  if (!Number.isFinite(amount)) return '0 ج.م'
  return formatInteger(amount) + ' ج.م'
}

export const CAIRO_TZ = 'Africa/Cairo'

export function isValidDate(value: unknown): value is Date {
  if (value instanceof Date) return !isNaN(value.getTime())
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return !isNaN(d.getTime())
  }
  return false
}

export function safeFormatDateTime(value: string | Date | null | undefined, fallback?: string): string {
  if (!value) return fallback || ''
  if (!isValidDate(value)) return fallback || String(value)
  try {
    return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: CAIRO_TZ,
    }).format(value instanceof Date ? value : new Date(value))
  } catch { return fallback || String(value) }
}

export function formatDate(date: string | Date): string {
  if (!date) return '--'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '--'
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: CAIRO_TZ,
  }).format(d)
}

export function formatDateTime(date: string | Date): string {
  if (!date) return '--'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '--'
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CAIRO_TZ,
  }).format(d)
}

export function formatTime(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  if (!date) return '--'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '--'
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CAIRO_TZ,
    ...options,
  }).format(d)
}

/** Compact Cairo timestamp `YYYY-MM-DD HH:mm`, English digits only (e.g. `2026-08-01 13:42`). */
export function formatDateTimeStamp(date: string | Date): string {
  if (!date) return '--'
  const d = new Date(date)
  if (isNaN(d.getTime())) return '--'
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: CAIRO_TZ,
    }).formatToParts(d)
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
  } catch { return '--' }
}
