import { memo, useState } from 'react'
import SahlDateFilter from './SahlDateFilter'
import type { SahlDateFilterState } from './SahlDateFilter'

export interface SahlToolbarProps {
  title: string
  subtitle?: string
  dateFilter: SahlDateFilterState
  onDateFilterChange: (v: SahlDateFilterState) => void
  searchValue: string
  onSearchChange: (v: string) => void
  searchPlaceholder?: string
  onExportExcel?: () => void
  onPrint?: () => void
  onAdd?: () => void
  addLabel?: string
  onRefresh?: () => void
  extra?: React.ReactNode
}

export default memo(function SahlToolbar({
  title, subtitle, dateFilter, onDateFilterChange, searchValue, onSearchChange,
  searchPlaceholder, onExportExcel, onPrint, onAdd, addLabel, onRefresh, extra,
}: SahlToolbarProps) {
  return (
    <div className="space-y-2.5">
      {/* Title row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-lg font-bold text-text">{title}</h1>
            {subtitle && <p className="text-[10px] text-text-secondary">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {extra}
          {onRefresh && (
            <button onClick={onRefresh} className="text-[10px] text-primary border border-border rounded px-2 py-1">تحديث</button>
          )}
          {onExportExcel && (
            <button onClick={onExportExcel} title="تصدير Excel"
              className="text-[10px] px-2.5 py-1.5 rounded-lg border border-border text-text-secondary hover:bg-success/10 hover:text-success hover:border-success/40 font-semibold transition-colors">
              📊 Excel
            </button>
          )}
          {onPrint && (
            <button onClick={onPrint} title="طباعة"
              className="text-[10px] px-2.5 py-1.5 rounded-lg border border-border text-text-secondary hover:bg-primary/10 hover:text-primary hover:border-primary/40 font-semibold transition-colors">
              🖨 طباعة
            </button>
          )}
          {onAdd && (
            <button onClick={onAdd}
              className="text-[10px] px-3 py-1.5 rounded-lg bg-primary text-white font-semibold">
              + {addLabel || 'إضافة'}
            </button>
          )}
        </div>
      </div>

      {/* Date filter + Search */}
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <SahlDateFilter value={dateFilter} onChange={onDateFilterChange} />
        </div>
        {searchPlaceholder !== undefined && (
          <input type="text" value={searchValue} onChange={e => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-[220px] shrink-0 text-xs px-3 py-2 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary transition-colors" />
        )}
      </div>
    </div>
  )
})
