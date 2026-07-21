import { useState, useRef, useEffect, useCallback } from 'react'
import { useDesktopStore } from '../store/desktopStore'
import { createDefaultState } from '../workspace/WorkspaceRegistry'

interface SearchItem {
  workspaceType: string
  label: string
  category: string
  keywords: string[]
  icon?: string
}

const searchIndex: SearchItem[] = [
  { workspaceType: 'dashboard', label: 'لوحة التحكم', category: 'الصفحات', keywords: ['dashboard', 'الرئيسية', 'الرئيسيه', 'home'] },
  { workspaceType: 'orders', label: 'الطلبات', category: 'المبيعات', keywords: ['orders', 'طلبات', 'اوردرات', 'مبيعات'] },
  { workspaceType: 'customers', label: 'العملاء', category: 'المبيعات', keywords: ['customers', 'عملاء', 'زبائن'] },
  { workspaceType: 'products', label: 'المنتجات', category: 'المخزون', keywords: ['products', 'منتجات', 'اصناف'] },
  { workspaceType: 'collections', label: 'التحصيل', category: 'المالية', keywords: ['collections', 'تحصيل', 'قبض'] },
  { workspaceType: 'visits', label: 'الزيارات', category: 'المبيعات', keywords: ['visits', 'زيارات', 'متابعة'] },
  { workspaceType: 'reports', label: 'التقارير', category: 'التقارير', keywords: ['reports', 'تقارير'] },
  { workspaceType: 'sales-analytics', label: 'تحليل المبيعات', category: 'التقارير', keywords: ['sales-analytics', 'تحليل', 'مبيعات', 'عملاء', 'شركات', 'أصناف'] },
  { workspaceType: 'analytics', label: 'التحليلات', category: 'التقارير', keywords: ['analytics', 'تحليلات', 'احصائيات'] },
  { workspaceType: 'attendance', label: 'الحضور', category: 'الموارد البشرية', keywords: ['attendance', 'حضور', 'دوام'] },
  { workspaceType: 'employees', label: 'الموظفين', category: 'الموارد البشرية', keywords: ['employees', 'موظفين'] },
  { workspaceType: 'warehouse', label: 'المخازن', category: 'المخزون', keywords: ['warehouse', 'مخازن', 'مستودعات'] },
  { workspaceType: 'credit', label: 'الائتمان', category: 'المالية', keywords: ['credit', 'ائتمان', 'اقساط'] },
  { workspaceType: 'settings', label: 'الإعدادات', category: 'النظام', keywords: ['settings', 'اعدادات', 'ضبط'] },
]

export function QuickSearch() {
  const open = useDesktopStore((s) => s.quickSearchOpen)
  const setOpen = useDesktopStore((s) => s.setQuickSearchOpen)
  const addWorkspace = useDesktopStore((s) => s.addWorkspace)
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = query.trim()
    ? searchIndex.filter(
        (item) =>
          item.label.includes(query) ||
          item.keywords.some((k) => k.includes(query))
      )
    : searchIndex

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const openWorkspace = useCallback(
    (workspaceType: string) => {
      setOpen(false)
      const ws = createDefaultState(workspaceType)
      addWorkspace(ws)
      useDesktopStore.getState().setActiveTab(ws.id)
    },
    [setOpen, addWorkspace]
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[selectedIdx]) openWorkspace(filtered[selectedIdx].workspaceType)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  if (!open) return null

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.3)',
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '10vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        ref={listRef}
        style={{
          background: 'var(--dt-bg-surface)',
          borderRadius: 'var(--dt-radius-lg)',
          boxShadow: 'var(--dt-shadow-menu)',
          width: 420,
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--dt-border)' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIdx(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="ابحث عن صفحة أو إجراء..."
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              fontSize: 'var(--dt-font-size-md)',
              background: 'transparent',
              color: 'var(--dt-text-primary)',
            }}
          />
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 4 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--dt-text-muted)', fontSize: 'var(--dt-font-size-sm)' }}>
              لا توجد نتائج
            </div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.workspaceType}
                onClick={() => openWorkspace(item.workspaceType)}
                onMouseEnter={() => setSelectedIdx(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  padding: '8px 12px',
                  border: 'none',
                  background: i === selectedIdx ? 'var(--dt-bg-row-hover)' : 'transparent',
                  cursor: 'pointer',
                  borderRadius: 'var(--dt-radius-sm)',
                  textAlign: 'right',
                  fontSize: 'var(--dt-font-size-sm)',
                }}
              >
                <span style={{ fontSize: 14 }}>{item.icon || '📄'}</span>
                <div>
                  <div style={{ color: 'var(--dt-text-primary)', fontWeight: 500 }}>{item.label}</div>
                  <div style={{ color: 'var(--dt-text-muted)', fontSize: 'var(--dt-font-size-xs)' }}>{item.category}</div>
                </div>
              </button>
            ))
          )}
        </div>
        <div
          style={{
            padding: '6px 12px',
            borderTop: '1px solid var(--dt-border)',
            fontSize: 'var(--dt-font-size-xs)',
            color: 'var(--dt-text-muted)',
            display: 'flex',
            gap: 12,
          }}
        >
          <span>↑↓ تصفح</span>
          <span>↵ فتح</span>
          <span>Esc إغلاق</span>
        </div>
      </div>
    </div>
  )
}
