export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 2,
  }).format(amount)
}

export function formatCurrencyShort(amount: number): string {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
  return formatted.replace(/\.00$/, '') + ' ج.م'
}

export function toEnglishDigits(str: string): string {
  return str.replace(/[\u0660-\u0669]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 0x0030))
}

export const CAIRO_TZ = 'Africa/Cairo'

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: CAIRO_TZ,
  }).format(new Date(date))
}

export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CAIRO_TZ,
  }).format(new Date(date))
}

export function formatTime(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CAIRO_TZ,
    ...options,
  }).format(new Date(date))
}
