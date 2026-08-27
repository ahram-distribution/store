import { useState, useEffect, useMemo } from 'react'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { useCapability } from '../../hooks/useCapability'
import { sectorsService } from '../../services/sectors'
import { SearchableSelect } from '../../components/shared/SearchableSelect'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const DELETE_STEPS = [
  'نقل العملاء',
  'نقل الطلبات',
  'نقل الزيارات',
  'نقل بقية الممتلكات',
  'التحقق من اكتمال النقل',
  'حذف الحساب',
]

export function EmployeesPage({ embedded }: { embedded?: boolean }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const currentUser = useAuthStore((s) => s.user)
  const [employees, setEmployees] = useState<any[]>([])
  const [roles, setRoles] = useState<any[]>([])
  const [viewState, setViewState, resetViewState] = usePersistentViewState('employees-list', {
    searchQuery: '',
    roleFilter: searchParams.get('role') || '',
    statusFilter: 'all' as 'all' | 'active' | 'inactive',
  })
  const { searchQuery, roleFilter, statusFilter } = viewState
  const [loading, setLoading] = useState(true)

  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newRoleId, setNewRoleId] = useState('')
  const [newManagerId, setNewManagerId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editPassword, setEditPassword] = useState('')
  const [showManagerPicker, setShowManagerPicker] = useState<string | null>(null)
  const [showRolePicker, setShowRolePicker] = useState<string | null>(null)
  const [showResetPw, setShowResetPw] = useState<string | null>(null)
  const [resetPwValue, setResetPwValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [deleteRunning, setDeleteRunning] = useState(false)
  const [deleteStep, setDeleteStep] = useState(0)
  const [deleteResult, setDeleteResult] = useState<any | null>(null)

  const canGeoAssignment = useCapability('geographic_assignment.manage')
  const [showGeoAssign, setShowGeoAssign] = useState<string | null>(null)
  const [geoAssignments, setGeoAssignments] = useState<Record<string, any[]>>({})
  const [geoGovs, setGeoGovs] = useState<any[]>([])
  const [geoSectors, setGeoSectors] = useState<any[]>([])
  const [newGeoType, setNewGeoType] = useState<'governorate' | 'sector'>('governorate')
  const [newGeoGovId, setNewGeoGovId] = useState('')
  const [newGeoSectorId, setNewGeoSectorId] = useState('')

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_governed_employees', { p_token: token }),
      supabase.rpc('get_governed_roles', { p_token: token }),
    ]).then(([empRes, roleRes]) => {
      if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
      if (roleRes.data) setRoles(Array.isArray(roleRes.data) ? roleRes.data : [])
      setLoading(false)
    })
    Promise.all([
      supabase.from('reference_governorates').select('id, name_ar').order('name_ar'),
      sectorsService.getSectors(),
    ]).then(([govRes, sectorData]) => {
      if (govRes.data) setGeoGovs(govRes.data)
      setGeoSectors(sectorData.filter((s: any) => s.is_active).map((s: any) => ({ id: s.id, name: s.name_ar || s.name })))
    }).catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    let list = employees
    if (statusFilter === 'active') list = list.filter((e: any) => e.is_active)
    if (statusFilter === 'inactive') list = list.filter((e: any) => !e.is_active)
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter((e: any) =>
        (e.full_name || '').toLowerCase().includes(q) ||
        (e.code || '').toLowerCase().includes(q) ||
        (e.phone || '').toLowerCase().includes(q)
      )
    }
    if (roleFilter) {
      list = list.filter((e: any) =>
        (e.role_names || '').toLowerCase().includes(roleFilter.toLowerCase())
      )
    }
    return list
  }, [employees, searchQuery, roleFilter, statusFilter])

  const roleOptions = useMemo(() => {
    const names = new Set<string>()
    employees.forEach((e: any) => {
      if (e.role_names) e.role_names.split(', ').forEach((r: string) => names.add(r.trim()))
    })
    return Array.from(names).sort()
  }, [employees])

  const currentRoles = currentUser?.roles ?? []
  const isExecutiveDirector = currentRoles.includes('الرئيس التنفيذي') || currentRoles.includes('executive_director')
  const isExactUpperMgmt = currentRoles.includes('الإدارة العليا')

  const assignableRoles = useMemo(() => {
    if (!isExecutiveDirector) return roles
    const allowed = new Set(['مدير البيع', 'مندوب مبيعات'])
    return roles.filter((r: any) => allowed.has(r.name))
  }, [roles, isExecutiveDirector])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName || !newPhone) { toast.error('الاسم ورقم الهاتف مطلوبان'); return }
    setSubmitting(true)
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_create_employee', {
      p_token: token,
      p_full_name: newName,
      p_phone: newPhone,
      p_password: newPassword || null,
      p_email: newEmail || null,
      p_role_id: newRoleId || null,
      p_manager_id: newManagerId || null,
      p_address: newAddress || null,
    })
    if (error) { toast.error(error.message); setSubmitting(false); return }
    const result = data as any
    if (result.error) { toast.error(result.error); setSubmitting(false); return }
    toast.success(`تم إضافة ${result.full_name}`)
    setShowAddForm(false); setNewName(''); setNewPhone(''); setNewPassword(''); setNewEmail(''); setNewAddress(''); setNewRoleId(''); setNewManagerId('')
    setSubmitting(false)
    const empRes = await supabase.rpc('get_governed_employees', { p_token: token })
    if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
  }

  async function handleEdit(emp: any) {
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_update_employee', {
      p_token: token,
      p_id: emp.id,
      p_full_name: editName || null,
      p_email: editEmail || null,
      p_phone: editPhone || null,
      p_address: editAddress || null,
      p_password: editPassword || null,
    })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success('تم التحديث')
    setEditingId(null)
    setEditPassword('')
    const empRes = await supabase.rpc('get_governed_employees', { p_token: token })
    if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
  }

  async function handleToggleActive(emp: any) {
    const token = getToken()
    const fn = emp.is_active ? 'governed_deactivate_employee' : 'governed_activate_employee'
    const { data, error } = await supabase.rpc(fn, { p_token: token, p_id: emp.id })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success(emp.is_active ? 'تم الإيقاف' : 'تم التفعيل')
    const empRes = await supabase.rpc('get_governed_employees', { p_token: token })
    if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
  }

  async function handleChangeManager(empId: string, managerId: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_change_employee_manager', {
      p_token: token, p_id: empId, p_manager_id: managerId,
    })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success('تم تغيير المدير')
    setShowManagerPicker(null)
    const empRes = await supabase.rpc('get_governed_employees', { p_token: token })
    if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
  }

  async function handleChangeRole(empId: string, roleId: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_change_employee_role', {
      p_token: token, p_id: empId, p_role_id: roleId,
    })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success('تم تغيير الصلاحية')
    setShowRolePicker(null)
    const empRes = await supabase.rpc('get_governed_employees', { p_token: token })
    if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
  }

  async function handleResetPassword(empId: string) {
    const token = getToken()
    const pw = resetPwValue || '123456'
    const { data, error } = await supabase.rpc('governed_reset_employee_password', {
      p_token: token, p_id: empId, p_new_password: pw,
    })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success(`تم إعادة تعيين كلمة المرور إلى ${pw}`)
    setShowResetPw(null)
    setResetPwValue('')
  }

  async function handleLoadGeoAssignments(empId: string) {
    try {
      const data = await sectorsService.getEmployeeAssignments(empId)
      setGeoAssignments(prev => ({ ...prev, [empId]: data }))
    } catch { setGeoAssignments(prev => ({ ...prev, [empId]: [] })) }
  }

  async function handleAddGeoAssignment(empId: string) {
    if (newGeoType === 'governorate' && !newGeoGovId) { toast.error('اختر المحافظة'); return }
    if (newGeoType === 'sector' && !newGeoSectorId) { toast.error('اختر القطاع'); return }
    try {
      await sectorsService.assignEmployeeGeographic({
        employee_id: empId,
        assignment_type: newGeoType,
        governorate_id: newGeoType === 'governorate' ? newGeoGovId : undefined,
        sector_id: newGeoType === 'sector' ? newGeoSectorId : undefined,
      })
      toast.success('تم التعيين')
      setNewGeoGovId(''); setNewGeoSectorId('')
      await handleLoadGeoAssignments(empId)
    } catch (e: any) { toast.error(e?.message || 'فشل التعيين') }
  }

  async function handleRemoveGeoAssignment(assignmentId: string, empId: string) {
    try {
      await sectorsService.removeEmployeeGeographic(assignmentId)
      toast.success('تم الإزالة')
      await handleLoadGeoAssignments(empId)
    } catch (e: any) { toast.error(e?.message) }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setDeleteRunning(true)
    setDeleteStep(0)
    setDeleteResult(null)
    const token = getToken()
    let tick = 0
    const timer = window.setInterval(() => {
      tick += 1
      setDeleteStep(Math.min(tick, DELETE_STEPS.length - 1))
    }, 380)
    try {
      const { data, error } = await supabase.rpc('governed_delete_employee_with_transfer', {
        p_token: token, p_employee_id: deleteTarget.id,
      })
      window.clearInterval(timer)
      const result = data as any
      if (error || result?.error) {
        toast.error(error?.message || result?.error || 'فشل حذف الحساب')
        setDeleteRunning(false)
        setDeleteTarget(null)
        return
      }
      setDeleteStep(DELETE_STEPS.length)
      setDeleteRunning(false)
      setDeleteResult(result)
      toast.success('تم نقل جميع الممتلكات وحذف الحساب بنجاح')
      const empRes = await supabase.rpc('get_governed_employees', { p_token: token })
      if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
    } catch (e: any) {
      window.clearInterval(timer)
      toast.error(e?.message || 'فشل حذف الحساب')
      setDeleteRunning(false)
      setDeleteTarget(null)
    }
  }

  return (
    <div className="space-y-4">
      {!embedded && (
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
          <h1 className="text-lg font-bold text-text">الموظفين</h1>
          <button onClick={() => setShowAddForm(true)} className="mr-auto bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ إضافة موظف</button>
        </div>
      )}
      {embedded && (
        <button onClick={() => setShowAddForm(true)} className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ إضافة موظف</button>
      )}

      <input type="text" value={searchQuery} onChange={(e) => setViewState({ searchQuery: e.target.value })}
        placeholder="بحث بالاسم أو الكود أو الهاتف..." className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />

      <div className="flex gap-2">
        <select value={statusFilter} onChange={(e) => setViewState({ statusFilter: e.target.value as any })}
          className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          <option value="all">الكل</option>
          <option value="active">نشط</option>
          <option value="inactive">موقوف</option>
        </select>
        <select value={roleFilter} onChange={(e) => setViewState({ roleFilter: e.target.value })}
          className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white flex-1">
          <option value="">كل الأدوار</option>
          {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {showAddForm && (
        <form onSubmit={handleAdd} className="bg-white rounded-lg border border-border p-4 space-y-3">
          <h2 className="text-sm font-bold">إضافة موظف جديد</h2>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="الاسم الكامل *" className="w-full border border-border rounded-lg px-3 py-2 text-sm" required />
          <input type="text" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="رقم الهاتف *" className="w-full border border-border rounded-lg px-3 py-2 text-sm" required dir="ltr" />
          <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="كلمة المرور (افتراضي: رقم الهاتف)" className="w-full border border-border rounded-lg px-3 py-2 text-sm" dir="ltr" />
          <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="البريد الإلكتروني" className="w-full border border-border rounded-lg px-3 py-2 text-sm" dir="ltr" />
          <textarea value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="العنوان" className="w-full border border-border rounded-lg px-3 py-2 text-sm resize-none" rows={2} />
          <SearchableSelect
            items={assignableRoles.map((r: any) => ({ id: r.id, name: r.name }))}
            value={newRoleId}
            onChange={setNewRoleId}
            placeholder="اختر الصلاحية"
          />
          <SearchableSelect
            items={employees.filter((e: any) => e.is_active).map((e: any) => ({ id: e.id, name: e.full_name }))}
            value={newManagerId}
            onChange={setNewManagerId}
            placeholder="المدير المباشر"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={submitting} className="flex-1 bg-primary text-white text-xs py-2 rounded-lg font-semibold">
              {submitting ? 'جاري الإضافة...' : 'إضافة'}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className="px-4 border border-border rounded-lg text-xs text-text-secondary">إلغاء</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا يوجد موظفين</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((emp: any) => (
            <div key={emp.id} className="bg-white rounded-xl border border-border p-3">
              <div className="flex items-start justify-between">
                <div className="flex-1 cursor-pointer" onClick={() => navigate(`/employees/${emp.id}`)}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-text">{emp.full_name}</span>
                    {!emp.is_active && <span className="text-[10px] bg-danger/10 text-danger px-2 py-0.5 rounded">موقوف</span>}
                  </div>
                  <div className="text-[11px] text-text-secondary mt-0.5">
                    {emp.code} {emp.phone && <span>| {emp.phone}</span>}
                  </div>
                  {emp.role_names && <div className="text-[10px] text-primary mt-0.5">{emp.role_names}</div>}
                </div>
              </div>

              <div className="flex gap-1.5 mt-2 flex-wrap">
                <button onClick={() => { setEditingId(emp.id); setEditName(emp.full_name); setEditEmail(emp.email || ''); setEditPhone(emp.phone || ''); setEditAddress(emp.address || ''); setEditPassword('') }}
                  className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded">تعديل</button>
                <button onClick={() => handleToggleActive(emp)}
                  className={`text-[10px] px-2 py-1 rounded ${emp.is_active ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                  {emp.is_active ? 'إيقاف' : 'تفعيل'}
                </button>
                <button onClick={() => setShowManagerPicker(emp.id)}
                  className="text-[10px] bg-surface text-text-secondary px-2 py-1 rounded">تغيير المدير</button>
                <button onClick={() => setShowRolePicker(emp.id)}
                  className="text-[10px] bg-surface text-text-secondary px-2 py-1 rounded">تغيير الصلاحية</button>
                <button onClick={() => setShowResetPw(emp.id)}
                  className="text-[10px] bg-surface text-text-secondary px-2 py-1 rounded">إعادة كلمة المرور</button>
                {canGeoAssignment && (
                  <button onClick={() => { setShowGeoAssign(emp.id); handleLoadGeoAssignments(emp.id) }}
                    className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded">التعيين الجغرافي</button>
                )}
                {isExactUpperMgmt && currentUser?.employee_id !== emp.id && (
                  <button onClick={() => setDeleteTarget(emp)}
                    className="text-[10px] bg-danger/10 text-danger px-2 py-1 rounded">حذف الحساب</button>
                )}
              </div>

              {editingId === emp.id && (
                <div className="mt-3 border-t border-border pt-3 space-y-2">
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="الاسم" className="w-full border border-border rounded-lg px-3 py-1.5 text-xs" />
                  <input type="text" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="البريد الإلكتروني" className="w-full border border-border rounded-lg px-3 py-1.5 text-xs" dir="ltr" />
                  <input type="text" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="رقم الهاتف" className="w-full border border-border rounded-lg px-3 py-1.5 text-xs" dir="ltr" />
                  <textarea value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="العنوان" className="w-full border border-border rounded-lg px-3 py-1.5 text-xs resize-none" rows={2} />
                  <input type="text" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="كلمة المرور الجديدة" className="w-full border border-border rounded-lg px-3 py-1.5 text-xs" dir="ltr" />
                  <div className="flex gap-2">
                    <button onClick={() => handleEdit(emp)} className="flex-1 bg-primary text-white text-xs py-1.5 rounded-lg">حفظ</button>
                    <button onClick={() => setEditingId(null)} className="px-4 border border-border rounded-lg text-xs">إلغاء</button>
                  </div>
                </div>
              )}

              {showManagerPicker === emp.id && (
                <div className="mt-3 border-t border-border pt-3">
                  <SearchableSelect
                    items={employees.filter((e: any) => e.id !== emp.id && e.is_active).map((e: any) => ({ id: e.id, name: e.full_name }))}
                    value=""
                    onChange={(val) => { if (val) handleChangeManager(emp.id, val) }}
                    placeholder="اختر المدير الجديد"
                  />
                  <button onClick={() => setShowManagerPicker(null)} className="text-xs text-text-secondary mt-1">إلغاء</button>
                </div>
              )}

              {showRolePicker === emp.id && (
                <div className="mt-3 border-t border-border pt-3">
                  <SearchableSelect
                    items={assignableRoles.map((r: any) => ({ id: r.id, name: r.name }))}
                    value=""
                    onChange={(val) => { if (val) handleChangeRole(emp.id, val) }}
                    placeholder="اختر الصلاحية الجديدة"
                  />
                  <button onClick={() => setShowRolePicker(null)} className="text-xs text-text-secondary mt-1">إلغاء</button>
                </div>
              )}

              {showResetPw === emp.id && (
                <div className="mt-3 border-t border-border pt-3">
                  <p className="text-xs text-text-secondary mb-1">كلمة المرور الجديدة</p>
                  <input type="text" value={resetPwValue} onChange={(e) => setResetPwValue(e.target.value)}
                    placeholder="اترك فارغاً لاستخدام 123456" dir="ltr"
                    className="w-full border border-border rounded-lg px-3 py-1.5 text-xs mb-2" />
                  <div className="flex gap-2">
                    <button onClick={() => handleResetPassword(emp.id)} className="flex-1 bg-accent text-white text-xs py-1.5 rounded-lg">تأكيد</button>
                    <button onClick={() => { setShowResetPw(null); setResetPwValue('') }} className="px-4 border border-border rounded-lg text-xs">إلغاء</button>
                  </div>
                </div>
              )}

              {showGeoAssign === emp.id && (
                <div className="mt-3 border-t border-border pt-3 space-y-2">
                  <p className="text-xs font-bold text-primary">التعيين الجغرافي</p>
                  {(geoAssignments[emp.id] || []).length > 0 && (
                    <div className="space-y-1">
                      {(geoAssignments[emp.id] || []).map((a: any) => (
                        <div key={a.id} className="flex items-center justify-between bg-surface rounded-lg px-2 py-1.5 text-[11px]">
                          <span>
                            {a.assignment_type === 'sector' ? 'قطاع: ' : 'محافظة: '}
                            <span className="font-semibold">{a.assignment_type === 'sector' ? a.sector_name : a.governorate_name}</span>
                          </span>
                          <button onClick={() => handleRemoveGeoAssignment(a.id, emp.id)} className="text-danger text-[10px]">إزالة</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <select value={newGeoType} onChange={e => { setNewGeoType(e.target.value as any); setNewGeoGovId(''); setNewGeoSectorId('') }}
                      className="border border-border rounded-lg px-2 py-1.5 text-[11px] bg-white">
                      <option value="governorate">محافظة</option>
                      <option value="sector">قطاع</option>
                    </select>
                    {newGeoType === 'governorate' ? (
                      <div className="flex-1">
                        <SearchableSelect items={geoGovs.map(g => ({ id: g.id, name: g.name_ar }))} value={newGeoGovId} onChange={setNewGeoGovId} placeholder="محافظة" />
                      </div>
                    ) : (
                      <div className="flex-1">
                        <SearchableSelect items={geoSectors} value={newGeoSectorId} onChange={setNewGeoSectorId} placeholder="قطاع" />
                      </div>
                    )}
                    <button onClick={() => handleAddGeoAssignment(emp.id)} className="bg-primary text-white text-[10px] px-2 py-1 rounded">+</button>
                  </div>
                  <button onClick={() => setShowGeoAssign(null)} className="text-[10px] text-text-secondary">إغلاق</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(deleteTarget || deleteResult) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="w-full max-w-md bg-white rounded-xl border border-border p-5 space-y-4">
            {deleteRunning ? (
              <>
                <h3 className="text-sm font-bold text-text">جاري حذف الحساب...</h3>
                <div className="space-y-1.5">
                  {DELETE_STEPS.map((step, i) => (
                    <div key={step} className={`text-xs ${i < deleteStep ? 'text-success' : i === deleteStep ? 'text-primary font-semibold' : 'text-text-secondary'}`}>
                      {i < deleteStep ? 'تم: ' : i === deleteStep ? 'جاري: ' : ''}{step}
                    </div>
                  ))}
                </div>
              </>
            ) : deleteResult ? (
              <>
                <h3 className="text-sm font-bold text-success">تم حذف الحساب ونقل جميع الممتلكات</h3>
                <div className="text-xs space-y-1 text-text">
                  <div><span className="font-semibold">الحساب المحذوف:</span> {deleteResult.employee_name} ({deleteResult.employee_code})</div>
                  <div><span className="font-semibold">استلم الملكية:</span> {deleteResult.target_name} ({deleteResult.target_code})</div>
                  <div className="border-t border-border pt-2 mt-2 grid grid-cols-2 gap-1">
                    <div>العملاء: {deleteResult.transferred.customers}</div>
                    <div>الطلبات: {deleteResult.transferred.orders}</div>
                    <div>الزيارات: {deleteResult.transferred.visits}</div>
                    <div>التحصيلات: {deleteResult.transferred.collections}</div>
                    <div>المرتجعات: {deleteResult.transferred.returns}</div>
                    <div>مهام التوصيل: {deleteResult.transferred.delivery_assignments}</div>
                    <div>مهام السائقين: {deleteResult.transferred.delivery_drivers}</div>
                    <div>المرؤوسون: {deleteResult.transferred.subordinates}</div>
                  </div>
                </div>
                <button onClick={() => { setDeleteResult(null); setDeleteTarget(null); setDeleteRunning(false) }}
                  className="w-full bg-primary text-white text-xs py-2 rounded-lg font-semibold">إغلاق</button>
              </>
            ) : (
              <>
                <h3 className="text-sm font-bold text-danger">حذف حساب الموظف</h3>
                <p className="text-xs text-text leading-relaxed">
                  سيتم نقل جميع الممتلكات الحالية للموظف <span className="font-bold">{deleteTarget?.full_name}</span> ({deleteTarget?.code}) —
                  العملاء والطلبات والزيارات والتحصيلات والمرتجعات ومهام التوصيل والمرؤوسين —
                  إلى الموظف ذو الكود <span className="font-bold" dir="ltr">EMP-2026-000037</span> ثم حذف الحساب نهائياً.
                </p>
                <p className="text-[11px] text-danger/80">لا يمكن التراجع عن هذا الإجراء.</p>
                <div className="flex gap-2">
                  <button onClick={handleConfirmDelete}
                    className="flex-1 bg-danger text-white text-xs py-2 rounded-lg font-semibold">تأكيد وحذف الحساب</button>
                  <button onClick={() => setDeleteTarget(null)}
                    className="px-4 border border-border rounded-lg text-xs text-text-secondary">إلغاء</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
