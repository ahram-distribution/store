import { useState, useRef, useEffect, useCallback, useMemo } from 'react'

export interface RemoteSearchableSelectItem {
  id: string
  name: string
  keywords?: string[]
}

interface RemoteSearchableSelectProps {
  /** Currently selected id ('' = none). */
  value: string
  onChange: (id: string) => void
  /** Server-side option search. Called with '' for the initial page on open. */
  loadOptions: (query: string) => Promise<RemoteSearchableSelectItem[]>
  /** Resolve a single id to its display label (targeted fetch). */
  resolveLabel: (id: string) => Promise<string | null>
  placeholder?: string
  resetLabel?: string
  label?: string
  className?: string
  disabled?: boolean
}

/**
 * Single-value async sibling of RemoteMultiSearchableSelect for HUGE option
 * sets (governed customers): the selected option resolves its label via
 * resolveLabel and the list is fetched server-side per keystroke via
 * loadOptions — never the full list.
 */
export function RemoteSearchableSelect({
  value,
  onChange,
  loadOptions,
  resolveLabel,
  placeholder,
  resetLabel,
  label,
  className = '',
  disabled,
}: RemoteSearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [options, setOptions] = useState<RemoteSearchableSelectItem[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selectedItem = useMemo(() => options.find((o) => o.id === value), [options, value])

  // Lazily resolve the selected label (targeted fetch, cached).
  useEffect(() => {
    if (!value) { setSelectedLabel(null); return }
    let cancelled = false
    resolveLabel(value)
      .then((label) => { if (!cancelled) setSelectedLabel(label) })
      .catch(() => { if (!cancelled) setSelectedLabel(null) })
    return () => { cancelled = true }
  }, [value, resolveLabel])

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

  const commit = useCallback((id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
    setDebouncedQuery('')
  }, [onChange])

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
          commit(options[highlightIndex].id)
        }
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        setQuery('')
        setDebouncedQuery('')
        break
    }
  }, [open, highlightIndex, options, commit])

  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    commit('')
  }, [commit])

  const displayName = selectedItem?.name ? selectedItem.name : (selectedLabel ?? '')
  const displayValue = value ? displayName : ''
  const useIndex = (idx: number) => (highlightIndex === -1 ? undefined : highlightIndex)

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
        <span className={value ? 'text-text' : 'text-text-secondary'}>
          {value ? displayValue : (placeholder || 'اختر...')}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {value && (
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
            {loadingOptions && (
              <li className="text-xs text-text-secondary text-center py-3">جاري البحث...</li>
            )}
            {!loadingOptions && options.length === 0 && (
              <li className="text-xs text-text-secondary text-center py-3">لا توجد نتائج</li>
            )}
            {!loadingOptions && options.map((item, idx) => (
              <li
                key={item.id}
                onClick={() => commit(item.id)}
                onMouseEnter={() => setHighlightIndex(idx)}
                className={`text-xs px-3 py-2 cursor-pointer transition-colors ${
                  item.id === value
                    ? 'bg-primary/10 text-primary font-semibold'
                    : idx === useIndex(idx)
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