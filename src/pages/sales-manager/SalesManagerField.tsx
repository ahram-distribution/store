import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { attendanceService } from '../../services/attendance'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => Number.isFinite(n) ? n.toLocaleString('ar-EG-u-nu-latn') : '0'

const POLLING_INTERVAL = 30000

export default function SalesManagerField() {
  const nav = useNavigate()
  const [att, setAtt] = useState<any>(null)
  const [healthData, setHealthData] = useState<any>(null)
  const [autoClosedTodayCount, setAutoClosedTodayCount] = useState(0)
  const [autoClosedMonthCount, setAutoClosedMonthCount] = useState(0)
  const [autoClosedTodayDetails, setAutoClosedTodayDetails] = useState<any[]>([])
  const [showAutoClosedModal, setShowAutoClosedModal] = useState(false)
  const [loading, setLoading] = useState(true)

  const token = getToken()

  const fetchData = useCallback(async () => {
    if (!token) return
    const { data: result, error } = await supabase.rpc('get_sales_manager_cc', { p_token: token.trim() })
    if (error || (result && typeof result === 'object' && (result as Record<string, unknown>).error)) {
      setLoading(false); return
    }
    if (result && typeof result === 'object') {
      setAtt((result as any).attendance ?? null)
      setLoading(false)
    }
    attendanceService.getAutoClosedToday().then((r) => {
      if (r) {
        setAutoClosedTodayDetails(r as any[])
        setAutoClosedTodayCount(r.length)
      }
    }).catch(() => {})
    attendanceService.getAutoClosedMonth().then((r) => {
      if (r) setAutoClosedMonthCount((r as any).total_count ?? 0)
    }).catch(() => {})
    supabase.rpc('get_attendance_health', { p_token: token }).then((r) => {
      if (r.data && !r.error) setHealthData(r.data)
    }).catch(() => {})
  }, [token])

  useEffect(() => { fetchData(); const id = setInterval(fetchData, POLLING_INTERVAL); return () => clearInterval(id) }, [fetchData])

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-border pb-2 pt-2">
        <div className="flex items-center gap-2">
          <button onClick={() => nav('/sales-manager-cc')} className="text-xs text-primary font-semibold">→ رجوع</button>
          <h1 className="text-lg font-bold text-text">النشاط الميداني</h1>
        </div>
      </div>

      {/* Navigation Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <NavCard icon="📋" label="الحضور والانصراف" desc="مراقبة الحضور والجلسات" onClick={() => nav('/attendance/operations')} />
        <NavCard icon="🔴" label="المراقبة الحية" desc="نشاط الفريق المباشر" onClick={() => nav('/command-center/live')} />
      </div>

      {/* Sales Effort */}
      <button onClick={() => nav('/sales-effort')}
        className="w-full bg-gradient-to-l from-indigo-600 to-blue-700 text-white rounded-xl p-4 text-right active:scale-[0.98] transition-all hover:shadow-lg hover:shadow-indigo-200 flex items-center justify-between">
        <div>
          <div className="text-lg font-bold">مجهود المناديب</div>
          <div className="text-xs text-indigo-100 mt-1">تحليل أداء فريق البيع — الحضور، المبيعات، الزيارات، العملاء الجدد</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl">{'\u{1F4AA}'}</span>
          <span className="text-indigo-200 text-lg">←</span>
        </div>
      </button>

      {/* Attendance Summary */}
      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">ملخص الحضور</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStat label="يعمل الآن" value={fmt(att?.active_count ?? 0)} color="text-blue-700" />
          <MiniStat label="في استراحة" value={fmt(att?.on_break_count ?? 0)} color="text-amber-700" />
          <MiniStat label="أنهوا اليوم" value={fmt(att?.ended_count ?? 0)} color="text-green-700" />
          <MiniStat label="لم يبدأوا" value={fmt(att?.no_start_count ?? 0)} color="text-gray-500" />
        </div>

        {(autoClosedTodayCount > 0 || autoClosedMonthCount > 0) && (
          <div className="mt-3 border-t border-border/50 pt-3">
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setShowAutoClosedModal(true)}
                className="bg-red-50 rounded-xl py-3 text-center active:bg-red-100 transition-colors">
                <div className="text-lg font-bold text-red-700">{autoClosedTodayCount}</div>
                <div className="text-[9px] text-text-secondary">إنهاء تلقائي اليوم</div>
              </button>
              <div className="bg-orange-50 rounded-xl py-3 text-center">
                <div className="text-lg font-bold text-orange-700">{autoClosedMonthCount}</div>
                <div className="text-[9px] text-text-secondary">إنهاء تلقائي الشهر</div>
              </div>
            </div>
          </div>
        )}

        {healthData && (
          <div className="mt-3 border-t border-border/50 pt-3">
            <h4 className="text-[11px] font-semibold text-text-secondary mb-2">صحة الحضور</h4>
            <div className="grid grid-cols-4 gap-2 text-center mb-2">
              <div className="bg-blue-50 rounded-lg py-2">
                <div className="text-base font-bold text-blue-700">{healthData.today?.active_sessions ?? 0}</div>
                <div className="text-[8px] text-text-secondary">نشط</div>
              </div>
              <div className="bg-green-50 rounded-lg py-2">
                <div className="text-base font-bold text-green-700">{healthData.today?.completed_sessions ?? 0}</div>
                <div className="text-[8px] text-text-secondary">منتهي</div>
              </div>
              <div className="bg-red-50 rounded-lg py-2">
                <div className="text-base font-bold text-red-700">{healthData.today?.auto_closed_sessions ?? 0}</div>
                <div className="text-[8px] text-text-secondary">تلقائي</div>
              </div>
              <div className="bg-amber-50 rounded-lg py-2">
                <div className="text-base font-bold text-amber-700">{healthData.today?.warning_events ?? 0}</div>
                <div className="text-[8px] text-text-secondary">تحذيرات</div>
              </div>
            </div>
            <div className="text-[9px] text-text-secondary flex justify-between">
              <span>آخر 30 يوم</span>
              <span>تلقائي: {healthData.month?.auto_closed_count ?? 0}</span>
              <span>استرجاع: {healthData.month?.recovery_count ?? 0}</span>
            </div>
          </div>
        )}
      </div>

      {/* Auto-Closed Modal */}
      {showAutoClosedModal && (
        <div className="fixed inset-0 z-20 flex items-end sm:items-center justify-center bg-black/30">
          <div className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-4 max-h-[70vh] overflow-y-auto space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text">جلسات الإنهاء التلقائي اليوم</h3>
              <button type="button" onClick={() => setShowAutoClosedModal(false)} className="text-xs text-text-secondary">إغلاق</button>
            </div>
            {autoClosedTodayDetails.length === 0 ? (
              <p className="text-center text-xs text-text-secondary py-6">لا توجد جلسات</p>
            ) : (
              <div className="space-y-2">
                {autoClosedTodayDetails.map((s: any, i: number) => (
                  <div key={i} className="bg-surface rounded-lg p-3 border border-border/50">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-text">{s.employee_name}</span>
                      <span className="text-[10px] text-text-secondary">{s.employee_code}</span>
                    </div>
                    <div className="text-[11px] text-text-secondary mt-1">
                      السبب: {s.close_reason === 'no_activity_timeout' ? 'انتهت المهلة' : s.close_reason === 'day_rollover' ? 'تجاوز منتصف الليل' : s.close_reason}
                    </div>
                    <div className="text-[10px] text-text-secondary">
                      {s.start_time ? 'البداية: ' + s.start_time : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="text-center text-[10px] text-text-secondary pb-4">
        يتم التحديث تلقائياً كل 30 ثانية
      </div>
    </div>
  )
}

function NavCard({ icon, label, desc, onClick }: { icon: string; label: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors hover:shadow-sm">
      <div className="text-2xl mb-2">{icon}</div>
      <p className="text-sm font-bold text-text">{label}</p>
      <p className="text-[10px] text-text-secondary mt-0.5">{desc}</p>
    </button>
  )
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-surface rounded-lg p-2 text-center border border-border/50">
      <p className={`text-sm font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-text-secondary">{label}</p>
    </div>
  )
}
