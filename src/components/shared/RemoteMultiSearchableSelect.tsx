import { useState, useRef, useEffect, useCallback } from 'react'

export interface RemoteMultiSearchableSelectItem {
  id: string
  name: string
  keywords?: string[]
}

interface RemoteMultiSearchableSelectProps {
  /** Currently selected ids (chips). */
  values: string[]
  onChange: (ids: string[]) => void
  /** Server-side option search. Called with '' for the initial page on open. */
  loadOptions: (query: string) => Promise<RemoteMultiSearchableSelectItem[]>
  /** Resolve a single id to its display label (targeted fetch for chips). */
  resolveLabel: (id: string) => Promise<string | null>
  placeholder?: string
  label?: string
  className?: string
  disabled?: boolean
}

/**
 * Async sibling of MultiSearchableSelect for HUGE option sets (the governed
 * product catalog): chips resolve their labels on demand via resolveLabel and
 * the list is fetched server-side per keystroke via loadOptions — never the
 * full catalog.
 */
export function RemoteMultiSearchableSelect({
  values,
  onChange,
  loadOptions,
  resolveLabel,
  placeholder,
  label,
  className = '',
  disabled,
}: RemoteMultiSearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [options, setOptions] = useState<RemoteMultiSearchableSelectItem[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [labelMap, setLabelMap] = useState<Record<string, string | null>>({})
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Lazily resolve chip labels (targeted fetch, cached by id).
  useEffect(() => {
    const missing = values.filter((id) => !(id in labelMap))
    if (missing.length === 0) return
    let cancelled = false
    Promise.all(missing.map(async (id) => {
      try { return { id, label: await resolveLabel(id) } } catch { return { id, label: null } }
    })).then((resolved) => {
      if (cancelled) return
      setLabelMap((prev) => {
        const next = { ...prev }
        for (const r of resolved) next[r.id] = r.label
        return next
      })
    })
    return () => { cancelled = true }
  }, [values, labelMap, resolveLabel])

  // Debounce the local query before hitting the server.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => { setHighlightIndex(-1) }, [debouncedQuery, open])

  // Server option fetch (also fires on open to show the first page).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoadingOptions(true)
    loadOptions(debouncedQuery)
      .then((rows) => { if (!cancelled) setOptions(Array.isArray(rows) ? rows : []) })
      .catch(() => { if (!cancelled) setOptions([]) })
      .finally(() => { if (!cancelled) setLoadingOptions(false) })
    return () => { cancelled = true }
  }, [open, debouncedQuery, loadOptions])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
        setDebouncedQuery('')
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
        setHighlightIndex((prev) => Math.min(prev + 1, options.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightIndex((prev) => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (highlightIndex >= 0 && highlightIndex < options.length) {
          const id = options[highlightIndex].id
          if (values.includes(id)) {
            onChange(values.filter((v) => v !== id))
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
        setDebouncedQuery('')
        break
    }
  }, [open, highlightIndex, options, values, onChange])

  const handleToggle = useCallback((id: string) => {
    if (values.includes(id)) {
      onChange(values.filter((v) => v !== id))
    } else {
      onChange([...values, id])
    }
  }, [values, onChange])

  const handleRemove = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(values.filter((v) => v !== id))
  }, [values, onChange])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label className="block text-[10px] text-text-secondary font-medium mb-1">{label}</label>
      )}
      <button
        type="button"
        onClick={() => { if (!disabled) setOpen((prev) => !prev) }}
        disabled={disabled}
        className="w-full flex items-center justify-between gap-2 text-xs px-2 py-2 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary transition-colors text-right disabled:opacity-50 disabled:cursor-not-allowed min-h-[36px]"
      >
        <div className="flex flex-wrap gap-1 flex-1">
          {values.length === 0 ? (
            <span className="text-text-secondary">{placeholder || 'اختر...'}</span>
          ) : (
            values.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[10px] font-semibold">
                {labelMap[id] ?? '...'}
                <span onClick={(e) => handleRemove(id, e)} className="text-primary/60 hover:text-danger cursor-pointer">&times;</span>
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
            {loadingOptions && (
              <li className="text-xs text-text-secondary text-center py-3">جاري البحث...</li>
            )}
            {!loadingOptions && options.length === 0 && (
              <li className="text-xs text-text-secondary text-center py-3">لا توجد نتائج</li>
            )}
            {!loadingOptions && options.map((item, idx) => {
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