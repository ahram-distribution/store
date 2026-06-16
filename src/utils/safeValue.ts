export function displayValue(value: string | null | undefined, fallback = 'غير متوفر'): string {
  if (value === null || value === undefined || value === '—' || value === '') return fallback
  return value
}

export function displayNumber(value: number | null | undefined, fallback = 'غير متوفر'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback
  return String(value)
}
