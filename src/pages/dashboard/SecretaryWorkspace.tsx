import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function SecretaryWorkspace() {
  const navigate = useNavigate()
  const [visits, setVisits] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_visits', { p_token: token }).then(({ data }) => {
      if (data) setVisits(Array.isArray(data) ? data : [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  const today = visits.filter(v => v.check_in_at && new Date(v.check_in_at).toDateString() === new Date().toDateString())
  const checkedIn = today.filter(v => v.check_in_at)
  const checkedOut = today.filter(v => v.check_out_at)
  const active = today.filter(v => v.check_in_at && !v.check_out_at)

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-violet-700 to-violet-900 text-white rounded-xl p-5">
        <p className="text-sm opacity-90">لوحة التحكم</p>
        <h2 className="text-xl font-bold mt-1">سكرتارية</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{today.length}</span></div>
          <span className="text-sm font-semibold text-text">زيارات اليوم</span>
        </div>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-success flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{checkedIn.length}</span></div>
          <span className="text-sm font-semibold text-text">تم تسجيل الدخول</span>
        </div>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-warning flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{active.length}</span></div>
          <span className="text-sm font-semibold text-text">زيارات نشطة</span>
        </div>
        <div className="bg-white rounded-xl border border-border p-4 text-right">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center mb-2"><span className="text-white text-lg font-bold">{checkedOut.length}</span></div>
          <span className="text-sm font-semibold text-text">تم تسجيل الخروج</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold text-text mb-3">إجراءات سريعة</h3>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/visits')} className="bg-primary text-white text-xs py-2.5 rounded-lg">الزيارات</button>
          <button onClick={() => navigate('/visits/new')} className="bg-primary text-white text-xs py-2.5 rounded-lg">تسجيل زيارة</button>
          <button onClick={() => navigate('/employees')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">الموظفين</button>
          <button onClick={() => navigate('/calendar')} className="bg-surface text-text text-xs py-2.5 rounded-lg border border-border">التقويم</button>
        </div>
      </div>
    </div>
  )
}
