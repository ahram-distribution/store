import { useState, useRef, useEffect } from 'react'
import { useDesktopStore } from '../store/desktopStore'
import { saveGlobalFilters } from '../workspace/WorkspacePersistence'

interface Company {
  id: string
  name: string
}

const MOCK_COMPANIES: Company[] = [
  { id: 'comp-1', name: 'الشركة الأم للأهرام' },
  { id: 'comp-2', name: 'شركة الأهرام للتوزيع' },
]

export function CompanySelector() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const globalFilters = useDesktopStore((s) => s.globalFilters)
  const setGlobalFilters = useDesktopStore((s) => s.setGlobalFilters)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSelect = (company: Company) => {
    const filters = {
      companyId: company.id,
      companyName: company.name,
      branchId: null,
      branchName: null,
      warehouseId: null,
      warehouseName: null,
    }
    setGlobalFilters(filters)
    saveGlobalFilters({ ...globalFilters, ...filters })
    setOpen(false)
  }

  const activeLabel = globalFilters.companyName || 'الشركة'

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
          cursor: 'pointer', whiteSpace: 'nowrap', maxWidth: 140,
        }}
      >
        <span style={{ fontSize: 11 }}>🏢</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeLabel}</span>
        <span style={{ fontSize: 10, color: 'var(--dt-text-muted)' }}>▼</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4,
            background: 'var(--dt-bg-surface)', border: '1px solid var(--dt-border)',
            borderRadius: 'var(--dt-radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 1000, minWidth: 200, padding: 4,
          }}
        >
          {MOCK_COMPANIES.map((c) => (
            <button
              key={c.id}
              onClick={() => handleSelect(c)}
              style={{
                display: 'block', width: '100%', textAlign: 'right',
                padding: '6px 10px',
                background: globalFilters.companyId === c.id ? 'var(--dt-bg-active)' : 'transparent',
                border: 'none', borderRadius: 'var(--dt-radius-sm)',
                color: 'var(--dt-text)', fontSize: 'var(--dt-font-size-sm)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--dt-bg-hover)' }}
              onMouseLeave={(e) => { if (globalFilters.companyId !== c.id) e.currentTarget.style.background = 'transparent' }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
