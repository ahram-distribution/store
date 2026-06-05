import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

function getToken() { try { return localStorage.getItem('session_token') } catch { return null } }

interface Program {
  id: string; name: string; credit_limit: number; credit_days: number; terms: string | null; is_active: boolean
}

export function CreditProgramsPage() {
  const [programs, setPrograms] = useState<Program[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState(''); const [limit, setLimit] = useState(''); const [days, setDays] = useState(''); const [terms, setTerms] = useState('')

  const load = () => {
    const token = getToken(); if (!token) return
    supabase.rpc('governed_get_credit_programs', { p_token: token, p_include_inactive: true }).then(({ data }) => {
      if (data) setPrograms(data as Program[]); setLoading(false)
    })
  }

  useEffect(() => { load() }, [])

  const save = async () => {
    const token = getToken(); if (!token) return
    if (editId) {
      await supabase.rpc('governed_update_credit_program', { p_token: token, p_id: editId, p_name: name, p_credit_limit: parseFloat(limit), p_credit_days: parseInt(days), p_terms: terms || null })
    } else {
      await supabase.rpc('governed_create_credit_program', { p_token: token, p_name: name, p_credit_limit: parseFloat(limit), p_credit_days: parseInt(days), p_terms: terms || null })
    }
    setShowForm(false); setEditId(null); setName(''); setLimit(''); setDays(''); setTerms(''); load()
  }

  const toggle = async (id: string, active: boolean) => {
    const token = getToken(); if (!token) return
    await supabase.rpc('governed_toggle_credit_program', { p_token: token, p_id: id, p_is_active: !active })
    load()
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-primary to-primary-dark text-white rounded-xl p-5">
        <p className="text-sm opacity-90">الإدارة</p>
        <h2 className="text-xl font-bold mt-1">برامج الائتمان</h2>
      </div>
      <button onClick={() => { setShowForm(true); setEditId(null); setName(''); setLimit(''); setDays(''); setTerms('') }} className="bg-primary text-white rounded-xl p-3 w-full text-sm font-semibold">إضافة برنامج جديد</button>
      {showForm && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-3">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="اسم البرنامج" className="w-full border border-border rounded-lg p-2 text-sm text-right" />
          <div className="flex gap-2">
            <input value={limit} onChange={e => setLimit(e.target.value)} placeholder="الحد الائتماني" type="number" className="flex-1 border border-border rounded-lg p-2 text-sm text-right" />
            <input value={days} onChange={e => setDays(e.target.value)} placeholder="عدد الأيام" type="number" className="w-24 border border-border rounded-lg p-2 text-sm text-right" />
          </div>
          <textarea value={terms} onChange={e => setTerms(e.target.value)} placeholder="الشروط (اختياري)" rows={3} className="w-full border border-border rounded-lg p-2 text-sm text-right" />
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 bg-primary text-white rounded-xl p-2 text-sm font-semibold">حفظ</button>
            <button onClick={() => setShowForm(false)} className="flex-1 bg-gray-200 text-gray-700 rounded-xl p-2 text-sm">إلغاء</button>
          </div>
        </div>
      )}
      <div className="space-y-2">
        {programs.map(p => (
          <div key={p.id} className={`bg-white rounded-xl border border-border p-4 ${!p.is_active ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs px-2 py-1 rounded-full ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{p.is_active ? 'نشط' : 'غير نشط'}</span>
              <span className="font-bold text-text">{p.name}</span>
            </div>
            <div className="flex gap-4 text-xs text-text-secondary mb-3">
              <span>الحد: {p.credit_limit.toLocaleString()} ج.م</span>
              <span>المدة: {p.credit_days} يوم</span>
            </div>
            {p.terms && <p className="text-xs text-text-secondary mb-3">{p.terms}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setEditId(p.id); setName(p.name); setLimit(String(p.credit_limit)); setDays(String(p.credit_days)); setTerms(p.terms || ''); setShowForm(true) }} className="flex-1 bg-surface text-text rounded-xl p-2 text-xs">تعديل</button>
              <button onClick={() => toggle(p.id, p.is_active)} className={`flex-1 rounded-xl p-2 text-xs text-white ${p.is_active ? 'bg-warning' : 'bg-success'}`}>{p.is_active ? 'تعطيل' : 'تفعيل'}</button>
            </div>
          </div>
        ))}
        {programs.length === 0 && <p className="text-center text-text-secondary text-sm py-8">لا توجد برامج ائتمانية</p>}
      </div>
    </div>
  )
}
