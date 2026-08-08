import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import {
  Clock, FileText,
  ShieldAlert, Edit2, X, Building2, ChevronLeft,
  Timer, CalendarClock, Wallet, Menu,
} from 'lucide-react'
import { hrControlService, isWithinZone, distanceMeters, type AttendanceZoneConfig } from '../../services/hrControl'
import { getCurrentLocation } from '../../services/gpsService'
import { formatDateTime, formatTime } from '../../utils/format'
import { EmployeeDirectory } from './EmployeeDirectory'
import { EmployeeProfile } from './EmployeeProfile'
import { AddEmployeeForm } from './AddEmployeeForm'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

type SectionKey =
  | 'dashboard' | 'employees' | 'attendance' | 'locations' | 'requests'
  | 'overtime' | 'penalties' | 'rewards' | 'payroll' | 'audit'

const SIDEBAR: { key: SectionKey; label: string; icon: string }[] = [
  { key: 'dashboard', label: 'لوحة القيادة', icon: '📊' },
  { key: 'employees', label: 'الموظفون', icon: '👥' },
  { key: 'attendance', label: 'الحضور', icon: '⏱️' },
  { key: 'locations', label: 'مقار العمل', icon: '🏢' },
  { key: 'requests', label: 'الطلبات', icon: '📝' },
  { key: 'overtime', label: 'الإضافي', icon: '🧮' },
  { key: 'penalties', label: 'الجزاءات', icon: '⚖️' },
  { key: 'rewards', label: 'المكافآت', icon: '🎁' },
  { key: 'payroll', label: 'الرواتب', icon: '🧾' },
  { key: 'audit', label: 'سجل التدقيق', icon: '🛡️' },
]

interface LiveEntry {
  employee_id: string
  name: string
  role_name: string
  status: string
  started_at?: string
  duration_minutes?: number
  latitude?: number
  longitude?: number
  connection_status: string
}

interface LiveData {
  active_count: number
  on_visit_count: number
  on_break_count: number
  connection_loss_count: number
  no_start_count: number
  ended_count: number
  employees: LiveEntry[]
}

