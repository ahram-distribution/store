export type SessionState = 'ACTIVE' | 'CLOSED'

export function getSessionState(session: { end_time?: string | null }): SessionState {
  return session.end_time && typeof session.end_time === 'string' ? 'CLOSED' : 'ACTIVE'
}

export function getSafeDuration(session: { start_time?: string | null; end_time?: string | null }): number | null {
  if (getSessionState(session as { end_time?: string | null }) === 'ACTIVE') return null
  if (!session.start_time || !session.end_time) return null
  const start = new Date(session.start_time)
  const end = new Date(session.end_time)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null
  return (end.getTime() - start.getTime()) / 60000
}

export function formatAttendanceTime(value: string | Date | null | undefined): string {
  if (value == null) return 'غير متوفر'
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return 'غير متوفر'
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Cairo',
  }).format(d)
}
