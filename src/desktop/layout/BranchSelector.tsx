import { useState, useRef, useEffect } from 'react'
import { useDesktopStore } from '../store/desktopStore'
import { saveGlobalFilters } from '../workspace/WorkspacePersistence'

interface Branch {
  id: string
  name: string
  companyId: string
}

const MOCK_BRANCHES: Branch[] = [
  { id: 'branch-1', name: 'الفرع الرئيسي - القاهرة', companyId: 'comp-1' },
  { id: 'branch-2', name: 'فرع الإسكندرية', companyId: 'comp-1' },
  { id: 'branch-3', name: 'فرع الدلتا', companyId: 'comp-2' },
]

export function BranchSelector() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const globalFilters = useDesktopStore((s) => s.globalFilters)
  const setGlobalFilters = useDesktopStore((s) => s.setGlobalFilters)

  const filteredBranches = globalFilters.companyId
    ? MOCK_BRANCHES.filter((b) => b.companyId === globalFilters.companyId)
    : MOCK_BRANCHES

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSelect = (branch: Branch) => {
    const filters = {
      branchId: branch.id,
      branchName: branch.name,
      warehouseId: null,
      warehouseName: null,
    }
    setGlobalFilters(filters)
    saveGlobalFilters({ ...globalFilters, ...filters })
    setOpen(false)
  }

  const activeLabel = globalFilters.branchName || 'الفرع'

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
        <span style={{ fontSize: 11 }}>🏛️</span>
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
          {filteredBranches.length === 0 && (
            <div style={{ padding: '8px 10px', color: 'var(--dt-text-muted)', fontSize: 'var(--dt-font-size-sm)', textAlign: 'center' }}>
              اختر الشركة أولاً
            </div>
          )}
          {filteredBranches.map((b) => (
            <button
              key={b.id}
              onClick={() => handleSelect(b)}
              style={{
                display: 'block', width: '100%', textAlign: 'right',
                padding: '6px 10px',
                background: globalFilters.branchId === b.id ? 'var(--dt-bg-active)' : 'transparent',
                border: 'none', borderRadius: 'var(--dt-radius-sm)',
                color: 'var(--dt-text)', fontSize: 'var(--dt-font-size-sm)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--dt-bg-hover)' }}
              onMouseLeave={(e) => { if (globalFilters.branchId !== b.id) e.currentTarget.style.background = 'transparent' }}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