type EmpView =
  | { type: 'list' }
  | { type: 'add' }
  | { type: 'profile'; emp: any }

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    working: { label: 'يعمل', cls: 'bg-green-100 text-green-700' },
    on_visit: { label: 'في زيارة', cls: 'bg-blue-100 text-blue-700' },
    on_break: { label: 'استراحة', cls: 'bg-amber-100 text-amber-700' },
    lost: { label: 'انقطاع', cls: 'bg-red-100 text-red-700' },
  }
  const m = map[status] ?? { label: '--', cls: 'bg-gray-100 text-gray-500' }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${m.cls}`}>{m.label}</span>
}

function SystemRuleNotice({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'danger' }) {
  const cls = tone === 'danger'
    ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-blue-50 border-blue-200 text-blue-800'
  return (
    <div className={`border rounded-xl px-3 py-2.5 text-xs leading-relaxed ${cls}`}>
      <ShieldAlert className="w-4 h-4 inline ml-1 align-[-2px]" />
      {children}
    </div>
  )
}

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-10">
      <div className="text-3xl mb-2">🗂️</div>
      <div className="text-sm font-bold text-text-secondary">{title}</div>
      {hint && <div className="text-xs text-text-muted mt-1">{hint}</div>}
    </div>
  )
}

export default function HRControlPage() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [section, setSection] = useState<SectionKey>('dashboard')
  const [empView, setEmpView] = useState<EmpView>({ type: 'list' })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [live, setLive] = useState<LiveData | null>(null)
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const loadAll = () => {
    const token = getToken()
    if (!token) return
    setLoading(true)
    Promise.all([
      supabase.rpc('get_live_workday_overview', { p_token: token.trim() }),
      supabase.rpc('get_governed_employees', { p_token: token }),
    ]).then(([liveRes, empRes]) => {
      if (liveRes.data && !('error' in (liveRes.data as object))) setLive(liveRes.data as LiveData)
      if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
      setLoading(false)
    })
  }

  useEffect(() => { loadAll() }, [])

  const goTo = (s: SectionKey) => {
    setSection(s)
    setEmpView({ type: 'list' })
    setDrawerOpen(false)
  }

  const actorName = user?.full_name || ''

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-text">التحكم في الموارد البشرية</h1>
          <p className="text-xs text-text-secondary">الإدارة العليا - Supreme</p>
        </div>
        <div className="flex items-center gap-1.5 bg-blue-50 text-primary px-3 py-1.5 rounded-full text-xs font-bold">
          <Building2 className="w-3.5 h-3.5" />
          الفرع الرئيسي
        </div>
        <button onClick={() => setDrawerOpen(true)} className="lg:hidden flex items-center gap-1 bg-primary text-white rounded-xl px-3 py-2 text-xs font-bold active:bg-blue-800">
          <Menu className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-4 items-start">
        {/* Desktop sidebar — RTL: renders on the right */}
        <aside className="hidden lg:block lg:w-64 shrink-0 lg:sticky lg:top-4 self-start">
          <SidebarPanel section={section} onNavigate={goTo} />
        </aside>

        {/* Mobile drawer */}
        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
            <div className="absolute top-0 bottom-0 right-0 w-72 max-w-[85vw] flex">
              <SidebarPanel section={section} onNavigate={goTo} onClose={() => setDrawerOpen(false)} />
            </div>
          </div>
        )}

        <main className="flex-1 min-w-0">
          {loading ? (
            <div className="text-center py-16 text-sm text-text-secondary">جاري التحميل...</div>
          ) : (
            <>
              {section === 'dashboard' && <DashboardTab live={live} employees={employees} onGoEmployees={() => goTo('employees')} />}
              {section === 'employees' && (
                empView.type === 'profile' ? (
                  <EmployeeProfile
                    employee={empView.emp}
                    employees={employees}
                    actorName={actorName}
                    onBack={() => setEmpView({ type: 'list' })}
                    onChanged={loadAll}
                  />
                ) : empView.type === 'add' ? (
                  <AddEmployeeForm
                    employees={employees}
                    onBack={() => setEmpView({ type: 'list' })}
                    onCreated={(id, name) => {
                      loadAll()
                      if (id) {
                        const found = employees.find((e: any) => e.id === id)
                        setEmpView(found ? { type: 'profile', emp: found } : { type: 'list' })
                      } else {
                        setEmpView({ type: 'list' })
                      }
                    }}
                  />
                ) : (
                  <EmployeeDirectory
                    employees={employees}
                    onOpen={(emp) => setEmpView({ type: 'profile', emp })}
                    onAdd={() => setEmpView({ type: 'add' })}
                  />
                )
              )}
              {section === 'attendance' && <AttendanceTab live={live} actorName={actorName} />}
              {section === 'locations' && <LocationsTab />}
              {section === 'requests' && <RequestsTab />}
              {section === 'overtime' && <OvertimeTab />}
              {section === 'penalties' && <PenaltiesTab />}
              {section === 'rewards' && <RewardsTab />}
              {section === 'payroll' && <PayrollTab employees={employees} />}
              {section === 'audit' && <AuditTab />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function SidebarPanel({ section, onNavigate, onClose }: {
  section: SectionKey
  onNavigate: (s: SectionKey) => void
  onClose?: () => void
}) {
  return (
    <div className="w-full flex flex-col bg-gradient-to-b from-primary to-blue-900 rounded-2xl shadow-lg overflow-hidden">
      <div className="px-5 py-5 text-center border-b border-white/10 relative">
        {onClose && (
          <button onClick={onClose} className="absolute top-3 left-3 text-white/70 hover:text-white"><X className="w-5 h-5" /></button>
        )}
        <div className="text-2xl font-black text-gold-light">الأهرام</div>
        <div className="text-[11px] text-white/70 mt-1">الإدارة العليا | تحكم الموارد البشرية</div>
      </div>
      <nav className="flex-1 overflow-y-auto py-3">
        {SIDEBAR.map((item) => {
          const active = section === item.key
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all border-r-4 text-right ${
                active
                  ? 'bg-white/15 text-white border-gold-light font-bold'
                  : 'text-white/80 border-transparent hover:bg-white/10 hover:text-white font-medium'
              }`}
            >
              <span className="text-base w-6 text-center">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          )
        })}
      </nav>
      <div className="px-4 py-3 border-t border-white/10">
        <div className="text-[10px] text-white/60">نطاق الحضور: {hrControlService.getZoneConfig().radius_meters} متر (قابل للضبط)</div>
      </div>
    </div>
  )
}

