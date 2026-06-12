import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function UserProfilePage() {
  const nav = useNavigate()
  const currentEmpId = useAuthStore((s) => s.user?.employee_id)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [employee, setEmployee] = useState<any>(null)
  const [employees, setEmployees] = useState<any[]>([])

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    address: '',
    password: '',
  })

  useEffect(() => {
    if (!currentEmpId) { setLoading(false); return }
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_employees', { p_token: token }).then(({ data }) => {
      const list = Array.isArray(data) ? data : []
      setEmployees(list)
      const me = list.find((e: any) => e.id === currentEmpId) || null
      setEmployee(me)
      if (me) {
        setForm({
          full_name: me.full_name || '',
          email: me.email || '',
          phone: me.phone || '',
          address: me.address || '',
          password: '',
        })
      }
      setLoading(false)
    })
  }, [currentEmpId])

  const manager = employees.find((e: any) => e.id === employee?.manager_id)

  async function handleSave() {
    if (!currentEmpId) return
    setSaving(true)
    const token = getToken()
    const { error } = await supabase.rpc('governed_update_employee', {
      p_token: token,
      p_id: currentEmpId,
      p_full_name: form.full_name || null,
      p_email: form.email || null,
      p_phone: form.phone || null,
      p_address: form.address || null,
      p_password: form.password || null,
    })
    if (error) { toast.error(error.message); setSaving(false); return }
    const result = error as any
    if (result?.error) { toast.error(result.error); setSaving(false); return }
    toast.success('تم حفظ التغييرات')
    setSaving(false)
    setForm((prev) => ({ ...prev, password: '' }))
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!employee) return <div className="text-center py-12 text-text-secondary text-sm">بيانات المستخدم غير متاحة</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">البيانات الشخصية</h1>
      </div>

      {/* Employee Info Banner */}
      <div className="bg-white rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-text">{employee.full_name}</h2>
              {!employee.is_active && <span className="text-[10px] bg-danger/10 text-danger px-2 py-0.5 rounded">موقوف</span>}
            </div>
            <div className="text-xs text-text-secondary mt-1">{employee.code} | {employee.role_names || '—'}</div>
          </div>
        </div>
        {manager && (
          <div className="text-xs text-text-secondary bg-surface rounded-lg p-2 mt-2">
            المدير المباشر: <span className="font-semibold text-text">{manager.full_name}</span>
          </div>
        )}
      </div>

      {/* Edit Form */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        <div>
          <label className="text-[10px] text-text-secondary block mb-0.5">الاسم الكامل</label>
          <input type="text" value={form.full_name} onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
        </div>
        <div>
          <label className="text-[10px] text-text-secondary block mb-0.5">رقم الهاتف</label>
          <input type="text" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" dir="ltr" />
        </div>
        <div>
          <label className="text-[10px] text-text-secondary block mb-0.5">البريد الإلكتروني</label>
          <input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" dir="ltr" />
        </div>
        <div>
          <label className="text-[10px] text-text-secondary block mb-0.5">العنوان</label>
          <textarea value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white resize-none" rows={2} />
        </div>
        <div className="border-t border-border pt-3">
          <label className="text-[10px] text-text-secondary block mb-0.5">كلمة المرور الجديدة</label>
          <input type="text" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
            placeholder="اترك فارغاً بدون تغيير" dir="ltr"
            className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />
        </div>

        <button onClick={handleSave} disabled={saving}
          className="w-full bg-primary text-white rounded-xl py-3 text-sm font-semibold active:opacity-90 disabled:opacity-40">
          {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
        </button>
      </div>
    </div>
  )
}
