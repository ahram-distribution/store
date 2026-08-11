export type TargetRole =
  | 'الإدارة العليا'
  | 'مدير بيع'
  | 'مندوب مبيعات'
  | 'مشرف عام'
  | 'مدير مخزن'
  | 'سيلز داخلي'
  | 'عميل'
  | 'مدير عمليات تنفيذية'
  | 'مندوب توصيل'
  | 'سائق'

const roleMapping: Record<string, TargetRole> = {
  'الإدارة العليا': 'الإدارة العليا',
  'الرئيس التنفيذي': 'الإدارة العليا',
  'executive_director': 'الإدارة العليا',

  'مدير البيع': 'مدير بيع',
  'مدير مبيعات': 'مدير بيع',
  'مدير المبيعات': 'مدير بيع',
  'Sales Manager': 'مدير بيع',
  'sales_manager': 'مدير بيع',
  'salesmanager': 'مدير بيع',
  'sales_director': 'مدير بيع',
  'salesdirector': 'مدير بيع',
  'sales': 'مدير بيع',
  'supervisor': 'مدير بيع',
  'سوبر فايزر': 'مدير بيع',
  'مشرف': 'مدير بيع',
  'SUPERVISOR': 'مدير بيع',

  'مندوب مبيعات': 'مندوب مبيعات',
  'sales_rep': 'مندوب مبيعات',
  'salesrep': 'مندوب مبيعات',
  'مندوب': 'مندوب مبيعات',

  'مندوب توصيل': 'مندوب توصيل',
  'التوصيل': 'مندوب توصيل',
  'delivery_rep': 'مندوب توصيل',
  'deliveryrep': 'مندوب توصيل',

  'سائق': 'سائق',
  'driver': 'سائق',
  'السائق': 'سائق',

  'general_supervisor': 'مشرف عام',
  'generalsupervisor': 'مشرف عام',
  'مشرف تنفيذي': 'مشرف عام',

  'warehouse_manager': 'مدير مخزن',
  'warehousemanager': 'مدير مخزن',
  'مدير مستودع': 'مدير مخزن',
  'warehouse': 'مدير مخزن',
  'مستودع': 'مدير مخزن',

  'سيلز داخلي': 'سيلز داخلي',

  'مدير عمليات تنفيذية': 'مدير عمليات تنفيذية',
  'مدير العمليات التنفيذية': 'مدير عمليات تنفيذية',
  'المشرف التنفيذي': 'مدير عمليات تنفيذية',
  'Executive Operations Manager': 'مدير عمليات تنفيذية',
  'executive_operations_manager': 'مدير عمليات تنفيذية',
  'executive_supervisor': 'مدير عمليات تنفيذية',
}

export function normalizeEmployeeRole(roleName: string): TargetRole {
  return roleMapping[roleName] ?? 'مندوب مبيعات'
}

export function isUpperManagement(roleName: string): boolean {
  return normalizeEmployeeRole(roleName) === 'الإدارة العليا'
}

export function isExecutiveDirector(roleName: string): boolean {
  return roleName === 'الرئيس التنفيذي' || roleName === 'executive_director'
}

export function isExecutiveDirectorUser(user: { roles?: string[] } | null | undefined): boolean {
  return user?.roles?.some((r) => isExecutiveDirector(r)) ?? false
}

export function isCustomer(identityType: string | undefined): boolean {
  return identityType === 'customer'
}

export function isDeliveryRep(roleName: string): boolean {
  return normalizeEmployeeRole(roleName) === 'مندوب توصيل'
}

export function isDriver(roleName: string): boolean {
  return normalizeEmployeeRole(roleName) === 'سائق'
}

export function isDeliveryStaff(roleName: string): boolean {
  const r = normalizeEmployeeRole(roleName)
  return r === 'مندوب توصيل' || r === 'سائق'
}

export function isDeliveryStaffUser(user: { identity_type: string; roles?: string[] } | null | undefined): boolean {
  if (!user || user.identity_type !== 'employee') return false
  return user.roles?.some((r) => isDeliveryStaff(r)) ?? false
}