/* ============ 1. DASHBOARD ============ */
function DashboardTab({ live, employees, onGoEmployees }: { live: LiveData | null; employees: any[]; onGoEmployees: () => void }) {
  const cfg = hrControlService.getZoneConfig()
  const active = live?.active_count ?? 0
  const kpis = [
    { title: 'موظفون نشطون', value: active, icon: '🟢', trend: live ? 'من إجمالي المنصة' : '--' },
    { title: 'في زيارة', value: live?.on_visit_count ?? '--', icon: '🔵', trend: 'ميداني' },
    { title: 'في استراحة', value: live?.on_break_count ?? '--', icon: '🟡', trend: 'راحة' },
    { title: 'انقطاع اتصال', value: live?.connection_loss_count ?? '--', icon: '🔴', trend: 'يحتاج متابعة' },
    { title: 'دليل الموظفين', value: employees.length, icon: '👥', trend: 'مسجلون' },
    { title: 'نطاق الحضور', value: `${cfg.radius_meters} متر`, icon: '📍', trend: cfg.name },
  ]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {kpis.map((k) => (
          <div key={k.title} className="bg-white rounded-2xl border border-border shadow-sm p-4">
            <div className="text-xs text-text-secondary">{k.icon} {k.title}</div>
            <div className="text-xl font-extrabold text-primary mt-1">{k.value}</div>
            <div className="text-[10px] text-text-muted mt-0.5">{k.trend}</div>
          </div>
        ))}
      </div>
      <SystemRuleNotice tone="danger">
        قاعدة آلية: لا يوجد زر انصراف للموظفين. ينتهي يوم العمل تلقائياً بنهاية الوقت المحدد لنطاق الحضور.
      </SystemRuleNotice>
      <div className="bg-gradient-to-br from-primary to-primary-dark rounded-2xl text-white p-5">
        <div className="text-sm font-bold mb-1">معدل الحضور اليومي</div>
        <div className="text-3xl font-extrabold">
          {live && live.active_count > 0
            ? `${Math.round((live.active_count / Math.max(employees.length, 1)) * 100)}%`
            : '--'}
        </div>
        <div className="text-xs text-white/70 mt-1">
          {live?.active_count ?? 0} نشطاً اليوم من {employees.length} موظفاً مسجلاً
        </div>
      </div>
      <button onClick={onGoEmployees}
        className="w-full bg-white border border-primary/30 text-primary rounded-2xl py-3 text-sm font-bold active:bg-blue-50 transition-all">
        👥 الانتقال إلى دليل الموظفين
      </button>
    </div>
  )
}

