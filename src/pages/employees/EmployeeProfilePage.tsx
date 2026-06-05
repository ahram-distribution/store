import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../utils/format'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
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
      p_token: token,
      p_id: employee.id,
      p_full_name: editName || null,
      p_email: editEmail || null,
      p_phone: editPhone || null,
      p_address: editAddress || null,
      p_password: editPassword || null,
    })
    if (error) { toast.error(error.message); setSaving(false); return }
    const result = error as any
    if (result?.error) { toast.error(result.error); setSaving(false); return }

    // Change manager if changed
    if (editManagerId !== (employee.manager_id || '')) {
      const mgrRes = await supabase.rpc('governed_change_employee_manager', {
        p_token: token, p_id: employee.id, p_manager_id: editManagerId || null,
      })
      if (mgrRes.error) { toast.error('تم حفظ البيانات لكن فشل تغيير المدير'); setSaving(false); return }
    }

    // Change role if changed
    if (editRoleId !== (employee.roles?.[0]?.id || '')) {
      const roleRes = await supabase.rpc('governed_change_employee_role', {
        p_token: token, p_id: employee.id, p_role_id: editRoleId || null,
      })
      if (roleRes.error) { toast.error('تم حفظ البيانات لكن فشل تغيير الصلاحية'); setSaving(false); return }
    }

    toast.success('تم حفظ التغييرات')
    setSaving(false)
    setEditPassword('')

    // Refresh
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
        setEditName(updated.full_name || '')
        setEditEmail(updated.email || '')
        setEditPhone(updated.phone || '')
        setEditAddress(updated.address || '')
        setEditManagerId(updated.manager_id || '')
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
    setShowResetPw(false)
    setResetPwValue('')
  }

  const typeLabels: Record<string, string> = {
    order: 'طلب', visit: 'زيارة', collection: 'تحصيل',
  }
  const typeColors: Record<string, string> = {
    order: 'bg-primary/10 text-primary',
    visit: 'bg-accent/10 text-accent',
    collection: 'bg-success/10 text-success',
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!employee) return <div className="text-center py-12 text-text-secondary text-sm">الموظف غير موجود</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/employees')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">{employee.full_name}</h1>
        {!employee.is_active && <span className="text-[10px] bg-danger/10 text-danger px-2 py-0.5 rounded">موقوف</span>}
      </div>

      {/* Profile / Edit Card */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">البيانات الشخصية</h2>
          <span className="text-[10px] text-text-secondary">{employee.code}</span>
        </div>

        <div>
          <label className="text-[10px] text-text-secondary block mb-0.5">الاسم الكامل</label>
          <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" />
        </div>

        <div>
          <label className="text-[10px] text-text-secondary block mb-0.5">رقم الهاتف</label>
          <input type="text" value={editPhone} onChange={(e) => setEditPhone(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" dir="ltr" />
        </div>

        <div>
          <label className="text-[10px] text-text-secondary block mb-0.5">البريد الإلكتروني</label>
          <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" dir="ltr" />
        </div>

        <div>
          <label className="text-[10px] text-text-secondary block mb-0.5">العنوان</label>
          <textarea value={editAddress} onChange={(e) => setEditAddress(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white resize-none" rows={2} />
        </div>

        <div>
          <label className="text-[10px] text-text-secondary block mb-0.5">كلمة المرور</label>
          <input type="text" value={editPassword} onChange={(e) => setEditPassword(e.target.value)}
            placeholder="اترك فارغاً بدون تغيير" dir="ltr"
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white" />
        </div>

        <div>
          <label className="text-[10px] text-text-secondary block mb-0.5">المسمى الوظيفي (الصلاحية)</label>
          <select value={editRoleId} onChange={(e) => setEditRoleId(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">اختر الصلاحية</option>
            {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>

        <div>
          <label className="text-[10px] text-text-secondary block mb-0.5">المدير المباشر</label>
          <select value={editManagerId} onChange={(e) => setEditManagerId(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">بدون مدير</option>
            {employees.filter((e: any) => e.id !== employee.id && e.is_active).map((e: any) => (
              <option key={e.id} value={e.id}>{e.full_name} ({e.code})</option>
            ))}
          </select>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-primary text-white text-xs py-2.5 rounded-lg font-semibold">
            {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
          </button>
          <button onClick={handleToggleActive}
            className={`text-xs px-4 py-2.5 rounded-lg font-semibold ${employee.is_active ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
            {employee.is_active ? 'إيقاف' : 'تفعيل'}
          </button>
          <button onClick={() => setShowResetPw(!showResetPw)}
            className="text-xs px-4 py-2.5 rounded-lg font-semibold bg-accent/10 text-accent">
            إعادة كلمة السر
          </button>
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

      {/* Manager info */}
      {manager && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h2 className="text-xs text-text-secondary mb-1">المدير المباشر</h2>
          <span className="text-sm font-semibold text-primary cursor-pointer" onClick={() => navigate(`/employees/${manager.id}`)}>
            {manager.full_name}
          </span>
        </div>
      )}

      {/* Subordinates */}
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

      {/* Capabilities */}
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
          <div className="space-y-1 max-h-60 overflow-y-auto">
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
          <div className="mt-3 border-t border-border pt-3 space-y-2">
            <p className="text-xs text-text-secondary">إضافة صلاحية مباشرة (تجاوز الدور)</p>
            <select onChange={async (e) => {
              if (!e.target.value) return
              const capId = e.target.value
              const token = getToken()
              const currentDirect = empCapabilities.filter((c: any) => !c.from_role && c.grant_type)
              const exists = currentDirect.find((c: any) => c.id === capId)
              const newCaps = exists
                ? currentDirect.filter((c: any) => c.id !== capId)
                : [...currentDirect.map((c: any) => ({ capability_id: c.id, grant_type: c.grant_type })), { capability_id: capId, grant_type: 'grant' }]
              const { error } = await supabase.rpc('governed_update_employee_capabilities', {
                p_token: token, p_id: employee.id, p_capabilities: newCaps,
              })
              if (error) { toast.error(error.message); return }
              toast.success('تم تحديث الصلاحيات')
              const capsRes = await supabase.rpc('get_employee_capabilities', { p_token: token, p_employee_id: employee.id })
              if (capsRes.data) setEmpCapabilities(Array.isArray(capsRes.data) ? capsRes.data : [])
              setShowCapabilityPicker(false)
            }} className="w-full border border-border rounded-lg px-3 py-1.5 text-xs bg-white">
              <option value="">اختر صلاحية...</option>
              {allCapabilities
                .filter((c: any) => {
                  const existing = empCapabilities.find((ec: any) => ec.id === c.id)
                  return !existing || !existing.from_role || !existing.grant_type
                })
                .map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                ))}
            </select>
          </div>
        )}
      </div>

      {/* Activity */}
      <div className="bg-white rounded-xl border border-border p-4">
        <h2 className="text-sm font-bold mb-3">النشاطات الأخيرة</h2>
        {activity.length === 0 ? (
          <p className="text-xs text-text-secondary text-center py-4">لا توجد نشاطات</p>
        ) : (
          <div className="space-y-2">
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
    </div>
  )
}
