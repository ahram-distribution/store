import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import {
  MapPin, Clock, Users, ClipboardList, LogOut, Navigation,
  CheckCircle2, XCircle, Building2, FileText, Timer,
} from 'lucide-react'
import { hrControlService, distanceMeters, isWithinZone } from '../../services/hrControl'
import { getCurrentLocation } from '../../services/gpsService'
import { attendanceService } from '../../services/attendance'
import { formatTime } from '../../utils/format'

type Section = 'today' | 'zone' | 'requests' | 'info'

const SECTIONS: { key: Section; label: string; icon: React.ReactNode }[] = [
  { key: 'today', label: 'دوام اليوم', icon: <Clock className="w-4 h-4" /> },
  { key: 'zone', label: 'نطاق الحضور', icon: <MapPin className="w-4 h-4" /> },
  { key: 'requests', label: 'طلباتي', icon: <ClipboardList className="w-4 h-4" /> },
  { key: 'info', label: 'بياناتي', icon: <Users className="w-4 h-4" /> },
]

export default function EmployeeHRPage() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [section, setSection] = useState<Section>('today')
  const [status, setStatus] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    attendanceService.getMyStatus()
      .then((s) => setStatus(s))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-text">شؤون العاملين</h1>
          <p className="text-xs text-text-secondary">{user?.full_name || ''}</p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap border transition-all ${
              section === s.key
                ? 'bg-gradient-to-l from-primary to-blue-900 text-white border-transparent shadow'
                : 'bg-white text-text-secondary border-border active:bg-surface'
            }`}
          >
            {s.icon}
            {s.label}
          </button>
        ))}
      </div>

      {section === 'today' && <TodaySection status={status} loading={loading} />}
      {section === 'zone' && <ZoneSection />}
      {section === 'requests' && <RequestsSection />}
      {section === 'info' && <InfoSection />}
    </div>
  )
}

/* ---------- دوام اليوم ---------- */
function TodaySection({ status, loading }: { status: any; loading: boolean }) {
  const cfg = hrControlService.getZoneConfig()

  const isActive = status?.status === 'active'

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl p-5 text-white shadow-lg ${isActive ? 'bg-gradient-to-br from-green-500 to-green-700' : 'bg-gradient-to-br from-primary to-primary-dark'}`}>
        <div className="flex items-center gap-2 text-sm font-bold">
          <span className={`w-2.5 h-2.5 rounded-full ${isActive ? 'bg-white animate-pulse' : 'bg-white/40'}`} />
          {isActive ? 'يوم عمل نشط' : 'لم يبدأ يوم العمل بعد'}
        </div>
        {status?.started_at && (
          <div className="text-3xl font-extrabold mt-2 tabular-nums" dir="ltr">
            {formatTime(status.started_at, { hour12: false })}
          </div>
        )}
        {status?.ended_at && (
          <div className="text-xs text-white/80 mt-1">انتهى الساعة {formatTime(status.ended_at, { hour12: false })}</div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-10 text-sm text-text-secondary">جاري تحميل الحالة...</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="مدة اليوم" value={status?.duration_minutes != null ? `${Math.floor(status.duration_minutes / 60)}س ${Math.round(status.duration_minutes % 60)}د` : '--'} icon={<Timer className="w-4 h-4 text-primary" />} />
          <Stat label="صافي العمل" value={status?.net_work_minutes != null ? `${Math.floor(status.net_work_minutes / 60)}س ${Math.round(status.net_work_minutes % 60)}د` : '--'} icon={<Clock className="w-4 h-4 text-green-600" />} />
          <Stat label="الاستراحات" value={status?.break_count != null ? String(status.break_count) : '--'} icon={<LogOut className="w-4 h-4 text-amber-600" />} />
          <Stat label="الزيارات" value={status?.visit_count != null ? String(status.visit_count) : '--'} icon={<Navigation className="w-4 h-4 text-blue-600" />} />
        </div>
      )}

      <div className="bg-white rounded-2xl border border-border shadow-sm p-4">
        <div className="text-xs text-text-secondary font-bold mb-1">دوامي يتبع مقر العمل</div>
        <div className="text-sm font-bold text-text">{cfg.name}</div>
        <div className="text-[10px] text-text-muted mt-0.5">
          بداية {cfg.official_start_time} • نهاية تلقائية {cfg.official_end_time} • نطاق {cfg.radius_meters} متر
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm p-4">
      <div className="flex items-center gap-1.5 text-xs text-text-secondary font-bold mb-1.5">{icon}{label}</div>
      <div className="text-lg font-extrabold text-text">{value}</div>
    </div>
  )
}