/* ============ 2. LOCATIONS / ZONE CONFIG ============ */
function LocationsTab() {
  const [cfg, setCfg] = useState<AttendanceZoneConfig>(() => hrControlService.getZoneConfig())
  const [editMode, setEditMode] = useState(false)
  const [form, setForm] = useState<AttendanceZoneConfig>(() => hrControlService.getZoneConfig())
  const [locState, setLocState] = useState<{ status: string; distance?: number; inZone?: boolean }>({ status: 'idle' })
  const user = useAuthStore((s) => s.user)

  const save = () => {
    const next = hrControlService.saveZoneConfig(form, user?.full_name || '')
    setCfg(next)
    setForm(next)
    setEditMode(false)
  }

  const testMyLocation = async () => {
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
      <SystemRuleNotice>
        نطاق الحضور قابل للضبط من هنا (الإدارة العليا). منطق الحضور يقرأ الإعدادات من هذه القيمة - لا توجد قيمة صلبة داخل كود الحضور. موظفو «بصمة المقر» يتقيدون بنطاق مقر عملهم الأساسي، وموظفو «بصمة التطبيق» لا يُفرض عليهم نطاق الفرع الرئيسي.
      </SystemRuleNotice>

      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between bg-gradient-to-l from-secondary to-blue-900 px-4 py-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gold-light" />
            <h3 className="text-sm font-bold text-white">{cfg.name}</h3>
            <span className="text-[10px] bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full font-bold">نشط</span>
          </div>
          {!editMode && (
            <button onClick={() => { setForm(cfg); setEditMode(true) }} className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg font-bold">
              تعديل الإعدادات
            </button>
          )}
        </div>

        <div className="p-4">
          {editMode ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-text-secondary">اسم المقر
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm font-normal text-text focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </label>
                <label className="text-xs font-semibold text-text-secondary">العنوان
                  <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm font-normal text-text focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </label>
                <label className="text-xs font-semibold text-text-secondary">خط العرض
                  <input type="number" step="any" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: Number(e.target.value) })}
                    className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm font-normal text-text focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </label>
                <label className="text-xs font-semibold text-text-secondary">خط الطول
                  <input type="number" step="any" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: Number(e.target.value) })}
                    className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm font-normal text-text focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </label>
                <label className="text-xs font-semibold text-text-secondary">نطاق الحضور (متر)
                  <input type="number" min={0} value={form.radius_meters} onChange={(e) => setForm({ ...form, radius_meters: Number(e.target.value) })}
                    className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm font-normal text-text focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </label>
                <label className="text-xs font-semibold text-text-secondary">بداية الدوام
                  <input type="time" value={form.official_start_time} onChange={(e) => setForm({ ...form, official_start_time: e.target.value })}
                    className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm font-normal text-text focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold text-text-secondary">نهاية الدوام (آلية)
                  <input type="time" value={form.official_end_time} onChange={(e) => setForm({ ...form, official_end_time: e.target.value })}
                    className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm font-normal text-text focus:outline-none focus:ring-2 focus:ring-primary/40" />
                </label>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={save} className="flex-1 bg-gradient-to-l from-primary to-blue-900 text-white rounded-xl py-2.5 text-sm font-bold active:scale-95 transition-all">
                  حفظ وتحديث نطاق الحضور
                </button>
                <button onClick={() => setEditMode(false)} className="px-4 border border-border rounded-xl text-sm font-bold text-text-secondary">
                  إلغاء
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="bg-surface rounded-xl p-3 text-center text-xs text-text-secondary">
                📍 إحداثيات: {cfg.latitude}° N, {cfg.longitude}° E
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
              <button onClick={testMyLocation}
                className="mt-3 w-full border border-primary/30 text-primary rounded-xl py-2.5 text-sm font-bold active:bg-blue-50 transition-all">
                {locState.status === 'locating' ? 'جاري تحديد الموقع...' : '🧭 اختبار موقعي من النطاق'}
              </button>
              {locState.status === 'done' && (
                <div className={`mt-2 rounded-xl px-3 py-2.5 text-xs font-bold text-center ${locState.inZone ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {locState.inZone ? `✓ داخل النطاق (تبعد ${locState.distance} متر)` : `✗ خارج النطاق (تبعد ${locState.distance} متر)`}
                </div>
              )}
              {locState.status === 'error' && (
                <div className="mt-2 rounded-xl px-3 py-2.5 text-xs font-bold text-center bg-red-100 text-red-700">
                  تعذر الحصول على الموقع الحالي
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ============ 3. ATTENDANCE CONTROL ============ */
function AttendanceTab({ live, actorName }: { live: LiveData | null; actorName: string }) {
  const [editing, setEditing] = useState<LiveEntry | null>(null)
  const [newValue, setNewValue] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')

  const employeesList = live?.employees ?? []

  const openEdit = (e: LiveEntry) => {
    setEditing(e)
    setNewValue(e.started_at ? formatTime(e.started_at, { hour12: false }) : '')
    setReason('')
    setNote('')
  }

  const submitEdit = () => {
    if (!editing) return
    hrControlService.appendAudit({
      actor_name: actorName || 'غير معروف',
      action: 'تعديل إداري لوقت الحضور',
      target: `${editing.name} (${editing.employee_id})`,
      before: editing.started_at ?? 'غير مسجل',
      after: newValue || 'غير مسجل',
    })
    setEditing(null)
  }

  return (
    <div className="space-y-4">
      <SystemRuleNotice tone="danger">
        البيانات أدناه من بصمة الحضور والإغلاق الآلي. أي تعديل يدوي يسجل في سجل التدقيق كـ (تعديل إداري) ولن يمحو القيمة الأصلية.
      </SystemRuleNotice>

      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-surface/50 flex items-center gap-2">
          <Clock className="w-4 h-4 text-text-secondary" />
          <span className="text-xs font-bold text-text-secondary">جلسات اليوم النشطة</span>
          <span className="text-xs bg-primary text-white px-2 py-0.5 rounded-full font-bold">{employeesList.length}</span>
        </div>
        {employeesList.length === 0 ? (
          <EmptyState title="لا توجد جلسات نشطة حالياً" hint="ستظهر هنا سجلات الحضور والانصراف الآلية" />
        ) : (
          <div className="divide-y divide-border">
            {employeesList.map((e) => (
              <div key={e.employee_id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-text">{e.name}</span>
                    <StatusBadge status={e.status} />
                  </div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    {e.started_at ? `حضور ${formatTime(e.started_at, { hour12: false })}` : '--'}
                    {e.duration_minutes ? ` • ${Math.floor(e.duration_minutes / 60)}س ${Math.round(e.duration_minutes % 60)}د` : ''}
                  </div>
                </div>
                <button onClick={() => openEdit(e)}
                  className="flex items-center gap-1 text-xs text-primary border border-primary/30 rounded-lg px-2.5 py-1.5 font-bold active:bg-blue-50">
                  <Edit2 className="w-3 h-3" />
                  تعديل
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-text">تصحيح سجل إداري</h3>
              <button onClick={() => setEditing(null)} className="text-text-secondary"><X className="w-5 h-5" /></button>
            </div>
            <SystemRuleNotice>
              القيمة الأصلية لن تحذف. سيتم إنشاء سجل تدقيق بهذا التعديل ولن يُحذف أبداً.
            </SystemRuleNotice>
            <div className="bg-surface rounded-xl p-3 space-y-1">
              <div className="text-[10px] text-text-secondary font-bold">الموظف</div>
              <div className="text-sm font-bold text-text">{editing.name}</div>
              <div className="text-[10px] text-text-secondary font-bold mt-2">الحقل المعدل</div>
              <div className="text-xs text-text">وقت الحضور (تعديل إداري)</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-text-muted">القيمة الأصلية (نظام)</label>
                <input readOnly value={editing.started_at ? formatTime(editing.started_at, { hour12: false }) : '--'}
                  className="mt-1 w-full border border-red-300 bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm line-through" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-text-muted">القيمة الجديدة المعتمدة</label>
                <input type="time" value={newValue} onChange={(e) => setNewValue(e.target.value)}
                  className="mt-1 w-full border border-green-300 bg-green-50 text-green-700 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <label className="text-[10px] font-bold text-text-muted">سبب التعديل (مطلوب للتدقيق)
              <select value={reason} onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/40">
                <option value="">-- اختر السبب --</option>
                <option>عطل في جهاز البصمة</option>
                <option>مهمة عمل خارجية قبل الوصول</option>
                <option>خطأ في النظام</option>
                <option>استثناء إداري من الإدارة العليا</option>
                <option>أخرى</option>
              </select>
            </label>
            <label className="text-[10px] font-bold text-text-muted">ملاحظات إضافية
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                placeholder="تفاصيل إضافية..." />
            </label>
            <button onClick={submitEdit}
              className="w-full bg-gradient-to-l from-primary to-blue-900 text-white rounded-xl py-3 text-sm font-bold active:scale-95 transition-all">
              اعتماد التعديل وحفظ سجل التدقيق
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ============ 4. REQUESTS ============ */
function RequestsTab() {
  const [sub, setSub] = useState<'overtime' | 'leave' | 'mission' | 'early'>('overtime')
  const tabs = [
    { key: 'overtime' as const, label: 'طلبات الإضافي' },
    { key: 'leave' as const, label: 'الإجازات' },
    { key: 'mission' as const, label: 'المأموريات' },
    { key: 'early' as const, label: 'أذون الانصراف المبكر' },
  ]
  const notices: Record<string, string> = {
    overtime: 'بقاء الموظف بعد أوقات العمل لا يُحتسب إضافياً تلقائياً. يجب طلب وموافقة الإدارة لتأثيره على مسير الرواتب.',
    leave: 'الإجازات المقسمة إلى مدفوعة وغير مدفوعة. أي يوم غياب غير معتمد يؤثر على الاستحقاق.',
    mission: 'مأمورية عمل معتمدة لا تُخصم من الرصيد ولا تُحتسب غياباً.',
    early: 'الانصراف المبكر لا يتم بزر انصراف - يُطلب إذن مسبقاً وتُسجل الفترة تلقائياً بنهاية الدوام.',
  }
  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setSub(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border ${
              sub === t.key ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      <SystemRuleNotice>{notices[sub]}</SystemRuleNotice>
      <div className="bg-white rounded-2xl border border-border shadow-sm">
        <EmptyState title={`لا توجد ${tabs.find((t) => t.key === sub)?.label} حالياً`} hint="طلبات الموظفين ستظهر هنا بعد تفعيل خادم الطلبات" />
      </div>
    </div>
  )
}

/* ============ 5. OVERTIME ============ */
function OvertimeTab() {
  return (
    <div className="space-y-4">
      <SystemRuleNotice tone="danger">
        قاعدة: البقاء بعد الدوام لا يُحتسب إضافياً تلقائياً. الموظف يستحق الإضافي فقط إذا كان مفعلاً في ملفه (إعدادات الحضور/الراتب) وبعد اعتماد الإدارة.
      </SystemRuleNotice>
      <div className="bg-white rounded-2xl border border-border shadow-sm">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Timer className="w-4 h-4 text-text-secondary" />
          <h3 className="text-sm font-bold text-text">سجل الإضافي المعتمد</h3>
        </div>
        <EmptyState title="لا توجد حركات إضافي بعد" hint="طلبات الإضافي المعتمدة ستظهر هنا بعد تفعيل خادم الطلبات" />
      </div>
    </div>
  )
}

/* ============ 6. PENALTIES ============ */
function PenaltiesTab() {
  return (
    <div className="space-y-4">
      <SystemRuleNotice>
        الجزاءات تظهر هنا فقط بعد اعتمادها من الإدارة العليا، وتؤثر على الاستقطاعات عند تفعيل خادم المسير.
      </SystemRuleNotice>
      <div className="bg-white rounded-2xl border border-border shadow-sm">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Wallet className="w-4 h-4 text-text-secondary" />
          <h3 className="text-sm font-bold text-text">سجل الجزاءات</h3>
        </div>
        <EmptyState title="لا توجد جزاءات" hint="الجزاءات المعتمدة ستظهر هنا بعد ربطها بخادم مالي" />
      </div>
    </div>
  )
}

/* ============ 7. REWARDS ============ */
function RewardsTab() {
  return (
    <div className="space-y-4">
      <SystemRuleNotice>
        المكافآت والحوافز تظهر هنا بعد اعتمادها، وتؤثر على المستحقات عند تفعيل خادم المسير.
      </SystemRuleNotice>
      <div className="bg-white rounded-2xl border border-border shadow-sm">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Wallet className="w-4 h-4 text-text-secondary" />
          <h3 className="text-sm font-bold text-text">سجل المكافآت والحوافز</h3>
        </div>
        <EmptyState title="لا توجد مكافآت" hint="المكافآت المعتمدة ستظهر هنا بعد ربطها بخادم مالي" />
      </div>
    </div>
  )
}

/* ============ 8. PAYROLL + LEDGER ============ */
function PayrollTab({ employees }: { employees: any[] }) {
  const [empId, setEmpId] = useState('')
  const emp = employees.find((e: any) => e.id === empId)
  return (
    <div className="space-y-4">
      <SystemRuleNotice>
        الراتب النهائي يُحسب بدقة من (دفتر الأستاذ للحركات - Ledger) للأحداث المالية المعتمدة فقط. بيانات الراتب التمهيدية للموظف موجودة في ملفه (إعدادات الراتب) وتُقرأ هنا عند تفعيل الخادم المالي.
      </SystemRuleNotice>
      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-bold text-text">ملخص مستحقات موظف</h3>
          <select value={empId} onChange={(e) => setEmpId(e.target.value)}
            className="mt-2 w-full border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/40">
            <option value="">-- اختر الموظف --</option>
            {employees.map((e: any) => (
              <option key={e.id || e.code} value={e.id}>{e.full_name} {e.code ? `(${e.code})` : ''}</option>
            ))}
          </select>
        </div>
        {emp ? (
          <div className="p-4 text-center text-sm text-text-secondary">
            نموذج المعادلة (أساسي + إضافي معتمد + حوافز - استقطاعات - سلف) سيُبنى بعد ربط خادم المسير.
          </div>
        ) : (
          <EmptyState title="اختر موظفاً لعرض المعادلة" hint="نموذج الحساب الداخلي قيد التطوير" />
        )}
      </div>
      <div className="bg-white rounded-2xl border border-border shadow-sm">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <FileText className="w-4 h-4 text-text-secondary" />
          <h3 className="text-sm font-bold text-text">دفتر الأستاذ للحركات المالية (Ledger)</h3>
        </div>
        <EmptyState title="لا توجد حركات مالية بعد" hint="كل حركة معتمدة تُسجل هنا بشكل قابل للتتبع" />
      </div>
    </div>
  )
}

/* ============ 9. AUDIT LOG ============ */
function AuditTab() {
  const log = hrControlService.getAuditLog()
  return (
    <div className="space-y-4">
      <SystemRuleNotice tone="danger">
        تحذير أمني: هذا السجل غير قابل للتعديل (Immutable). يعرض كافة التعديلات اليدوية التي تمت على بيانات الدوام أو الموظفين.
      </SystemRuleNotice>
      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-text-secondary" />
          <span className="text-xs font-bold text-text-secondary">أحداث التدقيق ({log.length})</span>
        </div>
        {log.length === 0 ? (
          <EmptyState title="لا توجد أحداث تدقيق بعد" hint="كل تعديل إداري سيُسجل هنا بشكل دائم" />
        ) : (
          <div className="divide-y divide-border">
            {log.map((entry) => (
              <div key={entry.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-text">{entry.action}</div>
                  <div className="text-[10px] text-text-muted">{formatDateTime(entry.ts)}</div>
                </div>
                <div className="text-[11px] text-text-secondary mt-0.5">الهدف: {entry.target}</div>
                <div className="flex items-center gap-2 mt-1.5 text-xs">
                  <span className="text-red-600 line-through bg-red-50 px-2 py-0.5 rounded">ق: {String(entry.before ?? '--')}</span>
                  <ChevronLeft className="w-3.5 h-3.5 text-text-muted" />
                  <span className="text-green-700 bg-green-50 px-2 py-0.5 rounded">جديد: {String(entry.after ?? '--')}</span>
                </div>
                <div className="text-[10px] text-text-muted mt-1">بواسطة: {entry.actor_name}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
