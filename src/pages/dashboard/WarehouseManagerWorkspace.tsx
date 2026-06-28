import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function WarehouseManagerWorkspace() {
  const navigate = useNavigate()
  const [counters, setCounters] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
    supabase.rpc('get_dashboard_warehouse', { p_token: token }),
      ]).then(([cnt]) => {
        const map: Record<string, number> = {}
        ;(cnt.data || []).forEach((row: any) => { map[row.counter] = Number(row.value) })
          setCounters(map)
          setLoading(false)
        })
      }, [])

      if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

      return (
      <div className="space-y-4">
      <div className="bg-gradient-to-br from-amber-700 to-amber-900 text-white rounded-xl p-5">
      <p className="text-sm opacity-90">لوحة التحكم</p>
      <h2 className="text-xl font-bold mt-1">مدير المستودع</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
      <div className="bg-white rounded-xl border border-border p-4 text-right">
      <div className="w-10 h-10 rounded-xl bg-warning flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{counters['delayed_preps'] ?? 0}</span></div>
      <span className="text-sm font-semibold text-text">متأخر</span>
      </div>
      </div>
      </div>
    )
  }
