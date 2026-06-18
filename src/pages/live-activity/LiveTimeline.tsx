import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface ActivityEvent {
  time: string; type: string; actor: string; summary: string
  ref_type: string; ref_id: string
}

const COLLAPSED_KEY = 'live_timeline_collapsed'

const TYPE_CONFIG: Record<string, { icon: string; label: string; dot: string }> = {
  workday_start: { icon: '▶️', label: 'بدء يوم', dot: 'bg-green-500' },
  manual_close: { icon: '⏹️', label: 'إنهاء يوم', dot: 'bg-gray-400' },
  auto_closed: { icon: '⏏️', label: 'إنهاء تلقائي', dot: 'bg-red-400' },
  day_rollover: { icon: '🌙', label: 'تجاوز منتصف الليل', dot: 'bg-indigo-400' },
  admin_closed: { icon: '🔐', label: 'إنهاء إداري', dot: 'bg-orange-400' },
  warning_sent: { icon: '⚠️', label: 'إنذار', dot: 'bg-amber-400' },
  warning_cleared: { icon: '✅', label: 'إلغاء إنذار', dot: 'bg-green-400' },
  order_created: { icon: '📦', label: 'طلب جديد', dot: 'bg-blue-500' },
  visit_started: { icon: '🟢', label: 'بدأ زيارة', dot: 'bg-emerald-500' },
  visit_completed: { icon: '🏁', label: 'أنهى زيارة', dot: 'bg-blue-400' },
  collection_made: { icon: '💵', label: 'تحصيل', dot: 'bg-green-600' },
  customer_registered: { icon: '👤', label: 'عميل جديد', dot: 'bg-cyan-500' },
}

function getTypeConfig(type: string) {
  return TYPE_CONFIG[type] || { icon: '📋', label: type, dot: 'bg-gray-300' }
}

function handleActivityClick(ev: ActivityEvent, navigate: ReturnType<typeof useNavigate>) {
  switch (ev.ref_type) {
    case 'order': navigate(`/orders/${ev.ref_id}`); break
    case 'visit': navigate(`/visits/${ev.ref_id}`); break
    case 'customer': navigate(`/customers/${ev.ref_id}`); break
    case 'collection': navigate('/collections'); break
  }
}

function fmtTime(d: string): string {
  try { return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }).format(new Date(d)) }
  catch { return '--' }
}

export function LiveTimeline({ events }: { events: ActivityEvent[] }) {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === 'true' } catch { return false }
  })

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(COLLAPSED_KEY, String(next)) } catch {}
  }

  return (
    <div className="bg-white rounded-xl border border-border">
      {/* Header */}
      <button type="button" onClick={toggleCollapsed}
        className="w-full flex items-center justify-between p-3 hover:bg-surface/50 transition-colors">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">📋</span>
          <h2 className="text-xs font-semibold text-text">النشاط اللحظي</h2>
          {events.length > 0 && (
            <span className="bg-primary text-white text-[11px] px-1.5 py-0.5 rounded-full font-bold">{events.length}</span>
          )}
        </div>
        <span className="text-text-secondary text-xs transition-transform" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▾</span>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="px-3 pb-3 max-h-[400px] overflow-y-auto">
          {events.length === 0 ? (
            <p className="text-xs text-text-secondary text-center py-6">لا توجد أحداث حديثة</p>
          ) : (
            <div className="relative pr-4 before:absolute before:right-[7px] before:top-1 before:bottom-1 before:w-0.5 before:bg-border">
              {events.map((ev, i) => {
                const cfg = getTypeConfig(ev.type)
                return (
                  <button key={i} type="button" onClick={() => handleActivityClick(ev, navigate)}
                    className="w-full text-right block relative pb-3 last:pb-0 group">
                    <span className={`absolute right-[-10px] top-[5px] w-[10px] h-[10px] rounded-full border-2 border-white ${cfg.dot} shadow-sm`} />
                    <div className="pr-3 group-hover:bg-surface rounded-lg px-2 py-1.5 transition-colors active:bg-surface/80 -mr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">{cfg.icon}</span>
                        <span className="text-xs text-text-secondary shrink-0">{fmtTime(ev.time)}</span>
                        <span className="text-xs font-semibold text-text truncate">{ev.actor}</span>
                      </div>
                      <div className="text-xs text-text-secondary pr-6 truncate">{ev.summary}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
