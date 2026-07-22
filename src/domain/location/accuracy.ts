import type { AccuracyInfo } from './types'

export function formatAccuracy(accuracy: number | null | undefined): AccuracyInfo {
  if (accuracy === null || accuracy === undefined) {
    return { label: 'غير محدد', className: 'text-text-secondary', detail: '' }
  }
  const rounded = Math.round(accuracy)
  const detail = `${rounded} متر`
  if (rounded <= 20) return { label: 'ممتازة', className: 'text-success', detail }
  if (rounded <= 50) return { label: 'جيدة', className: 'text-accent', detail }
  if (rounded <= 100) return { label: 'مقبولة', className: 'text-warning', detail }
  if (rounded <= 200) return { label: 'ضعيفة', className: 'text-danger', detail }
  return { label: 'ضعيفة جداً', className: 'text-danger/70', detail }
}

export function getLocationAccuracyLabel(accuracy: number | null | undefined): string {
  return formatAccuracy(accuracy).label
}

export const ACCURACY_COLORS: Record<string, string> = {
  CUSTOMER_LOCATION: 'text-success',
  VISIT_GPS: 'text-primary',
  GEOCODED: 'text-accent',
  UNKNOWN: 'text-text-muted',
}
