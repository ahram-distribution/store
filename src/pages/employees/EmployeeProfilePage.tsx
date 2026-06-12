import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../utils/format'
import { targetService } from '../../services/targets'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const TABS = [
  { key: 'info', label: 'البيانات الأساسية' },
  { key: 'org', label: 'الهيكل التنظيمي' },
  { key: 'permissions', label: 'الصلاحيات' },
  { key: 'targets', label: 'الأهداف والأوزان' },
  { key: 'attendance', label: 'ملخص الحضور' },
  { key: 'audit', label: 'سجل النشاطات' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabKey>('info')
  const [employee, setEmployee] = useState<any>(null)
  const [employees, setEmployees] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [activity, setActivity] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [editManagerId, setEditManagerId] = useState('')
  const [editRoleId, setEditRoleId] = useState('')
  const [showResetPw, setShowResetPw] = useState(false)
  const [resetPwValue, setResetPwValue] = useState('')
  const [allCapabilities, setAllCapabilities] = useState<any[]>([])
  const [empCapabilities, setEmpCapabilities] = useState<any[]>([])
  const [showCapabilityPicker, setShowCapabilityPicker] = useState(false)

  // Targets state
  const [selMonth, setSelMonth] = useState(new Date().getMonth() + 1)
  const [selYear, setSelYear] = useState(new Date().getFullYear())
  const [targets, setTargets] = useState<any>(null)
  const [performance, setPerformance] = useState<any>(null)
  const [editTargets, setEditTargets] = useState(false)
  const [targetForm, setTargetForm] = useState({ sales_target: '', orders_target: '', visits_target: '', new_customers_target: '', collections_target: '' })

  // Attendance state
  const [attendanceSummary, setAttendanceSummary] = useState<any>(null)

  useEffect(() => {
    if (!id) return
    const token = getToken()
    if (!token) return

    Promise.all([
      supabase.rpc('get_governed_employees', { p_token: token }),
      supabase.rpc('get_employee_activity', { p_token: token, p_employee_id: id, p_limit: 50 }),
      supabase.rpc('get_governed_roles', { p_token: token }),
      supabase.rpc('get_all_capabilities', { p_token: token }),
      supabase.rpc('get_employee_capabilities', { p_token: token, p_employee_id: id }),
    ]).then(([empRes, actRes, roleRes, capsRes, empCapsRes]) => {
      if (empRes.data) {
        const list = Array.isArray(empRes.data) ? empRes.data : []
        setEmployees(list)
        const found = list.find((e: any) => e.id === id) || null
        setEmployee(found)
        if (found) {
          setEditName(found.full_name || '')
          setEditEmail(found.email || '')
          setEditPhone(found.phone || '')
          setEditAddress(found.address || '')
          setEditManagerId(found.manager_id || '')
          setEditRoleId(found.roles?.[0]?.id || '')
        }
      }
      if (actRes.data) setActivity(Array.isArray(actRes.data) ? actRes.data : [])
      if (roleRes.data) setRoles(Array.isArray(roleRes.data) ? roleRes.data : [])
      if (capsRes.data) setAllCapabilities(Array.isArray(capsRes.data) ? capsRes.data : [])
      if (empCapsRes.data) setEmpCapabilities(Array.isArray(empCapsRes.data) ? empCapsRes.data : [])
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    if (!id || activeTab !== 'targets') return
    const token = getToken()
    if (!token) return
    Promise.all([
      targetService.getEmployeeTargets(selMonth, selYear, token),
      targetService.getPerformance(selMonth, selYear, token),
    ]).then(([targetRes, perfRes]) => {
      if (targetRes.data && !targetRes.error) {
        const list = Array.isArray(targetRes.data) ? targetRes.data : []
        const empTarget = list.find((t: any) => t.employee_id === id)
        setTargets(empTarget || null)
        if (empTarget) {
          setTargetForm({
            sales_target: empTarget.sales_target?.toString() || '',
            orders_target: empTarget.orders_target?.toString() || '',
            visits_target: empTarget.visits_target?.toString() || '',
            new_customers_target: empTarget.new_customers_target?.toString() || '',
            collections_target: empTarget.collections_target?.toString() || '',
          })
        } else {
          setTargetForm({ sales_target: '', orders_target: '', visits_target: '', new_customers_target: '', collections_target: '' })
        }
      }
      if (perfRes.data && !perfRes.error) {
        const list = Array.isArray(perfRes.data) ? perfRes.data : []
        const empPerf = list.find((p: any) => p.employee_id === id)
        setPerformance(empPerf || null)
      }
    })
  }, [id, activeTab, selMonth, selYear])

  useEffect(() => {
    if (!id || activeTab !== 'attendance') return
    const token = getToken()
    if (!token) return
    supabase.rpc('get_attendance_analysis', {
      p_token: token,
      p_start_date: `${selYear}-${String(selMonth).padStart(2, '0')}-01`,
      p_end_date: null,
    }).then(r => {
      if (r.data && !r.error) {
        const data = Array.isArray(r.data) ? r.data : []
        const empAtt = data.find((a: any) => a.employee_id === id || a.employee === id)
        setAttendanceSummary(empAtt || null)
      }
    })
  }, [id, activeTab, selMonth, selYear])

  const subordinates = useMemo(() => {
    if (!id) return []
    return employees.filter((e: any) => e.manager_id === id)
  }, [employees, id])

  const manager = useMemo(() => {
    if (!employee?.manager_id) return null
    return employees.find((e: any) => e.id === employee.manager_id)
  }, [employee, employees])

  async function handleSave() {
    if (!employee) return
    setSaving(true)
    const token = getToken()
    const { error } = await supabase.rpc('governed_update_employee', {
      p_token: token, p_id: employee.id,
      p_full_name: editName || null, p_email: editEmail || null,
      p_phone: editPhone || null, p_address: editAddress || null,
      p_password: editPassword || null,
    })
    if (error) { toast.error(error.message); setSaving(false); return }
    if (editManagerId !== (employee.manager_id || '')) {
      const mgrRes = await supabase.rpc('governed_change_employee_manager', { p_token: token, p_id: employee.id, p_manager_id: editManagerId || null })
      if (mgrRes.error) { toast.error('تم حفظ البيانات لكن فشل تغيير المدير'); setSaving(false); return }
    }
    if (editRoleId !== (employee.roles?.[0]?.id || '')) {
      const roleRes = await supabase.rpc('governed_change_employee_role', { p_token: token, p_id: employee.id, p_role_id: editRoleId || null })
      if (roleRes.error) { toast.error('تم حفظ البيانات لكن فشل تغيير الصلاحية'); setSaving(false); return }
    }
    toast.success('تم حفظ التغييرات')
    setSaving(false); setEditPassword('')
    const [empRes, empCapsRes] = await Promise.all([
      supabase.rpc('get_governed_employees', { p_token: token }),
      supabase.rpc('get_employee_capabilities', { p_token: token, p_employee_id: employee.id }),
    ])
    if (empRes.data) {
      const list = Array.isArray(empRes.data) ? empRes.data : []
      setEmployees(list)
      const updated = list.find((e: any) => e.id === employee.id) || null
      setEmployee(updated)
      if (updated) {
        setEditName(updated.full_name || ''); setEditEmail(updated.email || ''); setEditPhone(updated.phone || '')
        setEditAddress(updated.address || ''); setEditManagerId(updated.manager_id || '')
        setEditRoleId(updated.roles?.[0]?.id || '')
      }
    }
    if (empCapsRes.data) setEmpCapabilities(Array.isArray(empCapsRes.data) ? empCapsRes.data : [])
  }

  async function handleToggleActive() {
    if (!employee) return
    const token = getToken()
    const fn = employee.is_active ? 'governed_deactivate_employee' : 'governed_activate_employee'
    const { error } = await supabase.rpc(fn, { p_token: token, p_id: employee.id })
    if (error) { toast.error(error.message); return }
    toast.success(employee.is_active ? 'تم الإيقاف' : 'تم التفعيل')
    const empRes = await supabase.rpc('get_governed_employees', { p_token: token })
    if (empRes.data) {
      const list = Array.isArray(empRes.data) ? empRes.data : []
      setEmployees(list)
      setEmployee(list.find((e: any) => e.id === employee.id) || null)
    }
  }

  async function handleResetPassword() {
    if (!employee) return
    const token = getToken()
    const pw = resetPwValue || '123456'
    const { error } = await supabase.rpc('governed_reset_employee_password', { p_token: token, p_id: employee.id, p_new_password: pw })
    if (error) { toast.error(error.message); return }
    toast.success(`تم إعادة تعيين كلمة المرور إلى ${pw}`)
    setShowResetPw(false); setResetPwValue('')
  }

  async function saveTargets() {
    const token = getToken()
    if (!token || !id) return
    const { error } = await targetService.upsertEmployeeTarget(
      id, selMonth, selYear,
      parseFloat(targetForm.sales_target) || 0,
      parseFloat(targetForm.visits_target) || 0,
      parseFloat(targetForm.orders_target) || 0,
      parseFloat(targetForm.new_customers_target) || 0,
      parseFloat(targetForm.collections_target) || 0,
      token
    )
    if (error) { toast.error(error.message); return }
    toast.success('تم حفظ الهدف')
    setEditTargets(false)
    const targetRes = await targetService.getEmployeeTargets(selMonth, selYear, token)
    if (targetRes.data) {
      const list = Array.isArray(targetRes.data) ? targetRes.data : []
      setTargets(list.find((t: any) => t.employee_id === id) || null)
    }
  }

  async function handleCapabilityToggle(capId: string) {
    const token = getToken()
    if (!token || !id) return
    const currentDirect = empCapabilities.filter((c: any) => !c.from_role && c.grant_type)
    const exists = currentDirect.find((c: any) => c.id === capId)
    const newCaps = exists
      ? currentDirect.filter((c: any) => c.id !== capId).map((c: any) => ({ capability_id: c.id, grant_type: c.grant_type }))
      : [...currentDirect.map((c: any) => ({ capability_id: c.id, grant_type: c.grant_type })), { capability_id: capId, grant_type: 'grant' }]
    const { error } = await supabase.rpc('governed_update_employee_capabilities', { p_token: token, p_id: id, p_capabilities: newCaps })
    if (error) { toast.error(error.message); return }
    toast.success('تم تحديث الصلاحيات')
    const capsRes = await supabase.rpc('get_employee_capabilities', { p_token: token, p_employee_id: id })
    if (capsRes.data) setEmpCapabilities(Array.isArray(capsRes.data) ? capsRes.data : [])
  }

  const typeLabels: Record<string, string> = { order: 'طلب', visit: 'زيارة', collection: 'تحصيل' }
  const typeColors: Record<string, string> = {
    order: 'bg-primary/10 text-primary', visit: 'bg-accent/10 text-accent', collection: 'bg-success/10 text-success',
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!employee) return <div className="text-center py-12 text-text-secondary text-sm">الموظف غير موجود</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/employees')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">{employee.full_name}</h1>
        {!employee.is_active && <span className="text-[10px] bg-danger/10 text-danger px-2 py-0.5 rounded">موقف</span>}
        <span className="text-[10px] text-text-secondary">{employee.code}</span>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1 border-b border-border">
        {TABS.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors ${
              activeTab === tab.key ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:text-text'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Basic Info */}
      {activeTab === 'info' && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">البيانات الشخصية</h2>
          </div>
          <div><label className="text-[10px] text-text-secondary block mb-0.5">الاسم الكامل</label>
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" /></div>
          <div><label className="text-[10px] text-text-secondary block mb-0.5">رقم الهاتف</label>
            <input type="text" value={editPhone} onChange={(e) => setEditPhone(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" dir="ltr" /></div>
          <div><label className="text-[10px] text-text-secondary block mb-0.5">البريد الإلكتروني</label>
            <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" dir="ltr" /></div>
          <div><label className="text-[10px] text-text-secondary block mb-0.5">العنوان</label>
            <textarea value={editAddress} onChange={(e) => setEditAddress(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white resize-none" rows={2} /></div>
          <div><label className="text-[10px] text-text-secondary block mb-0.5">كلمة المرور</label>
            <input type="text" value={editPassword} onChange={(e) => setEditPassword(e.target.value)}
              placeholder="اترك فارغاً بدون تغيير" dir="ltr"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" /></div>
          <div><label className="text-[10px] text-text-secondary block mb-0.5">المسمى الوظيفي (الصلاحية)</label>
            <select value={editRoleId} onChange={(e) => setEditRoleId(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">اختر الصلاحية</option>
              {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></div>
          <div><label className="text-[10px] text-text-secondary block mb-0.5">المدير المباشر</label>
            <select value={editManagerId} onChange={(e) => setEditManagerId(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">بدون مدير</option>
              {employees.filter((e: any) => e.id !== employee.id && e.is_active).map((e: any) => (
                <option key={e.id} value={e.id}>{e.full_name} ({e.code})</option>
              ))}
            </select></div>
          <div className="flex gap-2 pt-2">
            <button onClick={handleSave} disabled={saving}
              className="flex-1 bg-primary text-white text-xs py-2.5 rounded-lg font-semibold">
              {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}</button>
            <button onClick={handleToggleActive}
              className={`text-xs px-4 py-2.5 rounded-lg font-semibold ${employee.is_active ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
              {employee.is_active ? 'إيقاف' : 'تفعيل'}</button>
            <button onClick={() => setShowResetPw(!showResetPw)}
              className="text-xs px-4 py-2.5 rounded-lg font-semibold bg-accent/10 text-accent">إعادة كلمة السر</button>
          </div>
          {showResetPw && (
            <div className="border-t border-border pt-3 space-y-2">
              <label className="text-[10px] text-text-secondary block">كلمة المرور الجديدة</label>
              <input type="text" value={resetPwValue} onChange={(e) => setResetPwValue(e.target.value)}
                placeholder="اترك فارغاً لاستخدام 123456" dir="ltr"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" />
              <div className="flex gap-2">
                <button onClick={handleResetPassword} className="flex-1 bg-accent text-white text-xs py-2 rounded-lg">تأكيد إعادة التعيين</button>
                <button onClick={() => { setShowResetPw(false); setResetPwValue('') }} className="px-4 border border-border rounded-lg text-xs">إلغاء</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Org Structure */}
      {activeTab === 'org' && (
        <div className="space-y-3">
          {manager && (
            <div className="bg-white rounded-xl border border-border p-4">
              <h2 className="text-xs text-text-secondary mb-1">المدير المباشر</h2>
              <span className="text-sm font-semibold text-primary cursor-pointer" onClick={() => navigate(`/employees/${manager.id}`)}>
                {manager.full_name}
              </span>
            </div>
          )}
          {subordinates.length > 0 && (
            <div className="bg-white rounded-xl border border-border p-4">
              <h2 className="text-sm font-bold mb-2">المرؤوسون ({subordinates.length})</h2>
              <div className="space-y-1">
                {subordinates.map((sub: any) => (
                  <div key={sub.id} onClick={() => navigate(`/employees/${sub.id}`)}
                    className="flex items-center justify-between py-1.5 px-2 hover:bg-surface rounded-lg cursor-pointer">
                    <span className="text-xs font-semibold">{sub.full_name}</span>
                    <span className="text-[10px] text-text-secondary">{sub.code}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!manager && subordinates.length === 0 && (
            <div className="bg-white rounded-xl border border-border p-4 text-center text-text-secondary text-xs py-8">
              لا توجد علاقات هيكلية
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Permissions */}
      {activeTab === 'permissions' && (
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold">الصلاحيات</h2>
            <button onClick={() => setShowCapabilityPicker(!showCapabilityPicker)}
              className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded">
              {showCapabilityPicker ? 'إلغاء' : 'تعديل الصلاحيات المباشرة'}
            </button>
          </div>
          {empCapabilities.length === 0 ? (
            <p className="text-xs text-text-secondary text-center py-4">لا توجد صلاحيات</p>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {empCapabilities.filter((c: any) => c.grant_type).map((c: any) => (
                <div key={c.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-surface/50">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">{c.name}</span>
                    <span className="text-[9px] text-text-secondary">{c.code}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {c.from_role ? (
                      <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">من الدور</span>
                    ) : (
                      <span className="text-[9px] bg-accent/10 text-accent px-1.5 py-0.5 rounded">مباشرة</span>
                    )}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${c.grant_type === 'deny' ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                      {c.grant_type === 'deny' ? 'ممنوع' : 'مسموح'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {showCapabilityPicker && (
            <div className="mt-3 border-t border-border pt-3 space-y-2 max-h-80 overflow-y-auto">
              <p className="text-xs text-text-secondary">إضافة صلاحية مباشرة (تجاوز الدور)</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                {allCapabilities.map((cap: any) => {
                  const existing = empCapabilities.find((ec: any) => ec.id === cap.id && !ec.from_role && ec.grant_type)
                  return (
                    <label key={cap.id} className="flex items-center gap-1.5 py-1 px-1.5 rounded hover:bg-surface/50 cursor-pointer">
                      <input type="checkbox" checked={!!existing}
                        onChange={() => handleCapabilityToggle(cap.id)}
                        className="w-3 h-3 accent-primary" />
                      <span className="text-[10px] text-text">{cap.name}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Targets & Weights */}
      {activeTab === 'targets' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => { if (selMonth === 1) { setSelMonth(12); setSelYear(selYear - 1) } else setSelMonth(selMonth - 1) }}
              className="px-2 py-1 border border-border rounded text-xs">{'‹'}</button>
            <span className="text-xs font-semibold flex-1 text-center">
              {['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'][selMonth - 1]} {selYear}
            </span>
            <button onClick={() => { if (selMonth === 12) { setSelMonth(1); setSelYear(selYear + 1) } else setSelMonth(selMonth + 1) }}
              className="px-2 py-1 border border-border rounded text-xs">{'›'}</button>
          </div>

          <div className="bg-white rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold">الأهداف الشهرية</h3>
              <button onClick={() => setEditTargets(!editTargets)}
                className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded">
                {editTargets ? 'إلغاء' : 'تعديل الأهداف'}
              </button>
            </div>

            {editTargets ? (
              <div className="space-y-3">
                {[
                  { key: 'sales_target', label: 'المبيعات (جنيه)' },
                  { key: 'orders_target', label: 'الطلبات (عدد)' },
                  { key: 'visits_target', label: 'الزيارات (عدد)' },
                  { key: 'new_customers_target', label: 'العملاء الجدد (عدد)' },
                  { key: 'collections_target', label: 'التحصيل (جنيه)' },
                ].map(field => (
                  <div key={field.key}>
                    <label className="text-[10px] text-text-secondary block mb-1">{field.label}</label>
                    <input type="number" value={(targetForm as any)[field.key]}
                      onChange={e => setTargetForm(f => ({ ...f, [field.key]: e.target.value }))}
                      className="w-full border border-border rounded-lg p-2 text-sm text-text text-right bg-white" />
                  </div>
                ))}
                <button onClick={saveTargets} className="w-full bg-primary text-white text-xs py-2 rounded-lg font-semibold">حفظ الأهداف</button>
              </div>
            ) : targets ? (
              <div className="space-y-2">
                {[
                  { label: 'المبيعات', value: targets.sales_target, actual: targets.sales_actual, pct: targets.sales_achievement_pct, unit: 'جنيه' },
                  { label: 'الطلبات', value: targets.orders_target, actual: targets.orders_actual, pct: targets.orders_achievement_pct, unit: 'عدد' },
                  { label: 'الزيارات', value: targets.visits_target, actual: targets.visits_actual, pct: targets.visits_achievement_pct, unit: 'عدد' },
                  { label: 'العملاء الجدد', value: targets.new_customers_target, actual: targets.new_customers_actual, pct: targets.new_customers_achievement_pct, unit: 'عدد' },
                  { label: 'التحصيل', value: targets.collections_target, actual: targets.collections_actual, pct: targets.collections_achievement_pct, unit: 'جنيه' },
                ].map(kpi => (
                  <div key={kpi.label} className="flex items-center justify-between py-1">
                    <span className="text-[11px] text-text-secondary font-semibold">{kpi.label}</span>
                    <span className="text-[11px] text-text-secondary">
                      {kpi.value > 0 ? `${(kpi.actual || 0).toLocaleString('ar-EG-u-nu-latn')} / ${kpi.value.toLocaleString('ar-EG-u-nu-latn')}` : '—'}
                    </span>
                    <span className={`text-[11px] font-bold ${kpi.pct >= 100 ? 'text-success' : kpi.pct >= 50 ? 'text-warning' : 'text-red-500'}`}>
                      {kpi.pct != null ? kpi.pct.toFixed(1) + '%' : '—'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center py-4 text-text-secondary text-xs">لا توجد أهداف لهذا الشهر</p>
            )}
          </div>

          {performance && (
            <div className="bg-white rounded-xl border border-border p-4">
              <h3 className="text-sm font-bold mb-3">التقييم الإجمالي</h3>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="text-2xl font-bold" style={{ color: performance.overall_pct >= 70 ? '#22c55e' : performance.overall_pct >= 40 ? '#eab308' : '#ef4444' }}>
                    {performance.overall_pct != null ? performance.overall_pct.toFixed(1) + '%' : '—'}
                  </div>
                  <div className="text-[10px] text-text-secondary">نسبة الإنجاز</div>
                </div>
                <div className="text-left">
                  <div className="text-sm font-semibold">{performance.overall_score != null ? performance.overall_score.toFixed(1) : '—'}</div>
                  <div className="text-[10px] text-text-secondary">الدرجة</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Attendance Summary */}
      {activeTab === 'attendance' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-border p-4">
            <h3 className="text-sm font-bold mb-3">ملخص الحضور</h3>
            {attendanceSummary ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface rounded-lg p-3 text-center">
                    <div className="text-lg font-bold text-primary">{(attendanceSummary.total_sessions || 0).toLocaleString('ar-EG-u-nu-latn')}</div>
                    <div className="text-[10px] text-text-secondary">أيام العمل</div>
                  </div>
                  <div className="bg-surface rounded-lg p-3 text-center">
                    <div className="text-lg font-bold text-success">{(attendanceSummary.total_net_hours || 0).toFixed(1)}</div>
                    <div className="text-[10px] text-text-secondary">صافي الساعات</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-surface/50 rounded-lg p-2 text-center">
                    <div className="text-sm font-bold text-success">{attendanceSummary.ontime_days || 0}</div>
                    <div className="text-[9px] text-text-secondary">في الموعد</div>
                  </div>
                  <div className="bg-surface/50 rounded-lg p-2 text-center">
                    <div className="text-sm font-bold text-warning">{attendanceSummary.late_days || 0}</div>
                    <div className="text-[9px] text-text-secondary">متأخر</div>
                  </div>
                  <div className="bg-surface/50 rounded-lg p-2 text-center">
                    <div className="text-sm font-bold text-danger">{attendanceSummary.early_departure_days || 0}</div>
                    <div className="text-[9px] text-text-secondary">مغادرة مبكرة</div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-center py-8 text-text-secondary text-xs">لا توجد بيانات حضور</p>
            )}
          </div>
        </div>
      )}

      {/* Tab 6: Audit History */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h2 className="text-sm font-bold mb-3">سجل النشاطات</h2>
          {activity.length === 0 ? (
            <p className="text-xs text-text-secondary text-center py-4">لا توجد نشاطات</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {activity.map((a: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-2 py-0.5 rounded ${typeColors[a.type] || 'bg-surface text-text-secondary'}`}>
                      {typeLabels[a.type] || a.type}
                    </span>
                    <span className="text-xs font-medium">{a.ref}</span>
                  </div>
                  <span className="text-[10px] text-text-secondary">{formatDateTime(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
