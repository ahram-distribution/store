export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatCurrencyShort(amount: number): string {
  if (!Number.isFinite(amount)) return '0 ج.م'
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
  return formatted + ' ج.م'
}

export function toEnglishDigits(str: string): string {
  return str.replace(/[\u0660-\u0669]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 0x0030))
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
