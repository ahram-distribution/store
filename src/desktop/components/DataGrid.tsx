import { useState, useCallback, useRef, useMemo } from 'react'
import { useDesktopStore } from '../store/desktopStore'
import type { ContextMenuItem } from '../store/desktopStore'

export interface Column<T = any> {
  key: string
  label: string
  width?: number
  minWidth?: number
  frozen?: boolean
  sortable?: boolean
  filterable?: boolean
  resizable?: boolean
  render?: (value: any, row: T) => React.ReactNode
  align?: 'left' | 'center' | 'right'
}

export type SortDirection = 'asc' | 'desc' | null

interface DataGridProps<T = any> {
  columns: Column<T>[]
  rows: T[]
  keyField?: string
  pageSize?: number
  pageSizeOptions?: number[]
  height?: string | number
  onRowClick?: (row: T) => void
  onRowDoubleClick?: (row: T) => void
  contextMenuItems?: (row: T) => ContextMenuItem[]
  loading?: boolean
  emptyMessage?: string
  searchable?: boolean
  exportable?: boolean
  rowHeight?: number
}

export function DataGrid<T extends Record<string, any>>({
  columns,
  rows,
  keyField = 'id',
  pageSize: defaultPageSize = 25,
  pageSizeOptions = [10, 25, 50, 100],
  height = '100%',
  onRowClick,
  onRowDoubleClick,
  contextMenuItems,
  loading = false,
  emptyMessage = 'لا توجد بيانات',
  searchable = true,
  exportable = true,
  rowHeight = 36,
}: DataGridProps<T>) {
  const showContextMenu = useDesktopStore((s) => s.showContextMenu)
  const hideContextMenu = useDesktopStore((s) => s.hideContextMenu)
  const selectedRows = useDesktopStore((s) => s.selectedRows)
  const setSelectedRows = useDesktopStore((s) => s.setSelectedRows)

  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<SortDirection>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(defaultPageSize)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [columnOrder, setColumnOrder] = useState<string[]>(columns.map((c) => c.key))
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [resizing, setResizing] = useState<string | null>(null)
  const [hoveredCol, setHoveredCol] = useState<string | null>(null)
  const resizeStart = useRef<{ key: string; x: number; width: number } | null>(null)

  const visibleColumns = useMemo(
    () => columnOrder.map((key) => columns.find((c) => c.key === key)!).filter(Boolean),
    [columnOrder, columns]
  )

  const frozenColumns = useMemo(() => visibleColumns.filter((c) => c.frozen), [visibleColumns])
  const scrollableColumns = useMemo(() => visibleColumns.filter((c) => !c.frozen), [visibleColumns])

  const processedRows = useMemo(() => {
    let data = [...rows]

    for (const [key, value] of Object.entries(filters)) {
      if (value.trim()) {
        data = data.filter((row) => {
          const cell = String(row[key] ?? '').toLowerCase()
          return cell.includes(value.toLowerCase())
        })
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      data = data.filter((row) =>
        columns.some((col) => String(row[col.key] ?? '').toLowerCase().includes(q))
      )
    }

    if (sortKey && sortDir) {
      data.sort((a, b) => {
        const aVal = a[sortKey]
        const bVal = b[sortKey]
        if (aVal == null) return 1
        if (bVal == null) return -1
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
        return sortDir === 'asc' ? cmp : -cmp
      })
    }

    return data
  }, [rows, filters, searchQuery, sortKey, sortDir, columns])

  const totalPages = Math.max(1, Math.ceil(processedRows.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  const pagedRows = processedRows.slice(safePage * pageSize, (safePage + 1) * pageSize)

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc'))
      if (sortDir === 'desc') setSortKey(null)
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const handleResizeStart = (key: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const col = columns.find((c) => c.key === key)
    const currentWidth = columnWidths[key] || col?.width || 120
    resizeStart.current = { key, x: e.clientX, width: currentWidth }
    setResizing(key)

    const onMove = (ev: MouseEvent) => {
      if (!resizeStart.current) return
      const dx = ev.clientX - resizeStart.current.x
      const newWidth = Math.max(col?.minWidth || 60, resizeStart.current.width + dx)
      setColumnWidths((prev) => ({ ...prev, [key]: newWidth }))
    }

    const onUp = () => {
      setResizing(null)
      resizeStart.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleDragStart = (key: string, e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', key)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (targetKey: string, e: React.DragEvent) => {
    e.preventDefault()
    const sourceKey = e.dataTransfer.getData('text/plain')
    if (sourceKey === targetKey) return
    setColumnOrder((prev) => {
      const next = prev.filter((k) => k !== sourceKey)
      const targetIdx = next.indexOf(targetKey)
      next.splice(targetIdx, 0, sourceKey)
      return next
    })
  }

  const toggleRow = (id: string) => {
    const next = new Set(selectedRows)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedRows(next)
  }

  const toggleAll = () => {
    if (selectedRows.size === pagedRows.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(pagedRows.map((r) => String(r[keyField]))))
    }
  }

  const getCellValue = (row: T, col: Column) => {
    const val = row[col.key]
    return col.render ? col.render(val, row) : val ?? '—'
  }

  const exportCSV = useCallback(() => {
    const header = columns.map((c) => c.label).join(',')
    const body = processedRows
      .map((row) => columns.map((c) => `"${String(row[c.key] ?? '')}"`).join(','))
      .join('\n')
    const blob = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `export-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [columns, processedRows])

  const exportExcel = useCallback(async () => {
    try {
      const XLSX = await import('xlsx')
      const header = columns.map((c) => c.label)
      const body = processedRows.map((row) => columns.map((c) => String(row[c.key] ?? '')))
      const ws = XLSX.utils.aoa_to_sheet([header, ...body])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Data')
      XLSX.writeFile(wb, `export-${Date.now()}.xlsx`)
    } catch {
      // xlsx not available
    }
  }, [columns, processedRows])

  const renderSortIcon = (key: string) => {
    if (sortKey !== key) return <span style={{ opacity: 0.3, fontSize: 10 }}> ↕</span>
    return <span style={{ color: 'var(--dt-primary)', fontSize: 10 }}>{sortDir === 'asc' ? ' ↑' : ' ↓'}</span>
  }

  const getColWidth = (col: Column) => columnWidths[col.key] || col.width || 120

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height, overflow: 'hidden' }}>
      {(searchable || exportable) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 8px',
            borderBottom: '1px solid var(--dt-border)',
            background: 'var(--dt-bg-surface)',
            flexShrink: 0,
          }}
        >
          {searchable && (
            <input
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(0) }}
              placeholder="بحث في الجدول..."
              style={{
                padding: '4px 8px',
                border: '1px solid var(--dt-border)',
                borderRadius: 'var(--dt-radius-sm)',
                fontSize: 'var(--dt-font-size-sm)',
                outline: 'none',
                width: 220,
                background: 'var(--dt-bg)',
              }}
            />
          )}
          <div style={{ flex: 1 }} />
          {exportable && (
            <>
              <button onClick={exportCSV} title="تصدير CSV"
                style={btnStyle}>CSV</button>
              <button onClick={exportExcel} title="تصدير Excel"
                style={btnStyle}>Excel</button>
              <button onClick={() => window.print()} title="طباعة"
                style={btnStyle}>طباعة</button>
            </>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 'var(--dt-font-size-sm)',
          }}
        >
          <thead>
            <tr
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 2,
                background: 'var(--dt-bg-header)',
              }}
            >
              <th
                style={{
                  ...thStyle,
                  width: 36,
                  position: 'sticky',
                  right: 0,
                  zIndex: 3,
                  background: 'var(--dt-bg-header)',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedRows.size === pagedRows.length && pagedRows.length > 0}
                  onChange={toggleAll}
                  style={{ cursor: 'pointer' }}
                />
              </th>
              {visibleColumns.map((col) => {
                const width = getColWidth(col)
                return (
                  <th
                    key={col.key}
                    draggable
                    onDragStart={(e) => handleDragStart(col.key, e)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(col.key, e)}
                    onClick={() => col.sortable !== false && handleSort(col.key)}
                    onMouseEnter={() => setHoveredCol(col.key)}
                    onMouseLeave={() => setHoveredCol(null)}
                    style={{
                      ...thStyle,
                      width,
                      minWidth: col.minWidth || 60,
                      cursor: col.sortable !== false ? 'pointer' : 'default',
                      textAlign: col.align || 'right',
                      position: 'sticky',
                      right: 0,
                      zIndex: 2,
                      background: 'var(--dt-bg-header)',
                      borderBottom: resizing === col.key ? '2px solid var(--dt-primary)' : undefined,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: col.align === 'left' ? 'flex-start' : 'flex-end' }}>
                      <span>{col.label}</span>
                      {col.sortable !== false && renderSortIcon(col.key)}
                    </div>
                    {col.resizable !== false && (
                      <div
                        onMouseDown={(e) => handleResizeStart(col.key, e)}
                        style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          [col.align === 'left' ? 'right' : 'left']: 0,
                          width: 4,
                          cursor: 'col-resize',
                          background: hoveredCol === col.key ? 'var(--dt-primary)' : 'transparent',
                          opacity: 0.3,
                        }}
                      />
                    )}
                  </th>
                )
              })}
            </tr>
            <tr style={{ position: 'sticky', top: 32, zIndex: 2, background: 'var(--dt-bg-header)' }}>
              <th style={{ ...thStyle, width: 36, background: 'var(--dt-bg-header)' }} />
              {visibleColumns.map((col) => (
                <th key={`filter-${col.key}`} style={{ ...thStyle, padding: 2, background: 'var(--dt-bg-header)' }}>
                  {col.filterable !== false && (
                    <input
                      value={filters[col.key] || ''}
                      onChange={(e) => setFilters((prev) => ({ ...prev, [col.key]: e.target.value }))}
                      placeholder="تصفية"
                      style={{
                        width: '100%',
                        padding: '2px 4px',
                        border: '1px solid var(--dt-border-light)',
                        borderRadius: 2,
                        fontSize: 10,
                        outline: 'none',
                        background: 'var(--dt-bg)',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={visibleColumns.length + 1} style={{ textAlign: 'center', padding: 40, color: 'var(--dt-text-muted)' }}>
                  جاري التحميل...
                </td>
              </tr>
            ) : pagedRows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + 1} style={{ textAlign: 'center', padding: 40, color: 'var(--dt-text-muted)' }}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pagedRows.map((row, ri) => {
                const id = String(row[keyField])
                const isSelected = selectedRows.has(id)
                return (
                  <tr
                    key={id}
                    onClick={() => onRowClick?.(row)}
                    onDoubleClick={() => onRowDoubleClick?.(row)}
                    onContextMenu={(e) => {
                      if (contextMenuItems) {
                        e.preventDefault()
                        showContextMenu(e.clientX, e.clientY, contextMenuItems(row))
                      }
                    }}
                    style={{
                      background: isSelected
                        ? 'var(--dt-bg-row-selected)'
                        : ri % 2 === 1
                          ? 'var(--dt-bg-row-alt)'
                          : 'transparent',
                      cursor: onRowClick ? 'pointer' : 'default',
                      height: rowHeight,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'var(--dt-bg-row-hover)'
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = ri % 2 === 1 ? 'var(--dt-bg-row-alt)' : 'transparent'
                    }}
                  >
                    <td style={{ ...tdStyle, width: 36, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(id)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    {visibleColumns.map((col) => (
                      <td
                        key={col.key}
                        style={{
                          ...tdStyle,
                          textAlign: col.align || 'right',
                          width: getColWidth(col),
                          userSelect: 'text',
                        }}
                      >
                        {getCellValue(row, col)}
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          borderTop: '1px solid var(--dt-border)',
          background: 'var(--dt-bg-surface)',
          fontSize: 'var(--dt-font-size-xs)',
          flexShrink: 0,
        }}
      >
        <span style={{ color: 'var(--dt-text-secondary)' }}>
          {processedRows.length} سجل
        </span>
        <div style={{ flex: 1 }} />
        <select
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0) }}
          style={{
            padding: '2px 4px',
            border: '1px solid var(--dt-border)',
            borderRadius: 'var(--dt-radius-sm)',
            fontSize: 'var(--dt-font-size-xs)',
            background: 'var(--dt-bg)',
          }}
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => setPage(0)}
            disabled={safePage === 0}
            style={pageBtnStyle}
          >
            ◀◀
          </button>
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            style={pageBtnStyle}
          >
            ◀
          </button>
          <span style={{ padding: '0 8px', color: 'var(--dt-text-secondary)' }}>
            {safePage + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            style={pageBtnStyle}
          >
            ▶
          </button>
          <button
            onClick={() => setPage(totalPages - 1)}
            disabled={safePage >= totalPages - 1}
            style={pageBtnStyle}
          >
            ▶▶
          </button>
        </div>
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 'var(--dt-font-size-xs)',
  fontWeight: 600,
  color: 'var(--dt-text-secondary)',
  borderBottom: '1px solid var(--dt-border)',
  whiteSpace: 'nowrap',
  userSelect: 'none',
  position: 'relative',
}

const tdStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid var(--dt-border-light)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const btnStyle: React.CSSProperties = {
  padding: '3px 8px',
  border: '1px solid var(--dt-border)',
  borderRadius: 'var(--dt-radius-sm)',
  background: 'var(--dt-bg)',
  cursor: 'pointer',
  fontSize: 'var(--dt-font-size-xs)',
  color: 'var(--dt-text-secondary)',
}

const pageBtnStyle: React.CSSProperties = {
  padding: '2px 6px',
  border: '1px solid var(--dt-border)',
  borderRadius: 'var(--dt-radius-sm)',
  background: 'var(--dt-bg-surface)',
  cursor: 'pointer',
  fontSize: 10,
  color: 'var(--dt-text-secondary)',
}
