export type TargetRole =
  | 'الإدارة العليا'
  | 'مدير بيع'
  | 'مندوب مبيعات'
  | 'مشرف عام'
  | 'مدير مخزن'
  | 'سيلز داخلي'
  | 'عميل'
  | 'مدير عمليات تنفيذية'

const roleMapping: Record<string, TargetRole> = {
  'الإدارة العليا': 'الإدارة العليا',
  'SUPER_ADMIN': 'الإدارة العليا',
  'ADMIN': 'الإدارة العليا',
  'CHAIRMAN': 'الإدارة العليا',
  'EXECUTIVE_MANAGER': 'الإدارة العليا',
  'سوبر أدمن': 'الإدارة العليا',
  'سوبرادمن': 'الإدارة العليا',
  'رئيس مجلس الإدارة': 'الإدارة العليا',
  'رئيس مجلس الادارة': 'الإدارة العليا',
  'أدمن': 'الإدارة العليا',
  'ادمن': 'الإدارة العليا',
  'مدير تنفيذي': 'الإدارة العليا',
  'المدير التنفيذي': 'الإدارة العليا',
  'superadmin': 'الإدارة العليا',
  'super_admin': 'الإدارة العليا',
  'administrator': 'الإدارة العليا',
  'executive_director': 'الإدارة العليا',
  'executive_manager': 'الإدارة العليا',
  'executive': 'الإدارة العليا',

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
  'مشرف مبيعات': 'مدير بيع',
  'سوبر فايزر': 'مدير بيع',
  'مشرف': 'مدير بيع',
  'SUPERVISOR': 'مدير بيع',

  'مندوب مبيعات': 'مندوب مبيعات',
  'sales_rep': 'مندوب مبيعات',
  'salesrep': 'مندوب مبيعات',
  'مندوب': 'مندوب مبيعات',

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

export function isCustomer(identityType: string | undefined): boolean {
  return identityType === 'customer'
}
