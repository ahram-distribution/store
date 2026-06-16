import { isUpperManagement } from './roleNormalization'
import type { SessionUser } from '../store/auth'

export type EffectiveRole = 'executive' | 'manager' | 'rep' | 'customer'

export function getEffectiveRole(user: SessionUser | null): EffectiveRole {
  if (!user || user.identity_type === 'customer') return 'customer'
  const roles = user.roles || []
  if (roles.some((r) => isUpperManagement(r))) return 'executive'
  if (roles.some((r) => ['manager', 'sales_manager', 'team_lead'].includes(r))) return 'manager'
  return 'rep'
}

export function canAccessAll(user: SessionUser | null): boolean {
  return getEffectiveRole(user) === 'executive'
}

export function canAccessTeam(user: SessionUser | null): boolean {
  const role = getEffectiveRole(user)
  return role === 'executive' || role === 'manager'
}

export function getRoleLabel(role: EffectiveRole): string {
  const labels: Record<EffectiveRole, string> = {
    executive: 'الإدارة العليا',
    manager: 'مدير مبيعات',
    rep: 'مندوب مبيعات',
    customer: 'عميل',
  }
  return labels[role]
}

export function getRoleDescription(role: EffectiveRole): string {
  const descriptions: Record<EffectiveRole, string> = {
    executive: 'يرى كل البيانات دون قيود',
    manager: 'يرى بيانات مناديبه وعملائهم وطلباتهم',
    rep: 'يرى بيانات عملائه وطلباته فقط',
    customer: 'يرى بياناته وطلباته فقط',
  }
  return descriptions[role]
}
