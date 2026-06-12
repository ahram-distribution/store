import { Clock } from 'lucide-react'

interface RuntimeHeaderProps {
  fullName: string
  employeeCode: string
  workLocation: string | null
  scheduleType: string | null
  attendanceEnabled: boolean | null
  lastSyncSeconds: number
}

function lastSyncLabel(seconds: number): { text: string; color: string } {
  if (seconds < 5) return { text: 'مباشر', color: 'text-green-600' }
  if (seconds < 30) return { text: 'الآن', color: 'text-green-600' }
  if (seconds < 60) return { text: `منذ ${seconds} ثانية`, color: 'text-gray-400' }
  if (seconds < 300) return { text: `منذ ${Math.floor(seconds / 60)} دقيقة`, color: 'text-gray-400' }
  return { text: `منذ ${Math.floor(seconds / 60)} دقيقة`, color: 'text-amber-600' }
}

function scheduleLabel(type: string | null): string {
  switch (type) {
    case 'fixed_shift': return 'دوام ثابت'
    case 'hourly': return 'بالساعة'
    case 'flexible': return 'دوام مرن'
    default: return 'غير مصنف'
  }
}

function locationLabel(loc: string | null): string {
  return loc === 'office' ? 'مكتبي' : 'ميداني'
}

function initials(name: string): string {
  return name ? name.charAt(0) : '?'
}

export default function RuntimeHeader({
  fullName, employeeCode, workLocation, scheduleType, attendanceEnabled, lastSyncSeconds,
}: RuntimeHeaderProps) {
  const sync = lastSyncLabel(lastSyncSeconds)

  const hasPolicy = attendanceEnabled !== null
  const isExempt = hasPolicy && attendanceEnabled === false
  const showLocationBadge = hasPolicy && !isExempt && workLocation !== null
  const showScheduleBadge = hasPolicy && !isExempt && scheduleType !== null

  return (
    <div className="flex items-center gap-3">
      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-lg shadow-sm shrink-0">
        {initials(fullName)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-gray-800 text-base truncate">{fullName}</span>
          <span className="text-xs text-gray-400 font-mono">{employeeCode}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {isExempt ? (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
              غير خاضع للتقييم
            </span>
          ) : showLocationBadge || showScheduleBadge ? (
            <>
              {showLocationBadge && (
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                  workLocation === 'office' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  {locationLabel(workLocation)}
                </span>
              )}
              {showScheduleBadge && (
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                  scheduleType === 'fixed_shift' ? 'bg-purple-100 text-purple-700' :
                  scheduleType === 'hourly' ? 'bg-amber-100 text-amber-700' :
                  scheduleType === 'flexible' ? 'bg-indigo-100 text-indigo-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>
                  {scheduleLabel(scheduleType)}
                </span>
              )}
            </>
          ) : (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
              غير مصنف
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 mt-1">
          <Clock className={`w-3 h-3 ${sync.color}`} />
          <span className={`text-[10px] ${sync.color}`}>{sync.text}</span>
        </div>
      </div>
    </div>
  )
}
