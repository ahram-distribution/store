import { useState, useRef, useEffect } from 'react'
import { useDesktopStore } from '../store/desktopStore'
import { saveGlobalFilters } from '../workspace/WorkspacePersistence'

interface Warehouse {
  id: string
  name: string
  branchId: string
}

const MOCK_WAREHOUSES: Warehouse[] = [
  { id: 'wh-1', name: 'المخزن المركزي', branchId: 'branch-1' },
  { id: 'wh-2', name: 'مخزن التوزيع', branchId: 'branch-1' },
  { id: 'wh-3', name: 'مخزن الإسكندرية', branchId: 'branch-2' },
  { id: 'wh-4', name: 'مخزن الدلتا', branchId: 'branch-3' },
]

export function WarehouseSelector() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const globalFilters = useDesktopStore((s) => s.globalFilters)
  const setGlobalFilters = useDesktopStore((s) => s.setGlobalFilters)

  const filteredWarehouses = globalFilters.branchId
    ? MOCK_WAREHOUSES.filter((w) => w.branchId === globalFilters.branchId)
    : MOCK_WAREHOUSES

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSelect = (wh: Warehouse) => {
    const filters = { warehouseId: wh.id, warehouseName: wh.name }
    setGlobalFilters(filters)
    saveGlobalFilters({ ...globalFilters, ...filters })
    setOpen(false)
  }

  const activeLabel = globalFilters.warehouseName || 'المخزن'

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
        <span style={{ fontSize: 11 }}>🏭</span>
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
          {filteredWarehouses.length === 0 && (
            <div style={{ padding: '8px 10px', color: 'var(--dt-text-muted)', fontSize: 'var(--dt-font-size-sm)', textAlign: 'center' }}>
              اختر الفرع أولاً
            </div>
          )}
          {filteredWarehouses.map((w) => (
            <button
              key={w.id}
              onClick={() => handleSelect(w)}
              style={{
                display: 'block', width: '100%', textAlign: 'right',
                padding: '6px 10px',
                background: globalFilters.warehouseId === w.id ? 'var(--dt-bg-active)' : 'transparent',
                border: 'none', borderRadius: 'var(--dt-radius-sm)',
                color: 'var(--dt-text)', fontSize: 'var(--dt-font-size-sm)',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--dt-bg-hover)' }}
              onMouseLeave={(e) => { if (globalFilters.warehouseId !== w.id) e.currentTarget.style.background = 'transparent' }}
            >
              {w.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
