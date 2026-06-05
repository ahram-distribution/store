import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface TransportData {
  ready_delivery: number; out_delivery: number; delivery_queue: number; collection_queue: number
  delivered_today: number; failed: number; pending_collections: number; overdue_collections: number
}

export function TransportDashboard() {
  const navigate = useNavigate()
  const [data, setData] = useState<TransportData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) return
    supabase.rpc('get_dashboard_transport', { p_token: token }).then(({ data: d }) => {
      if (d) setData(d as unknown as TransportData)
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const primaryWidgets = [
    { label: 'جاهز للتوصيل', value: data?.ready_delivery ?? 0, color: 'bg-success', path: '/delivery' },
    { label: 'قيد التوصيل', value: data?.out_delivery ?? 0, color: 'bg-primary', path: '/delivery?filter=out_for_delivery' },
    { label: 'متابعة توصيل', value: data?.delivery_queue ?? 0, color: 'bg-accent', path: '/delivery' },
    { label: 'مُسلم اليوم', value: data?.delivered_today ?? 0, color: 'bg-green-600', path: '/delivery?filter=delivered' },
  ]

  const secondaryWidgets = [
    { label: 'فشل توصيل', value: data?.failed ?? 0, color: 'bg-red-600', path: '/delivery?filter=failed' },
    { label: 'متابعة تحصيل', value: data?.collection_queue ?? 0, color: 'bg-warning', path: '/collections?filter=pending' },
    { label: 'تحصيلات مستحقة', value: data?.pending_collections ?? 0, color: 'bg-accent', path: '/collections/followup' },
    { label: 'تحصيلات متأخرة', value: data?.overdue_collections ?? 0, color: 'bg-red-600', path: '/collections/followup' },
  ]

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-success to-green-700 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">النقل والتوصيل</p>
        <h2 className="text-xl font-bold mt-1">لوحة تحكم التوصيل</h2>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {primaryWidgets.map((w) => (
          <button key={w.label} onClick={() => navigate(w.path)}
            className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors col-span-1">
            <div className={`w-10 h-10 rounded-xl ${w.color} flex items-center justify-center mb-2`}>
              <span className="text-white text-lg font-bold">{w.value}</span>
            </div>
            <span className="text-sm font-semibold text-text">{w.label}</span>
          </button>
        ))}
      </div>
      <button onClick={() => navigate('/delivery')} className="bg-primary text-white rounded-xl p-3 w-full text-sm font-semibold text-center">إدارة التوصيل</button>
      <h3 className="text-sm font-semibold text-text mt-4">التحصيل</h3>
      <div className="grid grid-cols-2 gap-3">
        {secondaryWidgets.map((w) => (
          <button key={w.label} onClick={() => navigate(w.path)}
            className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
            <div className={`w-9 h-9 rounded-lg ${w.color} flex items-center justify-center mb-2`}>
              <span className="text-white text-sm font-bold">{w.value}</span>
            </div>
            <span className="text-xs font-semibold text-text">{w.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
