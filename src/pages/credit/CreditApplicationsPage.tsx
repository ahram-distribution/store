import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken() { try { return localStorage.getItem('session_token') } catch { return null } }

interface AppItem {
  id: string; customer_id: string; customer_name: string; program_name: string; credit_limit: number; credit_days: number; status: string; doc_confirmed: boolean; submitted_at: string | null; created_at: string; updated_at: string
}

const statusLabels: Record<string, string> = {
  draft: 'مسودة', submitted: 'مقدم', under_review: 'قيد المراجعة', documents_received: 'المستندات كاملة', approved: 'معتمد', rejected: 'مرفوض', suspended: 'معلق'
}
const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', submitted: 'bg-blue-100 text-blue-700', under_review: 'bg-yellow-100 text-yellow-700', documents_received: 'bg-green-100 text-green-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700', suspended: 'bg-orange-100 text-orange-700'
}

export function CreditApplicationsPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<AppItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('')

  useEffect(() => {
    const token = getToken(); if (!token) return
    supabase.rpc('get_governed_credit_applications', { p_token: token }).then(({ data }) => {
      if (data) setItems(data as AppItem[]); setLoading(false)
    })
  }, [])

  const filtered = filter ? items.filter(i => i.status === filter) : items
  const statuses = ['', 'submitted', 'under_review', 'documents_received', 'approved', 'rejected', 'suspended'] as const
  const counts: Record<string, number> = {}
  items.forEach(i => { counts[i.status] = (counts[i.status] || 0) + 1 })

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-primary to-primary-dark text-white rounded-xl p-5">
        <p className="text-sm opacity-90">الائتمان</p>
        <h2 className="text-xl font-bold mt-1">طلبات الائتمان</h2>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {statuses.map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-semibold ${filter === s ? 'bg-primary text-white' : 'bg-white border border-border text-text-secondary'}`}>
            {s ? statusLabels[s] : 'الكل'} ({s ? (counts[s] || 0) : items.length})
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {filtered.map(item => (
          <div key={item.id} onClick={() => navigate(`/credit/applications/${item.id}`)} className="bg-white rounded-xl border border-border p-4 active:bg-surface transition-colors cursor-pointer">
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs px-2 py-1 rounded-full ${statusColors[item.status]}`}>{statusLabels[item.status]}</span>
              <span className="text-sm font-semibold text-text">{item.customer_name}</span>
            </div>
            <div className="text-xs text-text-secondary space-y-1">
              <p>البرنامج: {item.program_name} - {item.credit_limit.toLocaleString()} ج.م / {item.credit_days} يوم</p>
              <p>تاريخ التقديم: {item.submitted_at ? new Date(item.submitted_at).toLocaleDateString('ar-EG') : new Date(item.created_at).toLocaleDateString('ar-EG')}</p>
              <p>آخر تحديث: {new Date(item.updated_at).toLocaleDateString('ar-EG')}</p>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-center text-text-secondary text-sm py-8">لا توجد طلبات</p>}
      </div>
    </div>
  )
}
