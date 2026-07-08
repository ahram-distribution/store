import type { IAuthorizationPolicy } from '../contracts/IAuthorizationPolicy'

export const attendancePolicy: IAuthorizationPolicy = {
  policyName: 'AttendancePolicy',
  authorize(session) {
    const hasCapability = session.roles.some(r =>
      r.capabilities.some(c => c.code === 'attendance.record'),
    )
    if (!hasCapability) return { allowed: false, reason: 'Attendance recording permission required' }
    return { allowed: true }
  },
}
