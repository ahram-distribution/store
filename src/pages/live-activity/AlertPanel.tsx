import { useState } from 'react'

interface Anomaly {
  type: string; severity: string; employee_id: string
  employee_name: string; detail: string
}

const SEV_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string; border: string; dot: string }> = {
  high: {
    label: 'حرجة', icon: '🔴', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500',
  },
  medium: {
    label: 'متوسطة', icon: '🟡', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500',
  },
  low: {
    label: 'منخفضة', icon: '🔵', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-400',
  },
}

const SEVERITY_ORDER = ['high', 'medium', 'low']

export function AlertPanel({ anomalies }: { anomalies: Anomaly[] }) {
  const [collapsed, setCollapsed] = useState(false)
  const [filter, setFilter] = useState<string | null>(null)

  const counts: Record<string, number> = { high: 0, medium: 0, low: 0 }
  anomalies.forEach((a) => { counts[a.severity] = (counts[a.severity] || 0) + 1 })

  const filtered = filter ? anomalies.filter((a) => a.severity === filter) : anomalies

  return (
    <div className="bg-white rounded-xl border border-border">
      {/* Header */}
      <button type="button" onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between p-3 hover:bg-surface/50 transition-colors">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">⚠️</span>
          <h2 className="text-xs font-semibold text-text">التنبيهات</h2>
          {anomalies.length > 0 && (
            <span className="bg-danger text-white text-[9px] px-1.5 py-0.5 rounded-full font-bold">{anomalies.length}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Severity counters */}
          {SEVERITY_ORDER.map((sev) => {
            const cfg = SEV_CONFIG[sev]
            return counts[sev] > 0 ? (
              <button key={sev} type="button" onClick={(e) => { e.stopPropagation(); setFilter(filter === sev ? null : sev) }}
                className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full border transition-all ${filter === sev ? `${cfg.bg} ${cfg.border} ring-1 ring-offset-1 ${cfg.border.replace('border-', 'ring-')}` : 'border-transparent hover:bg-surface'}`}>
                <span>{cfg.icon}</span>
                <span className={`font-bold ${cfg.color}`}>{counts[sev]}</span>
                <span className="text-text-secondary">{cfg.label}</span>
              </button>
            ) : null
          })}
          <span className="text-text-secondary text-[10px] transition-transform" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▾</span>
        </div>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="px-3 pb-3 space-y-1 max-h-[200px] overflow-y-auto">
          {filter && (
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-text-secondary">تصفية: {SEV_CONFIG[filter]?.label}</span>
              <button type="button" onClick={() => setFilter(null)} className="text-[9px] text-primary">إظهار الكل</button>
            </div>
          )}
          {filtered.length === 0 ? (
            <p className="text-[11px] text-text-secondary text-center py-4">لا توجد تنبيهات</p>
          ) : (
            filtered.map((a, i) => {
              const cfg = SEV_CONFIG[a.severity] || SEV_CONFIG.low
              return (
                <div key={i} className={`flex items-start gap-2 text-[10px] rounded-lg border ${cfg.bg} ${cfg.border} p-2`}>
                  <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-text truncate">{a.employee_name}</span>
                      <span className={`shrink-0 font-bold ${cfg.color}`}>{cfg.label}</span>
                    </div>
                    <div className="text-text-secondary truncate">{a.detail}</div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
