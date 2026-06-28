import { useEffect, useState, useMemo, useCallback } from 'react'
import { targetService } from '../../services/targets'

interface EmployeeInfo {
  employee_id: string; employee_code: string; employee_name: string
  employee_manager_id: string | null; role_type: string; has_team: boolean
}

interface CompanyTarget {
  sales_target: number; visits_target: number; orders_target: number
  new_customers_target: number; is_locked: boolean
}

interface CompanyWeights {
  sales: number; visits: number; orders: number
  new_customers: number; collections: number; attendance: number
}

const DEFAULT_WEIGHTS: CompanyWeights = {
  sales: 40, visits: 15, orders: 15, new_customers: 10, collections: 10, attendance: 10,
}

interface EmployeeTarget {
  employee_id: string; sales_target: number; visits_target: number
  orders_target: number; new_customers_target: number; is_locked: boolean
}

interface EmployeeEdit {
  employee_id: string; employee_code: string; employee_name: string
  sales_target: string; visits_target: string; orders_target: string
  new_customers_target: string
}

const KPI_FIELDS: { key: keyof EmployeeEdit; label: string; unit: string }[] = [
  { key: 'sales_target', label: 'المبيعات', unit: 'جنيه' },
  { key: 'visits_target', label: 'الزيارات', unit: 'عدد' },
  { key: 'orders_target', label: 'الطلبات', unit: 'عدد' },
  { key: 'new_customers_target', label: 'عملاء جدد', unit: 'عدد' },
]

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface TargetsTabProps {
  month: number
  year: number
}

