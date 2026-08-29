const CAIRO_TZ = 'Africa/Cairo'

export function cairoDateComponents(now: Date): [number, number, number] {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now).split('-').map(Number)
  return [parts[0], parts[1], parts[2]]
}

export function toCairoDate(v: unknown): string {
  if (!v) return ''
  try {
    const d = new Date(v as string)
    if (isNaN(d.getTime())) return ''
    const [y, m, day] = cairoDateComponents(d)
    return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  } catch { return '' }
}

function cairoOffsetAt(date: Date): number {
  const utcStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', hour: '2-digit', hour12: false,
  }).format(date)
  const cairoStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TZ, hour: '2-digit', hour12: false,
  }).format(date)
  let offset = parseInt(cairoStr) - parseInt(utcStr)
  if (offset < -12) offset += 24
  if (offset > 12) offset -= 24
  return offset
}

export function cairoMidnightISO(year: number, month: number, day: number): string {
  const offset = cairoOffsetAt(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)))
  const sign = offset >= 0 ? '+' : '-'
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  const s = `${year}-${pad(month)}-${pad(day)}T00:00:00${sign}${pad(offset)}:00`
  return new Date(s).toISOString()
}

function daysSinceSaturday(y: number, m: number, d: number): number {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return (dow + 1) % 7
}

/** Add a whole number of days to a Cairo civil date without touching time-of-day or timezone. */
function addDays(y: number, m: number, d: number, delta: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d) + delta * 86400000)
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]
}

export function getBusinessWeekStart(y: number, m: number, d: number): { year: number; month: number; day: number } {
  const daysBack = daysSinceSaturday(y, m, d)
  const [year, month, day] = addDays(y, m, d, -daysBack)
  return { year, month, day }
}

export type DateRangePreset = 'today' | 'yesterday' | 'week' | 'month' | 'prev_month' | 'custom'

export function computeDateRange(preset: DateRangePreset, customFrom?: string, customTo?: string): { dateFrom: string; dateTo: string } {
  const nowUtc = new Date()
  const [y, m, d] = cairoDateComponents(nowUtc)

  switch (preset) {
    case 'today': {
      const from = cairoMidnightISO(y, m, d)
      return { dateFrom: from, dateTo: nowUtc.toISOString() }
    }

    case 'yesterday': {
      const yesterday = new Date(y, m - 1, d)
      yesterday.setDate(yesterday.getDate() - 1)
      const from = cairoMidnightISO(yesterday.getFullYear(), yesterday.getMonth() + 1, yesterday.getDate())
      const to = cairoMidnightISO(y, m, d)
      return { dateFrom: from, dateTo: to }
    }

    case 'week': {
      const { year: sy, month: sm, day: sd } = getBusinessWeekStart(y, m, d)
      const from = cairoMidnightISO(sy, sm, sd)
      return { dateFrom: from, dateTo: nowUtc.toISOString() }
    }

    case 'month': {
      const from = cairoMidnightISO(y, m, 1)
      return { dateFrom: from, dateTo: nowUtc.toISOString() }
    }

    case 'prev_month': {
      const prevMonth = m === 1 ? 12 : m - 1
      const prevYear = m === 1 ? y - 1 : y
      const from = cairoMidnightISO(prevYear, prevMonth, 1)
      const lastDay = new Date(prevYear, prevMonth, 0).getDate()
      const to = cairoMidnightISO(prevYear, prevMonth, lastDay)
      return { dateFrom: from, dateTo: to }
    }

    case 'custom': {
      if (!customFrom || !customTo) {
        const from = cairoMidnightISO(y, m, d)
        const toDate = new Date(from)
        toDate.setDate(toDate.getDate() + 1)
        return { dateFrom: from, dateTo: toDate.toISOString() }
      }
      const [cfY, cfM, cfD] = customFrom.split('-').map(Number)
      const [ctY, ctM, ctD] = customTo.split('-').map(Number)
      const from = cairoMidnightISO(cfY, cfM, cfD)
      const toDate = new Date(cairoMidnightISO(ctY, ctM, ctD))
      toDate.setDate(toDate.getDate() + 1)
      return { dateFrom: from, dateTo: toDate.toISOString() }
    }

    default:
      return computeDateRange('today')
  }
}

export function monthRange(month: number, year: number): { from: string; to: string } {
  const from = cairoMidnightISO(year, month, 1)
  const to = month === 12
    ? cairoMidnightISO(year + 1, 1, 1)
    : cairoMidnightISO(year, month + 1, 1)
  return { from, to }
}

export type SalesRepPeriod = 'day' | 'yesterday' | 'week' | 'month' | 'custom'

