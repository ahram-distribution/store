import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function CompaniesPage() {
  const navigate = useNavigate()
  const [companies, setCompanies] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_companies', { p_token: token }).then(({ data }) => {
      if (data) setCompanies(Array.isArray(data) ? data : [])
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return companies
    return companies.filter((c: any) =>
      (c.company_name || '').toLowerCase().includes(q) ||
      (c.legacy_code || '').toLowerCase().includes(q)
    )
  }, [companies, searchQuery])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName || !newCode) { toast.error('اسم الشركة والكود مطلوبان'); return }
    setSubmitting(true)
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_create_company', {
      p_token: token, p_company_name: newName, p_legacy_code: newCode,
    })
    if (error) { toast.error(error.message); setSubmitting(false); return }
    const result = data as any
    if (result.error) { toast.error(result.error); setSubmitting(false); return }
    toast.success('تم إضافة الشركة')
    setShowAddForm(false); setNewName(''); setNewCode('')
    setSubmitting(false)
    const res = await supabase.rpc('get_governed_companies', { p_token: token })
    if (res.data) setCompanies(Array.isArray(res.data) ? res.data : [])
  }

  async function handleEdit(id: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_update_company', {
      p_token: token, p_id: id, p_company_name: editName || null, p_legacy_code: editCode || null,
    })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success('تم التحديث')
    setEditingId(null)
    const res = await supabase.rpc('get_governed_companies', { p_token: token })
    if (res.data) setCompanies(Array.isArray(res.data) ? res.data : [])
  }

  async function handleToggleActive(comp: any) {
    const token = getToken()
    const fn = comp.is_active ? 'governed_deactivate_company' : 'governed_activate_company'
    const { data, error } = await supabase.rpc(fn, { p_token: token, p_id: comp.id })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success(comp.is_active ? 'تم الإيقاف' : 'تم التفعيل')
    const res = await supabase.rpc('get_governed_companies', { p_token: token })
    if (res.data) setCompanies(Array.isArray(res.data) ? res.data : [])
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">الشركات</h1>
        <button onClick={() => setShowAddForm(true)} className="mr-auto bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ إضافة شركة</button>
      </div>

      <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="بحث بالاسم أو الكود..." className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />

      {showAddForm && (
        <form onSubmit={handleAdd} className="bg-white rounded-lg border border-border p-4 space-y-3">
          <h2 className="text-sm font-bold">إضافة شركة جديدة</h2>
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="اسم الشركة *" className="w-full border border-border rounded-lg px-3 py-2 text-sm" required />
          <input type="text" value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="الكود القديم *" className="w-full border border-border rounded-lg px-3 py-2 text-sm" required />
          <div className="flex gap-2">
            <button type="submit" disabled={submitting} className="flex-1 bg-primary text-white text-xs py-2 rounded-lg font-semibold">
              {submitting ? 'جاري الإضافة...' : 'إضافة'}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)} className="px-4 border border-border rounded-lg text-xs">إلغاء</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد شركات</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((comp: any) => (
            <div key={comp.id} className="bg-white rounded-xl border border-border p-3">
              <div className="flex items-start justify-between cursor-pointer" onClick={() => navigate(`/companies/${comp.id}`)}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-text">{comp.company_name}</span>
                    {!comp.is_active && <span className="text-[10px] bg-danger/10 text-danger px-2 py-0.5 rounded">غير نشط</span>}
                  </div>
                  <div className="text-[11px] text-text-secondary mt-0.5">{comp.legacy_code} | منتجات: {comp.product_count}</div>
                </div>
              </div>
              <div className="flex gap-1.5 mt-2">
                <button onClick={() => { setEditingId(comp.id); setEditName(comp.company_name); setEditCode(comp.legacy_code) }}
                  className="text-[10px] bg-primary/10 text-primary px-2 py-1 rounded">تعديل</button>
                <button onClick={() => handleToggleActive(comp)}
                  className={`text-[10px] px-2 py-1 rounded ${comp.is_active ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                  {comp.is_active ? 'إيقاف' : 'تفعيل'}
                </button>
              </div>
              {editingId === comp.id && (
                <div className="mt-3 border-t border-border pt-3 space-y-2">
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full border border-border rounded-lg px-3 py-1.5 text-xs" />
                  <input type="text" value={editCode} onChange={(e) => setEditCode(e.target.value)} className="w-full border border-border rounded-lg px-3 py-1.5 text-xs" />
                  <div className="flex gap-2">
                    <button onClick={() => handleEdit(comp.id)} className="flex-1 bg-primary text-white text-xs py-1.5 rounded-lg">حفظ</button>
                    <button onClick={() => setEditingId(null)} className="px-4 border border-border rounded-lg text-xs">إلغاء</button>
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
