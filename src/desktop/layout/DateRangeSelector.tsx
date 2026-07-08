import { useState, useRef, useEffect, useCallback } from 'react'
import { useDesktopStore } from '../store/desktopStore'
import { saveGlobalFilters } from '../workspace/WorkspacePersistence'

interface DatePreset {
  id: string
  label: string
  daysOffset: number
}

const presets: DatePreset[] = [
  { id: 'today', label: 'اليوم', daysOffset: 0 },
  { id: 'yesterday', label: 'أمس', daysOffset: -1 },
  { id: 'this-week', label: 'هذا الأسبوع', daysOffset: -6 },
  { id: 'last-week', label: 'الأسبوع الماضي', daysOffset: -13 },
  { id: 'this-month', label: 'هذا الشهر', daysOffset: -29 },
  { id: 'last-month', label: 'الشهر الماضي', daysOffset: -59 },
  { id: 'current-quarter', label: 'الربع الحالي', daysOffset: -89 },
  { id: 'this-year', label: 'هذه السنة', daysOffset: -364 },
  { id: 'custom', label: 'نطاق مخصص', daysOffset: -1 },
]

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getDateRange(presetId: string): { dateFrom: string; dateTo: string } | null {
  const preset = presets.find((p) => p.id === presetId)
  if (!preset || preset.id === 'custom') return null
  const today = new Date()
  const to = toDateString(today)
  const from = toDateString(new Date(today.getTime() + preset.daysOffset * 86400000))
  return { dateFrom: from, dateTo: to }
}

export function DateRangeSelector() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const globalFilters = useDesktopStore((s) => s.globalFilters)
  const setGlobalFilters = useDesktopStore((s) => s.setGlobalFilters)

  const activePreset = globalFilters.datePreset || 'today'
  const activeLabel = presets.find((p) => p.id === activePreset)?.label || 'اليوم'

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSelect = useCallback((presetId: string) => {
    if (presetId === 'custom') {
      setOpen(false)
      return
    }
    const range = getDateRange(presetId)
    if (range) {
      const filters = { datePreset: presetId, ...range }
      setGlobalFilters(filters)
      saveGlobalFilters({ ...globalFilters, ...filters })
    }
    setOpen(false)
  }, [globalFilters, setGlobalFilters])

  const handleCustomDate = useCallback((field: 'dateFrom' | 'dateTo', value: string) => {
    const filters = { [field]: value, datePreset: 'custom' }
    setGlobalFilters(filters)
    saveGlobalFilters({ ...globalFilters, ...filters })
  }, [globalFilters, setGlobalFilters])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', background: 'var(--dt-bg)',
          border: '1px solid var(--dt-border)',
          borderRadius: 'var(--dt-radius-md)',
          color: 'var(--dt-text)', fontSize: 'var(--dt-font-size-sm)',
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: 11 }}>📅</span>
        <span>{activeLabel}</span>
        <span style={{ fontSize: 10, color: 'var(--dt-text-muted)' }}>▼</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4,
            background: 'var(--dt-bg-surface)', border: '1px solid var(--dt-border)',
            borderRadius: 'var(--dt-radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000, minWidth: 200, padding: 4,
          }}
        >
          {presets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleSelect(preset.id)}
              style={{
                display: 'block', width: '100%', textAlign: 'right',
                padding: '6px 10px', background: activePreset === preset.id ? 'var(--dt-bg-active)' : 'transparent',
                border: 'none', borderRadius: 'var(--dt-radius-sm)',
                color: 'var(--dt-text)', fontSize: 'var(--dt-font-size-sm)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--dt-bg-hover)' }}
              onMouseLeave={(e) => { if (activePreset !== preset.id) e.currentTarget.style.background = 'transparent' }}
            >
              {preset.label}
            </button>
          ))}
          {activePreset === 'custom' && (
            <div style={{ padding: '8px 10px', borderTop: '1px solid var(--dt-border)', display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                type="date"
                value={globalFilters.dateFrom || ''}
                onChange={(e) => handleCustomDate('dateFrom', e.target.value)}
                style={{ flex: 1, fontSize: 'var(--dt-font-size-xs)', padding: 2, borderRadius: 'var(--dt-radius-sm)', border: '1px solid var(--dt-border)', background: 'var(--dt-bg)', color: 'var(--dt-text)' }}
              />
              <input
                type="date"
                value={globalFilters.dateTo || ''}
                onChange={(e) => handleCustomDate('dateTo', e.target.value)}
                style={{ flex: 1, fontSize: 'var(--dt-font-size-xs)', padding: 2, borderRadius: 'var(--dt-radius-sm)', border: '1px solid var(--dt-border)', background: 'var(--dt-bg)', color: 'var(--dt-text)' }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
