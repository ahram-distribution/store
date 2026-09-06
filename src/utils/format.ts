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

/** Human-friendly Arabic commercial amount WITHOUT currency suffix.
 * - 10,000  → "10 ألف"
 * - 250,000 → "250 ألف"
 * - 1,000,000 → "مليون"  ·  2,000,000 → "2 مليون"
 * - 47,314  → "47.3 ألف"  ·  2,686 → "2.7 ألف"
 * - 999     → "999"
 * Usage is reserved for customer-facing tier thresholds / remaining amounts.
 * Stored numeric values are never modified — only their presentation. */
export function formatArabicAmount(amount: number): string {
  if (!Number.isFinite(amount)) return '0'
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)

  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000
    const rounded = Number(millions.toFixed(1))
    if (typeof rounded === 'number' && Math.abs(rounded) % 1 === 0) {
      const m = Math.round(rounded)
      return `${sign}${m === 1 ? 'مليون' : `${formatInteger(m)} مليون`}`
    }
    return `${sign}${formatNumber(rounded, { minFractionDigits: 1, maxFractionDigits: 1, grouping: false })} مليون`
  }

  if (abs >= 1_000) {
    const thousands = abs / 1_000
    const rounded = Number(thousands.toFixed(1))
    if (Math.abs(thousands - Math.round(thousands)) < 1e-6) {
      const k = Math.round(thousands)
      return `${sign}${k === 1 ? 'ألف' : `${formatInteger(k)} ألف`}`
    }
    return `${sign}${formatNumber(rounded, { minFractionDigits: 1, maxFractionDigits: 1, grouping: false })} ألف`
  }

  return `${sign}${formatInteger(abs)}`
}

/** Human-friendly Arabic commercial amount WITH currency suffix. */
export function formatArabicAmountWithCurrency(amount: number): string {
  return `${formatArabicAmount(amount)} ج.م`
}

/** Human-friendly Arabic commercial display for a tier name.
 * If the configured name is a raw integer (e.g. "50000"), it is rendered as
 * "50 ألف"; any other configured name (e.g. "شريحة 50 ألف") is passed through. */
export function formatTierName(name: string): string {
  const trimmed = name.trim()
  return /^\d+$/.test(trimmed) ? formatArabicAmount(Number(trimmed)) : name
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
