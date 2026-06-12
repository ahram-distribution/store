import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import AttendanceModuleHomePage from '../../pages/attendance/AttendanceModuleHomePage'

const MODULE_HOME_ROLES = new Set([
  'مدير البيع',
  'مدير تنفيذي',
  'سوبر أدمن',
  'رئيس مجلس الإدارة',
  'أدمن',
  'SUPER_ADMIN',
])

function shouldGoToModuleHome(roles: string[]): boolean {
  return roles.some((role) => MODULE_HOME_ROLES.has(role))
}

export function AttendanceRouter() {
  const { user, token } = useAuthStore()

  if (!token || !user) {
    return <Navigate to="/login" replace />
  }

  if (shouldGoToModuleHome(user.roles)) {
    return <AttendanceModuleHomePage />
  }

  return <Navigate to="/attendance/runtime" replace />
}