/* ---------- نطاق الحضور ---------- */
function ZoneSection() {
  const cfg = hrControlService.getZoneConfig()
  const [locState, setLocState] = useState<{ status: 'idle' | 'locating' | 'done' | 'error'; distance?: number; inZone?: boolean }>({ status: 'idle' })

  const check = async () => {
    setLocState({ status: 'locating' })
    const res = await getCurrentLocation()
    if (!res.success || !res.location) {
      setLocState({ status: 'error' })
      return
    }
    const d = distanceMeters(res.location.latitude, res.location.longitude, cfg.latitude, cfg.longitude)
    setLocState({ status: 'done', distance: Math.round(d), inZone: isWithinZone(res.location.latitude, res.location.longitude, cfg) })
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 bg-gradient-to-l from-secondary to-blue-900 px-4 py-3">
          <Building2 className="w-4 h-4 text-gold-light" />
          <h3 className="text-sm font-bold text-white">{cfg.name}</h3>
        </div>
        <div className="p-4">
          <div className="bg-surface rounded-xl p-3 text-center text-xs text-text-secondary">
            📍 {cfg.address}
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="bg-blue-50 rounded-xl p-3 text-center">
              <div className="text-[10px] text-blue-600 font-bold">نطاق الحضور المسموح</div>
              <div className="text-lg font-extrabold text-primary mt-0.5">{cfg.radius_meters} متر</div>
            </div>
            <div className="bg-surface rounded-xl p-3 text-center">
              <div className="text-[10px] text-text-secondary font-bold">نهاية الدوام الآلية</div>
              <div className="text-lg font-extrabold text-danger mt-0.5">{cfg.official_end_time}</div>
            </div>
          </div>

          <button onClick={check}
            className="mt-3 w-full bg-gradient-to-l from-primary to-blue-900 text-white rounded-xl py-3 text-sm font-bold active:scale-95 transition-all flex items-center justify-center gap-2">
            <Navigation className="w-4 h-4" />
            {locState.status === 'locating' ? 'جاري تحديد الموقع...' : 'التحقق من موقعي داخل النطاق'}
          </button>

          {locState.status === 'done' && (
            <div className={`mt-3 rounded-xl px-3 py-3 text-center text-sm font-bold flex items-center justify-center gap-2 ${
              locState.inZone ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {locState.inZone ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
              {locState.inZone
                ? `أنت داخل النطاق (تبعد ${locState.distance} متر)`
                : `أنت خارج النطاق (تبعد ${locState.distance} متر)`}
            </div>
          )}
          {locState.status === 'error' && (
            <div className="mt-3 rounded-xl px-3 py-3 text-center text-sm font-bold bg-red-100 text-red-700">
              تعذر الحصول على موقعك الحالي. تأكد من تفعيل خدمة الموقع.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- طلباتي ---------- */
function RequestsSection() {
  const requests = [
    { key: 'overtime', label: 'طلب عمل إضافي', desc: 'إضافي معتمد يؤثر على المسير فقط بعد الموافقة' },
    { key: 'leave', label: 'طلب إجازة', desc: 'إجازة مدفوعة أو غير مدفوعة' },
    { key: 'mission', label: 'طلب مأمورية', desc: 'مأمورية عمل لا تُخصم من الرصيد' },
    { key: 'early', label: 'إذن انصراف مبكر', desc: 'بدلاً من زر الانصراف - يُسجل تلقائياً بنهاية الدوام' },
  ]
  return (
    <div className="space-y-3">
      {requests.map((r) => (
        <button key={r.key} disabled
          className="w-full bg-white rounded-2xl border border-border shadow-sm p-4 text-right opacity-80 cursor-not-allowed">
          <div className="text-sm font-bold text-text">{r.label}</div>
          <div className="text-[11px] text-text-muted mt-0.5">{r.desc}</div>
          <div className="text-[10px] text-amber-600 font-bold mt-1.5">⏳ القناة قيد التفعيل</div>
        </button>
      ))}
      <div className="bg-white rounded-2xl border border-border shadow-sm">
        <div className="text-center py-8 text-xs text-text-secondary">
          📄 قائمة طلباتك ستظهر هنا بعد تفعيل الخادم
        </div>
      </div>
    </div>
  )
}

/* ---------- بياناتي ---------- */
function InfoSection() {
  const user = useAuthStore((s) => s.user)
  const rows = [
    { label: 'الاسم', value: user?.full_name || '--' },
    { label: 'كود الموظف', value: user?.code || '--' },
    { label: 'نوع الهوية', value: user?.identity_type === 'employee' ? 'موظف' : user?.identity_type || '--' },
    { label: 'الأدوار', value: (user?.roles ?? []).join('، ') || '--' },
  ]
  return (
    <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <FileText className="w-4 h-4 text-text-secondary" />
        <h3 className="text-sm font-bold text-text">البيانات الشخصية</h3>
      </div>
      <div className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.label} className="px-4 py-3 flex items-center justify-between">
            <div className="text-xs text-text-secondary font-bold">{r.label}</div>
            <div className="text-sm text-text font-bold">{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
