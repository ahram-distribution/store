import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { normalizeArabic } from '../../utils/smartSearch'

export interface MultiSearchableSelectItem {
  id: string
  name: string
  keywords?: string[]
}

interface MultiSearchableSelectProps {
  items: MultiSearchableSelectItem[]
  values: string[]
  onChange: (ids: string[]) => void
  placeholder?: string
  label?: string
  className?: string
  disabled?: boolean
}

export function MultiSearchableSelect({ items, values, onChange, placeholder, label, className = '', disabled }: MultiSearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selectedItems = useMemo(() => items.filter(i => values.includes(i.id)), [items, values])

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }, [items])

  const filteredItems = useMemo(() => {
    if (!query.trim()) return sortedItems
    const q = normalizeArabic(query)
    return sortedItems.filter(item => {
      const normalizedName = normalizeArabic(item.name)
      if (normalizedName.includes(q)) return true
      const keys = item.keywords || []
      return keys.some(k => normalizeArabic(k).includes(q))
    })
  }, [sortedItems, query])

  useEffect(() => { setHighlightIndex(-1) }, [query])

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
    if (open && inputRef.current) inputRef.current.focus()
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
          const id = filteredItems[highlightIndex].id
          if (values.includes(id)) {
            onChange(values.filter(v => v !== id))
          } else {
            onChange([...values, id])
          }
          setQuery('')
        }
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        setQuery('')
        break
    }
  }, [open, highlightIndex, filteredItems, values, onChange])

  const handleToggle = useCallback((id: string) => {
    if (values.includes(id)) {
      onChange(values.filter(v => v !== id))
    } else {
      onChange([...values, id])
    }
  }, [values, onChange])

  const handleRemove = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(values.filter(v => v !== id))
  }, [values, onChange])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-[10px] text-text-secondary font-medium mb-1">{label}</label>
      )}
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen(prev => !prev) }}
        disabled={disabled}
        className="w-full flex items-center justify-between gap-2 text-xs px-2 py-2 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary transition-colors text-right disabled:opacity-50 disabled:cursor-not-allowed min-h-[36px]"
      >
        <div className="flex flex-wrap gap-1 flex-1">
          {selectedItems.length === 0 ? (
            <span className="text-text-secondary">{placeholder || 'اختر...'}</span>
          ) : (
            selectedItems.map(item => (
              <span key={item.id} className="inline-flex items-center gap-1 bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px] font-semibold">
                {item.name}
                <span onClick={(e) => handleRemove(item.id, e)} className="text-primary/60 hover:text-danger cursor-pointer">&times;</span>
              </span>
            ))
          )}
        </div>
        <svg className={`w-3 h-3 text-text-secondary transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
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
            {filteredItems.map((item, idx) => {
              const isSelected = values.includes(item.id)
              return (
                <li
                  key={item.id}
                  onClick={() => handleToggle(item.id)}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  className={`text-xs px-3 py-2 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-primary/10 text-primary font-semibold'
                      : idx === highlightIndex
                        ? 'bg-surface'
                        : 'hover:bg-surface'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-3.5 h-3.5 border rounded flex items-center justify-center shrink-0 ${isSelected ? 'bg-primary border-primary' : 'border-border'}`}>
                      {isSelected && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span>{item.name}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
