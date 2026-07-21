import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { normalizeArabic } from '../../utils/smartSearch'

export interface SearchableSelectItem {
  id: string
  name: string
}

interface SearchableSelectProps {
  items: SearchableSelectItem[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  resetLabel?: string
  label?: string
  className?: string
  disabled?: boolean
}

export function SearchableSelect({ items, value, onChange, placeholder, resetLabel, label, className = '', disabled }: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selectedItem = useMemo(() => items.find(i => i.id === value), [items, value])

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }, [items])

  const resetItem = useMemo<SearchableSelectItem | null>(() => resetLabel ? { id: '', name: resetLabel } : null, [resetLabel])

  const filteredItems = useMemo(() => {
    const base = resetItem ? [resetItem, ...sortedItems] : sortedItems
    if (!query.trim()) return base
    const q = normalizeArabic(query)
    const filtered = sortedItems.filter(item => {
      const normalizedName = normalizeArabic(item.name)
      return normalizedName.includes(q)
    })
    return resetItem ? [resetItem, ...filtered] : filtered
  }, [sortedItems, query, resetItem])

  useEffect(() => {
    setHighlightIndex(-1)
  }, [query])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus()
    }
  }, [open])

  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIndex] as HTMLElement
      if (el) el.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIndex])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightIndex(prev => Math.min(prev + 1, filteredItems.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (highlightIndex >= 0 && highlightIndex < filteredItems.length) {
          onChange(filteredItems[highlightIndex].id)
          setOpen(false)
          setQuery('')
        }
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        setQuery('')
        break
    }
  }, [open, highlightIndex, filteredItems, onChange])

  const handleSelect = useCallback((id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }, [onChange])

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onChange('')
    setQuery('')
  }, [onChange])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-[10px] text-text-secondary font-medium mb-1">{label}</label>
      )}
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen(prev => !prev) }}
        disabled={disabled}
        className="w-full flex items-center justify-between gap-2 text-xs px-2 py-2 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary transition-colors text-right disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className={selectedItem ? 'text-text' : 'text-text-secondary'}>
          {selectedItem ? selectedItem.name : (placeholder || 'اختر...')}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {selectedItem && (
            <span onClick={handleClear} className="text-text-secondary hover:text-danger text-[10px] px-1 cursor-pointer">&times;</span>
          )}
          <svg className={`w-3 h-3 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-border rounded-lg shadow-lg overflow-hidden">
          <div className="p-1.5 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="اكتب للبحث..."
              className="w-full text-xs px-2 py-1.5 rounded-md border border-border focus:outline-none focus:border-primary"
            />
          </div>
          <ul ref={listRef} className="max-h-48 overflow-y-auto">
            {filteredItems.length === 0 && (
              <li className="text-xs text-text-secondary text-center py-3">لا توجد نتائج</li>
            )}
            {filteredItems.map((item, idx) => (
              <li
                key={item.id}
                onClick={() => handleSelect(item.id)}
                onMouseEnter={() => setHighlightIndex(idx)}
                className={`text-xs px-3 py-2 cursor-pointer transition-colors ${
                  item.id === value
                    ? 'bg-primary/10 text-primary font-semibold'
                    : idx === highlightIndex
                      ? 'bg-surface'
                      : 'hover:bg-surface'
                }`}
              >
                {item.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
