import { Monitor, RefreshCw, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { formatTime } from '../../../utils/format'

interface HeaderProps {
  lastUpdate: Date | null
  onRefresh: () => void
  canConfigure?: boolean
}

export default function Header({ lastUpdate, onRefresh, canConfigure }: HeaderProps) {
  const navigate = useNavigate()

  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <Monitor className="w-7 h-7 text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-800">غرفة العمليات</h1>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={onRefresh} className="p-2 hover:bg-gray-100 rounded-xl" title="تحديث يدوي">
          <RefreshCw className="w-5 h-5 text-gray-500" />
        </button>

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
