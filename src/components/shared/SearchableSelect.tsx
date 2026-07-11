import { useState, useRef, useEffect } from 'react'

interface Option {
  value: string
  label: string
}

interface Props {
  options: Option[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
  disabled?: boolean
}

export function SearchableSelect({ options, value, onChange, placeholder = 'اختر...', label, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = options.find(o => o.value === value)

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    if (open) { setSearch(''); setHighlighted(0); inputRef.current?.focus() }
  }, [open])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' && filtered[highlighted]) { onChange(filtered[highlighted].value); setOpen(false) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      {label && <label className="block text-xs font-semibold text-text mb-1">{label}</label>}
      <div
        onClick={() => { if (!disabled) setOpen(o => !o) }}
        className={`w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white text-text flex items-center justify-between cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className={selected ? '' : 'text-text-secondary'}>{selected ? selected.label : placeholder}</span>
        <svg className={`w-4 h-4 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-border rounded-lg shadow-lg max-h-60 flex flex-col">
          <div className="p-1.5 border-b border-border/50">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setHighlighted(0) }}
              onKeyDown={handleKeyDown}
              placeholder="بحث..."
              className="w-full border border-border rounded-md px-2 py-1.5 text-xs bg-surface text-text placeholder:text-text-secondary outline-none"
              dir="rtl"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-xs text-text-secondary text-center py-4">لا توجد نتائج</div>
            ) : (
              filtered.map((o, i) => (
                <div
                  key={o.value}
                  onClick={() => { onChange(o.value); setOpen(false) }}
                  className={`px-3 py-2 text-xs cursor-pointer transition-colors ${
                    o.value === value ? 'bg-primary/10 text-primary font-semibold' : 'text-text hover:bg-surface'
                  } ${i === highlighted && o.value !== value ? 'bg-surface' : ''}`}
                >
                  {o.label}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