export default function TargetsTab({ month: selMonth, year: selYear }: TargetsTabProps) {
  const [loading, setLoading] = useState(true)

  const [employees, setEmployees] = useState<EmployeeInfo[]>([])
  const [companyTarget, setCompanyTarget] = useState<CompanyTarget>({
    sales_target: 0, visits_target: 0, orders_target: 0, new_customers_target: 0, is_locked: false,
  })
  const [employeeTargetMap, setEmployeeTargetMap] = useState<Record<string, EmployeeTarget>>({})

  const [companyEdit, setCompanyEdit] = useState({ sales_target: '', visits_target: '', orders_target: '', new_customers_target: '' })
  const [companyWeights, setCompanyWeights] = useState<CompanyWeights>(DEFAULT_WEIGHTS)
  const [savingCompany, setSavingCompany] = useState(false)
  const [companySuccess, setCompanySuccess] = useState(false)
  const [companyError, setCompanyError] = useState('')

  const [employeeEdits, setEmployeeEdits] = useState<Record<string, EmployeeEdit>>({})
  const [savingEmployee, setSavingEmployee] = useState<string | null>(null)
  const [employeeSuccess, setEmployeeSuccess] = useState<string | null>(null)
  const [employeeError, setEmployeeError] = useState('')

  const [expandedManagers, setExpandedManagers] = useState<Record<string, boolean>>({})

  const managers = useMemo(() => {
    return employees.filter(e => e.role_type === 'مدير البيع')
  }, [employees])

  function getTeam(managerId: string): EmployeeInfo[] {
    return employees.filter(e => e.employee_manager_id === managerId)
  }

  useEffect(() => {
    setLoading(true)
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      targetService.getAllActiveEmployees(token),
      targetService.getCompanyTarget(selMonth, selYear, token),
      targetService.getEmployeeTargets(selMonth, selYear, token),
    ]).then(([empResult, companyResult, empTargetResult]) => {
      if (!empResult.error && empResult.data) {
        setEmployees((empResult.data as any[]).filter(e => e.role_type !== 'سوبر أدمن' && e.role_type !== 'الإدارة العليا'))
      }
      if (!companyResult.error && companyResult.data) {
        const ct = companyResult.data as any
        if (ct && ct.sales_target != null) {
          setCompanyTarget({
            sales_target: ct.sales_target, visits_target: ct.visits_target,
            orders_target: ct.orders_target, new_customers_target: ct.new_customers_target,
            is_locked: ct.is_locked,
          })
          setCompanyEdit({
            sales_target: ct.sales_target.toString(),
            visits_target: ct.visits_target.toString(),
            orders_target: ct.orders_target.toString(),
            new_customers_target: ct.new_customers_target.toString(),
          })
          setCompanyWeights({
            sales: ct.sales_weight_percent, visits: ct.visits_weight_percent,
            orders: ct.orders_weight_percent, new_customers: ct.new_customers_weight_percent,
            collections: ct.collections_weight_percent, attendance: ct.attendance_weight_percent,
          })
        }
      }
      if (!empTargetResult.error && empTargetResult.data) {
        const list: any[] = empTargetResult.data as any[]
        const map: Record<string, EmployeeTarget> = {}
        for (const et of list) {
          map[et.employee_id] = {
            employee_id: et.employee_id, sales_target: et.sales_target || 0,
            visits_target: et.visits_target || 0, orders_target: et.orders_target || 0,
            new_customers_target: et.new_customers_target || 0, is_locked: et.is_locked || false,
          }
        }
        setEmployeeTargetMap(map)
        const edits: Record<string, EmployeeEdit> = {}
        for (const et of list) {
          edits[et.employee_id] = {
            employee_id: et.employee_id, employee_code: et.employee_code || '',
            employee_name: et.employee_name || '',
            sales_target: (et.sales_target || 0).toString(),
            visits_target: (et.visits_target || 0).toString(),
            orders_target: (et.orders_target || 0).toString(),
            new_customers_target: (et.new_customers_target || 0).toString(),
          }
        }
        setEmployeeEdits(edits)
      }
      setLoading(false)
    })
  }, [selMonth, selYear])

  const handleSaveCompany = useCallback(async () => {
    if (savingCompany) return
    setCompanyError('')
    setCompanySuccess(false)
    setSavingCompany(true)
    const token = getToken()
    if (!token) { setSavingCompany(false); return }
    const { error } = await targetService.upsertCompanyTarget(
      selMonth, selYear,
      parseFloat(companyEdit.sales_target) || 0,
      parseFloat(companyEdit.visits_target) || 0,
      parseFloat(companyEdit.orders_target) || 0,
      parseFloat(companyEdit.new_customers_target) || 0,
      companyWeights.sales, companyWeights.visits, companyWeights.orders,
      companyWeights.new_customers, companyWeights.collections, companyWeights.attendance, token
    )
    setSavingCompany(false)
    if (error) { setCompanyError(error.message || 'حدث خطأ أثناء الحفظ'); return }
    setCompanySuccess(true)
    setTimeout(() => setCompanySuccess(false), 2500)
  }, [savingCompany, companyEdit, selMonth, selYear])

  function ensureEdit(emp: EmployeeInfo) {
    if (!employeeEdits[emp.employee_id]) {
      setEmployeeEdits(prev => ({
        ...prev,
        [emp.employee_id]: {
          employee_id: emp.employee_id, employee_code: emp.employee_code,
          employee_name: emp.employee_name,
          sales_target: '0', visits_target: '0', orders_target: '0', new_customers_target: '0',
        },
      }))
    }
  }

  const handleSaveEmployee = useCallback(async (empId: string) => {
    if (savingEmployee) return
    setEmployeeError('')
    setEmployeeSuccess(null)
    const edit = employeeEdits[empId]
    if (!edit) return
    setSavingEmployee(empId)
    const token = getToken()
    if (!token) { setSavingEmployee(null); return }
    const { error } = await targetService.upsertEmployeeTarget(
      empId, selMonth, selYear,
      parseFloat(edit.sales_target) || 0,
      parseFloat(edit.visits_target) || 0,
      parseFloat(edit.orders_target) || 0,
      parseFloat(edit.new_customers_target) || 0,
      0, token
    )
    setSavingEmployee(null)
    if (error) { setEmployeeError(error.message || 'حدث خطأ أثناء الحفظ'); return }
    setEmployeeSuccess(empId)
    setEmployeeTargetMap(prev => ({
      ...prev,
      [empId]: {
        employee_id: empId, sales_target: parseFloat(edit.sales_target) || 0,
        visits_target: parseFloat(edit.visits_target) || 0,
        orders_target: parseFloat(edit.orders_target) || 0,
        new_customers_target: parseFloat(edit.new_customers_target) || 0, is_locked: false,
      },
    }))
    setTimeout(() => setEmployeeSuccess(null), 2000)
  }, [savingEmployee, employeeEdits, selMonth, selYear])

  function toggleManager(mgrId: string) {
    setExpandedManagers(prev => ({ ...prev, [mgrId]: !prev[mgrId] }))
  }

  function roleBadgeColor(role: string): string {
    switch (role) {
      case 'مدير البيع': return 'bg-purple-100 text-purple-700'
      case 'سوبر فايزر': return 'bg-amber-100 text-amber-700'
      default: return 'bg-blue-100 text-blue-700'
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-400 text-sm">جاري التحميل...</div>
  }

  return (
    <div className="p-4 space-y-6">
      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
        <h3 className="text-sm font-bold text-gray-800 mb-3">هدف الشركة</h3>
        <div className="space-y-3">
          {KPI_FIELDS.map(field => (
            <div key={field.key}>
              <label className="text-[10px] text-gray-500 block mb-1">{field.label} ({field.unit})</label>
              <input type="number" value={companyEdit[field.key]}
                onChange={e => setCompanyEdit(prev => ({ ...prev, [field.key]: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg p-2 text-sm text-gray-800 text-right bg-white" />
            </div>
          ))}
        </div>
        {companySuccess && (
          <div className="mt-3 bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg p-3">تم حفظ هدف الشركة بنجاح</div>
        )}
        {companyError && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-3">{companyError}</div>
        )}
        <button onClick={handleSaveCompany} disabled={savingCompany}
          className="mt-3 w-full py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-semibold active:opacity-80 disabled:opacity-50 transition-colors cursor-pointer">
          {savingCompany ? 'جاري الحفظ...' : 'حفظ هدف الشركة'}
        </button>
      </div>

      {managers.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-gray-800 mb-3">توزيع الأهداف على مدراء البيع</h3>
          <div className="space-y-3">
            {managers.map(mgr => {
              const team = getTeam(mgr.employee_id)
              const expanded = expandedManagers[mgr.employee_id]
              return (
                <div key={mgr.employee_id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  <button onClick={() => { ensureEdit(mgr); toggleManager(mgr.employee_id) }}
                    className="w-full flex items-center justify-between p-4 active:bg-gray-50 transition-colors cursor-pointer">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-xs shrink-0 transition-transform text-gray-400 ${expanded ? 'rotate-90' : ''}`}>▶</span>
                      <div className="text-right min-w-0">
                        <p className="text-[10px] text-gray-400 font-mono">{mgr.employee_code}</p>
                        <p className="text-sm font-bold text-gray-800 truncate">{mgr.employee_name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${roleBadgeColor(mgr.role_type)}`}>
                        {mgr.role_type}
                      </span>
                      {employeeTargetMap[mgr.employee_id] && (
                        <span className="text-[10px] text-gray-500 bg-gray-50 rounded-md px-2 py-0.5">
                          {'🎯 ' + employeeTargetMap[mgr.employee_id].sales_target.toLocaleString('ar-EG-u-nu-latn')}
                        </span>
                      )}
                    </div>
                  </button>

                  {expanded && (
                    <div className="border-t border-gray-100 px-4 pb-4 pt-3 space-y-4">
                      <div className="space-y-3">
                        <p className="text-xs font-semibold text-gray-500">هدف {mgr.employee_name}</p>
                        {KPI_FIELDS.map(field => (
                          <div key={field.key}>
                            <label className="text-[10px] text-gray-500 block mb-1">{field.label} ({field.unit})</label>
                            <input type="number"
                              value={employeeEdits[mgr.employee_id]?.[field.key] || '0'}
                              onChange={e => setEmployeeEdits(prev => ({
                                ...prev,
                                [mgr.employee_id]: { ...prev[mgr.employee_id], [field.key]: e.target.value },
                              }))}
                              className="w-full border border-gray-200 rounded-lg p-2 text-sm text-gray-800 text-right bg-white" />
                          </div>
                        ))}
                        {employeeSuccess === mgr.employee_id && (
                          <div className="bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg p-2">تم الحفظ</div>
                        )}
                        {employeeError && savingEmployee === mgr.employee_id && (
                          <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-2">{employeeError}</div>
                        )}
                        <button onClick={() => handleSaveEmployee(mgr.employee_id)}
                          disabled={savingEmployee === mgr.employee_id}
                          className="w-full py-2 bg-indigo-600 text-white rounded-xl text-xs font-semibold active:opacity-80 disabled:opacity-50 transition-colors cursor-pointer">
                          {savingEmployee === mgr.employee_id ? 'جاري الحفظ...' : 'حفظ هدف المدير'}
                        </button>
                      </div>

                      {team.length > 0 && (
                        <div className="space-y-3 pt-2 border-t border-gray-100/50">
                          <p className="text-xs font-semibold text-gray-500">فريق {mgr.employee_name}</p>
                          {team.map(member => (
                            <div key={member.employee_id} className="bg-gray-50 rounded-lg border border-gray-100 p-3 space-y-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-[10px] text-gray-400 font-mono">{member.employee_code}</p>
                                  <p className="text-xs font-bold text-gray-800">{member.employee_name}</p>
                                </div>
                                <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${roleBadgeColor(member.role_type)}`}>
                                  {member.role_type}
                                </span>
                              </div>
                              {KPI_FIELDS.map(field => (
                                <div key={field.key}>
                                  <label className="text-[9px] text-gray-500 block mb-0.5">{field.label} ({field.unit})</label>
                                  <input type="number"
                                    value={employeeEdits[member.employee_id]?.[field.key] || '0'}
                                    onChange={e => setEmployeeEdits(prev => ({
                                      ...prev,
                                      [member.employee_id]: {
                                        ...(prev[member.employee_id] || {
                                          employee_id: member.employee_id, employee_code: member.employee_code,
                                          employee_name: member.employee_name, sales_target: '0', visits_target: '0',
                                          orders_target: '0', new_customers_target: '0',
                                        }),
                                        [field.key]: e.target.value,
                                      },
                                    }))}
                                    className="w-full border border-gray-200 rounded-lg p-1.5 text-xs text-gray-800 text-right bg-white" />
                                </div>
                              ))}
                              {employeeSuccess === member.employee_id && (
                                <div className="bg-green-50 border border-green-200 text-green-700 text-[10px] rounded-lg p-1.5">تم الحفظ</div>
                              )}
                              <button onClick={() => { ensureEdit(member); handleSaveEmployee(member.employee_id) }}
                                disabled={savingEmployee === member.employee_id}
                                className="w-full py-1.5 bg-indigo-600 text-white rounded-lg text-[11px] font-semibold active:opacity-80 disabled:opacity-50 transition-colors cursor-pointer">
                                {savingEmployee === member.employee_id ? 'جاري الحفظ...' : 'حفظ هدف العضو'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {managers.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
          <p className="text-xs text-amber-700 font-semibold">لا يوجد مدراء بيع لعرضهم</p>
          <p className="text-[10px] text-amber-600 mt-1">تأكد من وجود موظفين بدور "مدير بيع" في النظام</p>
        </div>
      )}
    </div>
  )
}
