import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getToken, fmtAmount, journeyStatusLabel, isJourneyReturned } from './shared'
import type { DeliveryJourneyItem } from './shared'

export function DeliveryStaffHome() {
  const navigate = useNavigate()
  const [journeys, setJourneys] = useState<DeliveryJourneyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [workStatus, setWorkStatus] = useState<string | null>(null)
  const [workMinutes, setWorkMinutes] = useState(0)

  const load = useCallback(async () => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.rpc('governed_get_my_journeys', { p_token: token })
    if (Array.isArray(data)) setJourneys(data as DeliveryJourneyItem[])
    const wd = await supabase.rpc('get_my_workday_status', { p_token: token })
    const w = wd.data as { status?: string; duration_minutes?: number; error?: string }
    if (w && !w.error) {
      setWorkStatus(w.status || null)
      setWorkMinutes(w.duration_minutes || 0)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const activeJourneys = journeys.filter((j) => !isJourneyReturned(j.status))
  const completedJourneys = journeys.filter((j) => isJourneyReturned(j.status))
  const notStarted = activeJourneys.filter((j) => j.status === 'assigned')
  const inProgress = activeJourneys.filter((j) => j.status === 'in_progress')
  const totalValue = inProgress.reduce((s, j) => s + (Number(j.totals?.total_value) || 0), 0)

  const attendanceOpen = workStatus === 'active'

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-primary to-blue-900 text-white rounded-xl p-5">
        <h1 className="text-xl font-bold">مرحباً بك</h1>
        <p className="text-sm opacity-90 mt-1">
          {attendanceOpen ? 'نوبة العمل نشطة' : 'سجل حضورك لبدء المهام'}
          {attendanceOpen && workMinutes > 0 ? ` - ${Math.round(workMinutes)} دقيقة` : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => navigate('/my-deliveries/tasks')}
          className="text-right bg-white rounded-xl border border-border p-5 hover:shadow-sm transition-shadow flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <span className="w-11 h-11 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center text-xl">🚚</span>
            <span className="text-3xl font-bold text-text">{activeJourneys.length}</span>
          </div>
          <div>
            <p className="font-semibold text-text">رحلاتي</p>
            <p className="text-xs text-text-secondary mt-1">
              {notStarted.length > 0 ? `${notStarted.length} بانتظار الاستلام` : 'لا توجد رحلات قادمة'}
              {inProgress.length > 0 ? ` - ${inProgress.length} جارية` : ''}
            </p>
            <p className="text-xs text-text-secondary mt-1">
              {completedJourneys.length > 0 ? `${completedJourneys.length} رحلة مكتملة` : 'لا توجد رحلات مكتملة'}
            </p>
            {totalValue > 0 && <p className="text-xs text-text-secondary mt-1">إجمالي قيمة الرحلات الجارية: {fmtAmount(totalValue)}</p>}
          </div>
          <span className="text-xs text-primary font-semibold">عرض الرحلات ←</span>
        </button>

        <button
          onClick={() => navigate('/attendance')}
          className="text-right bg-white rounded-xl border border-border p-5 hover:shadow-sm transition-shadow flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <span className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl ${attendanceOpen ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>🕘</span>
            <span className={`text-[11px] px-2 py-1 rounded-full ${attendanceOpen ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {attendanceOpen ? 'مسجل' : 'لم يسجل بعد'}
            </span>
          </div>
          <div>
            <p className="font-semibold text-text">الحضور والانصراف</p>
            <p className="text-xs text-text-secondary mt-1">
              {attendanceOpen ? 'نوبة العمل جارية الآن' : 'سجل الحضور ثم ابدأ التوصيل'}
            </p>
          </div>
          <span className="text-xs text-primary font-semibold">فتح الحضور والانصراف ←</span>
        </button>
      </div>

      {!loading && activeJourneys.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-2">
          <p className="text-sm font-semibold text-text">رحلات جارية</p>
          {activeJourneys.slice(0, 3).map((j) => (
            <button
              key={j.journey_id}
              onClick={() => navigate(`/my-deliveries/tasks/${j.journey_id}`)}
              className="w-full text-right flex items-center justify-between py-1.5 border-b border-border/50 last:border-0"
            >
              <div>
                <p className="text-xs font-semibold text-text">{j.journey_code || `رحلة (${(j.orders || []).length} طلب)`}</p>
                <p className="text-[11px] text-text-secondary">{journeyStatusLabel(j.status)} - {(j.orders || []).length} طلب</p>
              </div>
              <span className="text-xs text-primary">متابعة ←</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
