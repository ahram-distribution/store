import { useState, useEffect, useMemo } from 'react'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { SearchableSelect } from '../../components/shared/SearchableSelect'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function EmployeesPage({ embedded }: { embedded?: boolean }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const currentEmpId = useAuthStore((s) => s.user?.employee_id)
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
            items={roles.map((r: any) => ({ id: r.id, name: r.name }))}
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
                    items={roles.map((r: any) => ({ id: r.id, name: r.name }))}
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
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
