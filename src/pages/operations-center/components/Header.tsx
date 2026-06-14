import { useState, useEffect } from 'react'
import { Monitor, Bell, RefreshCw, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { formatTime } from '../../../utils/format'

interface HeaderProps {
  lastUpdate: Date | null
  pollingSeconds: number
  onRefresh: () => void
  alertCount: number
  canConfigure?: boolean
}

export default function Header({ lastUpdate, pollingSeconds, onRefresh, alertCount, canConfigure }: HeaderProps) {
  const navigate = useNavigate()
  const [countdown, setCountdown] = useState(pollingSeconds)

  useEffect(() => {
    setCountdown(pollingSeconds)
  }, [pollingSeconds])

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return () => clearInterval(interval)
  }, [lastUpdate])

  const scrollToAlerts = () => {
    const el = document.getElementById('ops-alerts-area')
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <Monitor className="w-7 h-7 text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-800">غرفة العمليات</h1>
      </div>

      <div className="flex items-center gap-3">
        {alertCount > 0 && (
          <button onClick={scrollToAlerts} className="relative p-2 hover:bg-gray-100 rounded-xl">
            <Bell className="w-5 h-5 text-red-500" />
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full font-bold">
              {alertCount}
            </span>
          </button>
        )}

        <button onClick={onRefresh} className="p-2 hover:bg-gray-100 rounded-xl" title="تحديث يدوي">
          <RefreshCw className="w-5 h-5 text-gray-500" />
        </button>

        <div className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-lg hidden sm:block" dir="ltr">
          {countdown}s
        </div>

        {lastUpdate && (
          <div className="text-xs text-gray-400 hidden md:block">
            آخر تحديث: {formatTime(lastUpdate)}
          </div>
        )}

        {canConfigure && (
          <button onClick={() => navigate('/attendance/settings')} className="p-2 hover:bg-gray-100 rounded-xl" title="الإعدادات">
            <Settings className="w-5 h-5 text-gray-500" />
          </button>
        )}
      </div>
    </div>
  )
}
