export interface DateRange {
  readonly from: Date
  readonly to: Date
}

export function createDateRange(from: Date, to: Date): DateRange {
  if (to < from) throw new Error('end date must be after start date')
  return { from, to }
}

export function isInRange(range: DateRange, date: Date): boolean {
  return date >= range.from && date <= range.to
}

export function durationInDays(range: DateRange): number {
  return Math.ceil((range.to.getTime() - range.from.getTime()) / (1000 * 60 * 60 * 24))
}
