import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

function getToken() { try { return localStorage.getItem('session_token') } catch { return null } }

interface CollectionItem {
  id: string; customer_name: string; amount: number; method: string; status: string
  collected_at: string | null; created_at: string; owner_name: string | null; days_since_creation: number
}

const methodLabels: Record<string, string> = { cash: 'نقدي', bank: 'بنك', cheque: 'شيك', deposit: 'إيداع' }
const statusLabels: Record<string, string> = { pending: 'معلق', approved: 'معتمد' }
const statusColors: Record<string, string> = { pending: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700' }

export function CollectionFollowupPage() {
  const [items, setItems] = useState<CollectionItem[]>([]); const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'overdue'>('all')

  useEffect(() => {
    const token = getToken(); if (!token) return
    supabase.rpc('get_collection_followup_queue', { p_token: token }).then(({ data }) => {
      if (data) setItems(data as CollectionItem[]); setLoading(false)
    })
  }, [])

  const filtered = items.filter(i => {
    if (filter === 'pending') return i.status === 'pending'
    if (filter === 'overdue') return i.status === 'pending' && i.days_since_creation > 30
    return true
  })

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-accent to-yellow-700 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">التحصيل</p>
        <h2 className="text-xl font-bold mt-1">متابعة التحصيل</h2>
      </div>
      <div className="flex gap-2">
        {(['all', 'pending', 'overdue'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold ${filter === f ? 'bg-accent text-white' : 'bg-white border border-border text-text-secondary'}`}>
            {f === 'all' ? 'الكل' : f === 'pending' ? 'معلق' : 'متأخر'} ({filtered.length})
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {filtered.map(item => (
          <div key={item.id} className="bg-white rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className={`text-xs px-2 py-1 rounded-full ${statusColors[item.status] || 'bg-gray-100'}`}>{statusLabels[item.status] || item.status}</span>
              <span className="text-sm font-semibold text-text">{item.customer_name}</span>
            </div>
            <div className="text-xs text-text-secondary space-y-1">
              <p>المبلغ: {item.amount.toLocaleString()} ج.م - {methodLabels[item.method] || item.method}</p>
              <p>المسؤول: {item.owner_name || 'غير معروف'}</p>
              <p>تاريخ الإنشاء: {new Date(item.created_at).toLocaleDateString('ar-EG')}</p>
              {item.days_since_creation > 30 && <p className="text-red-600">متأخر {item.days_since_creation} يوم</p>}
              {item.collected_at && <p className="text-green-600">تم التحصيل: {new Date(item.collected_at).toLocaleDateString('ar-EG')}</p>}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-center text-text-secondary text-sm py-8">لا توجد تحصيلات</p>}
      </div>
    </div>
  )
}
