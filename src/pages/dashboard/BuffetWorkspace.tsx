import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function BuffetWorkspace() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_orders', { p_token: token }).then(({ data }) => {
      if (data) setOrders(Array.isArray(data) ? data : [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const pending = orders.filter((o: any) => o.status === 'submitted')
  const preparing = orders.filter((o: any) => o.status === 'preparing' || o.status === 'approved')
  const ready = orders.filter((o: any) => o.status === 'ready')

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-orange-700 to-orange-900 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">بوفيه</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => navigate('/pos')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{pending.length}</span></div>
          <span className="text-sm font-semibold text-text">طلبات جديدة</span>
        </button>
        <button onClick={() => navigate('/pos?filter=preparing')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{preparing.length}</span></div>
          <span className="text-sm font-semibold text-text">قيد التحضير</span>
        </button>
        <button onClick={() => navigate('/pos?filter=ready')} className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{ready.length}</span></div>
          <span className="text-sm font-semibold text-text">جاهزة للتسليم</span>
        </button>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{orders.length}</span></div>
          <span className="text-sm font-semibold text-text">إجمالي الطلبات</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/pos')} className="bg-primary text-white text-xs py-2.5 rounded-lg">نقطة البيع</button>
          <button onClick={() => navigate('/kitchen')} className="bg-primary text-white text-xs py-2.5 rounded-lg">المطبخ</button>
        </div>
      </div>
    </div>
  )
}
