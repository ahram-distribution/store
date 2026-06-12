import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'
import { Bell, CheckCircle, AlertTriangle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface AlertItem {
  alert_type: string
  employee_id: string
  employee_name: string
  title: string
  description: string
  detected_at: string
}

const ALERT_LABELS: Record<string, string> = {
  not_started: 'لم يبدأ يوم العمل',
  open_yesterday: 'يوم عمل مفتوح من أمس',
  long_break: 'استراحة طويلة',
  no_updates: 'انقطاع متابعة',
  zero_visits: 'لا توجد زيارات اليوم',
  zero_orders: 'لا توجد طلبات اليوم',
}

const ALERT_ICONS: Record<string, string> = {
  not_started: '🛑',
  open_yesterday: '📅',
  long_break: '☕',
  no_updates: '⚠️',
  zero_visits: '📍',
  zero_orders: '📋',
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [loading, setLoading] = useState(true)
  const token = (() => { try { return localStorage.getItem('session_token') } catch { return null } })()
  const navigate = useNavigate()

  const fetchAlerts = useCallback(async () => {
    if (!token) return
    const { data } = await supabase.rpc('get_alerts', { p_token: token?.trim() })
    if (data) {
      const d = data as { active_alerts: AlertItem[] }
      setAlerts(d.active_alerts ?? [])
    }
    setLoading(false)
  }, [token])

  useEffect(() => {
    fetchAlerts()
    const interval = setInterval(fetchAlerts, 60000)
    return () => clearInterval(interval)
  }, [fetchAlerts])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" dir="rtl">
        <p className="text-gray-500">جاري تحميل التنبيهات...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-5" dir="rtl">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Bell className="w-7 h-7 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-800">التنبيهات</h1>
        </div>

        {alerts.length > 0 && (
          <div className="bg-red-50 rounded-2xl p-4 mb-4 text-center">
            <AlertTriangle className="w-6 h-6 mx-auto text-red-500 mb-1" />
            <p className="font-bold text-red-700">{alerts.length} تنبيهات</p>
          </div>
        )}

        {alerts.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <Bell className="w-12 h-12 mx-auto mb-3" />
            لا توجد تنبيهات نشطة ✓
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.alert_type + '-' + alert.employee_id}
                className="bg-white rounded-2xl shadow-sm p-4 border-r-4 border-red-400"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span>{ALERT_ICONS[alert.alert_type] ?? '🔔'}</span>
                      <span className="font-bold text-gray-800">
                        {ALERT_LABELS[alert.alert_type] ?? alert.alert_type}
                      </span>
                    </div>
                    <p className="text-gray-600 text-sm mt-1">{alert.description}</p>
                    {alert.employee_name && (
                      <p className="text-xs text-gray-400 mt-1">
                        الموظف: {alert.employee_name}
                      </p>
                    )}
                    <p className="text-xs text-gray-300 mt-1">
                      {new Date(alert.detected_at).toLocaleString('ar-EG')}
                    </p>
                  </div>
                </div>
                {alert.employee_id && (
                  <button
                    onClick={() => navigate(`/attendance/map/${alert.employee_id}/${new Date().toISOString().slice(0, 10)}`)}
                    className="mt-2 text-xs text-blue-600 underline"
                  >
                    عرض تفاصيل اليوم
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