export function salesRepRange(period: SalesRepPeriod, customFrom?: string, customTo?: string): { from: string; to: string } {
  const nowUtc = new Date()
  const [y, m, d] = cairoDateComponents(nowUtc)

  switch (period) {
    case 'day': {
      const from = cairoMidnightISO(y, m, d)
      const nextDay = new Date(y, m - 1, d + 1)
      const to = cairoMidnightISO(nextDay.getFullYear(), nextDay.getMonth() + 1, nextDay.getDate())
      return { from, to }
    }
    case 'yesterday': {
      const yesterday = new Date(y, m - 1, d)
      yesterday.setDate(yesterday.getDate() - 1)
      const from = cairoMidnightISO(yesterday.getFullYear(), yesterday.getMonth() + 1, yesterday.getDate())
      const to = cairoMidnightISO(y, m, d)
      return { from, to }
    }
    case 'week': {
      const { year: sy, month: sm, day: sd } = getBusinessWeekStart(y, m, d)
      const from = cairoMidnightISO(sy, sm, sd)
      return { from, to: nowUtc.toISOString() }
    }
    case 'month': {
      const from = cairoMidnightISO(y, m, 1)
      return { from, to: nowUtc.toISOString() }
    }
    case 'custom': {
      if (!customFrom || !customTo) return { from: nowUtc.toISOString(), to: nowUtc.toISOString() }
      const [cfY, cfM, cfD] = customFrom.split('-').map(Number)
      const [ctY, ctM, ctD] = customTo.split('-').map(Number)
      const from = cairoMidnightISO(cfY, cfM, cfD)
      const toDate = new Date(cairoMidnightISO(ctY, ctM, ctD))
      toDate.setDate(toDate.getDate() + 1)
      return { from, to: toDate.toISOString() }
    }
  }
}

export type ResolvePreset = 'all' | 'today' | 'yesterday' | 'week' | 'prev_week' | 'month' | 'prev_month' | 'year' | 'custom'

export function resolveDateRange(preset: ResolvePreset, customFrom?: string, customTo?: string): { from: string; to: string } {
  const [y, m, d] = cairoDateComponents(new Date())
  const pad = (n: number) => String(n).padStart(2, '0')
  const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`

  switch (preset) {
    case 'today': {
      const s = iso(y, m, d)
      return { from: s, to: s }
    }
    case 'yesterday': {
      const [yy, ym, yd] = addDays(y, m, d, -1)
      const s = iso(yy, ym, yd)
      return { from: s, to: s }
    }
    case 'week': {
      const { year: sy, month: sm, day: sd } = getBusinessWeekStart(y, m, d)
      const [ey, em, ed] = addDays(sy, sm, sd, 6)
      return { from: iso(sy, sm, sd), to: iso(ey, em, ed) }
    }
    case 'month': {
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
      return { from: iso(y, m, 1), to: iso(y, m, last) }
    }
    case 'prev_month': {
      const prevMonth = m === 1 ? 12 : m - 1
      const prevYear = m === 1 ? y - 1 : y
      const last = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate()
      return { from: iso(prevYear, prevMonth, 1), to: iso(prevYear, prevMonth, last) }
    }
    case 'prev_week': {
      const { year: pwsy, month: pwsm, day: pwsd } = getBusinessWeekStart(y, m, d)
      const [py, pm, pd] = addDays(pwsy, pwsm, pwsd, -7)
      const [ey, em, ed] = addDays(py, pm, pd, 6)
      return { from: iso(py, pm, pd), to: iso(ey, em, ed) }
    }
    case 'year': {
      return { from: iso(y, 1, 1), to: iso(y, m, d) }
    }
    case 'custom': {
      if (!customFrom || !customTo) {
        const s = iso(y, m, d)
        return { from: s, to: s }
      }
      return { from: customFrom, to: customTo }
    }
    default:
      return { from: '', to: '' }
  }
}

export type ResolvePresetISO = 'all' | 'today' | 'yesterday' | 'week' | 'prev_week' | 'month' | 'prev_month' | 'year' | 'custom'

export function resolveDateRangeISO(preset: ResolvePresetISO, customFrom?: string, customTo?: string): { from: string | null; to: string | null } {
  const nowUtc = new Date()
  const [y, m, d] = cairoDateComponents(nowUtc)

  switch (preset) {
    case 'all':
      return { from: null, to: null }
    case 'today': {
      const from = cairoMidnightISO(y, m, d)
      return { from, to: nowUtc.toISOString() }
    }
    case 'yesterday': {
      const yesterday = new Date(y, m - 1, d)
      yesterday.setDate(yesterday.getDate() - 1)
      const [yy, ym, yd] = cairoDateComponents(yesterday)
      const from = cairoMidnightISO(yy, ym, yd)
      const to = cairoMidnightISO(y, m, d)
      return { from, to }
    }
    case 'week': {
      const { dateFrom, dateTo } = computeDateRange('week')
      return { from: dateFrom, to: dateTo }
    }
    case 'prev_week': {
      const { from: pwf, to: pwt } = resolveDateRange('prev_week')
      return { from: cairoMidnightISO(...pwf.split('-').map(Number) as [number, number, number]), to: pwt ? cairoMidnightISO(...pwt.split('-').map(Number) as [number, number, number]) : nowUtc.toISOString() }
    }
    case 'month': {
      const { dateFrom, dateTo } = computeDateRange('month')
      return { from: dateFrom, to: dateTo }
    }
    case 'prev_month': {
      const prevMonth = m === 1 ? 12 : m - 1
      const prevYear = m === 1 ? y - 1 : y
      const from = cairoMidnightISO(prevYear, prevMonth, 1)
      const to = cairoMidnightISO(y, m, 1)
      return { from, to }
    }
    case 'year': {
      return { from: cairoMidnightISO(y, 1, 1), to: nowUtc.toISOString() }
    }
    case 'custom': {
      if (!customFrom && !customTo) return { from: null, to: null }
      const from = customFrom ? cairoMidnightISO(...customFrom.split('-').map(Number) as [number, number, number]) : null
      const to = customTo ? (() => { const [ty, tm, td] = customTo.split('-').map(Number); const d2 = new Date(cairoMidnightISO(ty, tm, td)); d2.setDate(d2.getDate() + 1); return d2.toISOString() })() : null
      return { from, to }
    }
    default:
      return resolveDateRangeISO('today')
  }
}
