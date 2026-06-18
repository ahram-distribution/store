import { useNavigate } from 'react-router-dom'

interface ActivityEvent {
  time: string; type: string; actor: string; summary: string
  ref_type: string; ref_id: string
}

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
  return (
    <div className="bg-white rounded-xl border border-border p-3">
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-sm">📋</span>
        <h2 className="text-xs font-semibold text-text">النشاط اللحظي</h2>
      </div>
      <div className="relative max-h-[300px] overflow-y-auto">
        {events.length === 0 ? (
          <p className="text-[11px] text-text-secondary text-center py-6">لا توجد أحداث حديثة</p>
        ) : (
          <div className="relative pr-4 before:absolute before:right-[7px] before:top-1 before:bottom-1 before:w-0.5 before:bg-border">
            {events.map((ev, i) => {
              const cfg = getTypeConfig(ev.type)
              return (
                <button key={i} type="button" onClick={() => handleActivityClick(ev, navigate)}
                  className="w-full text-right block relative pb-3 last:pb-0 group">
                  {/* Timeline dot */}
                  <span className={`absolute right-[-10px] top-[5px] w-[10px] h-[10px] rounded-full border-2 border-white ${cfg.dot} shadow-sm`} />
                  {/* Content */}
                  <div className="pr-3 group-hover:bg-surface rounded-lg px-2 py-1 transition-colors active:bg-surface/80 -mr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px]">{cfg.icon}</span>
                      <span className="text-[9px] text-text-secondary shrink-0">{fmtTime(ev.time)}</span>
                      <span className="text-[10px] font-semibold text-text truncate">{ev.actor}</span>
                    </div>
                    <div className="text-[10px] text-text-secondary pr-5 truncate">{ev.summary}</div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
