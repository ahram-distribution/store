import { useEffect, useMemo, useRef, useState } from 'react'

export interface MultiSelectFilterOption {
  value: string
  label: string
}

interface MultiSelectFilterProps {
  allLabel: string
  options: MultiSelectFilterOption[]
  selected: string[]
  onChange: (next: string[]) => void
  searchPlaceholder?: string
  className?: string
}

export function MultiSelectFilter({ allLabel, options, selected, onChange, searchPlaceholder = 'بحث بالاسم...', className = '' }: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  const allSelected = options.length > 0 && options.every((o) => selected.includes(o.value))

  const handleSelectAll = () => {
    if (!options.length) return
    if (allSelected) {
      const keep = new Set(options.map((o) => o.value))
      onChange(selected.filter((v) => !keep.has(v)))
    } else {
      onChange(Array.from(new Set([...selected, ...options.map((o) => o.value)])))
    }
  }

  return (
    <div ref={rootRef} className={'relative min-w-0 ' + className}>
      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev)
          if (!open) setTimeout(() => searchRef.current?.focus(), 10)
        }}
        className={'w-full flex items-center justify-between gap-1.5 border border-border rounded-lg px-2 py-1.5 text-xs bg-white ' + (open ? 'border-primary/60' : '')}
        aria-expanded={open}
      >
        <span className={'truncate ' + (selected.length ? 'font-semibold text-text' : 'text-text-secondary')}>
          {selected.length ? `${selected.length} محدد` : allLabel}
        </span>
        <svg className={'w-3.5 h-3.5 shrink-0 text-text-muted transition-transform ' + (open ? 'rotate-180' : '')} viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="p-1.5 border-b border-border/60">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full border border-border rounded-md px-2 py-1 text-[11px] bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 && <div className="px-3 py-2 text-[11px] text-text-muted">لا توجد نتائج</div>}
            {filtered.map((o) => {
              const checked = selected.includes(o.value)
              return (
                <label key={o.value} className="flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-neutral-50">
                  <input type="checkbox" checked={checked} onChange={() => toggle(o.value)} className="w-3.5 h-3.5 accent-[#0052cc]" />
                  <span className={'truncate ' + (checked ? 'font-semibold text-text' : 'text-text')}>{o.label}</span>
                </label>
              )
            })}
          </div>
          {options.length > 0 && (
            <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-border/60">
              <button type="button" onClick={handleSelectAll} className="text-[11px] font-semibold text-primary">
                {allSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
              </button>
              {selected.length > 0 && (
                <button type="button" onClick={() => onChange([])} className="text-[11px] font-semibold text-red-500">
                  مسح التحديد
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default MultiSelectFilter