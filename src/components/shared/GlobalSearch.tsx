import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface SearchResult {
  type: 'order' | 'customer' | 'product' | 'company' | 'collection' | 'visit'
  label: string
  sublabel: string
  path: string
}

const typeColors: Record<string, string> = {
  order: '#0052cc', customer: '#16a34a', product: '#9333ea',
  company: '#0891b2', collection: '#f59e0b', visit: '#dc2626',
}

const typeLabels: Record<string, string> = {
  order: 'طلب', customer: 'عميل', product: 'منتج',
  company: 'شركة', collection: 'تحصيل', visit: 'زيارة',
}

export function GlobalSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const token = getToken()
    if (!token) return
    const q = query.trim()
    setSearching(true)
    const timer = setTimeout(async () => {
      const out: SearchResult[] = []
      const ql = q.toLowerCase()

      const [custRes, prodRes, globalRes] = await Promise.all([
        supabase.rpc('get_governed_customers', { p_token: token }).then(r => {
          if (!r.data || !Array.isArray(r.data)) return { data: [] }
          return { data: (r.data as any[]).filter((c: any) =>
            (c.company_name || '').toLowerCase().includes(ql) ||
            (c.customer_name || '').toLowerCase().includes(ql) ||
            (c.phone || '').toLowerCase().includes(ql)
          ).slice(0, 5) }
        }).catch(() => ({ data: [] })),
        supabase.rpc('get_governed_products', { p_token: token, p_search: q, p_visible_only: true }).then(r => ({ data: Array.isArray(r.data) ? r.data.slice(0, 5) : [] })).catch(() => ({ data: [] })),
        supabase.rpc('governed_global_search', { p_token: token, p_query: q }).then(r => ({ data: Array.isArray(r.data) ? r.data : [] })).catch(() => ({ data: [] })),
      ])

      for (const c of (custRes.data || []) as any[]) out.push({ type: 'customer', label: c.company_name || c.customer_name || '', sublabel: c.phone || '', path: `/customers/${c.id}` })
      for (const p of (prodRes.data || []) as any[]) out.push({ type: 'product', label: p.product_name, sublabel: p.legacy_code || '', path: `/products/manage` })
      for (const r of (globalRes.data || []) as any[]) out.push({ type: r.type, label: r.label, sublabel: r.sublabel, path: r.path })

      setResults(out)
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node) && inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const handleSelect = (r: SearchResult) => {
    setQuery('')
    setResults([])
    setOpen(false)
    navigate(r.path)
  }

  return (
    <div className="relative">
      <div className="relative">
        <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { if (results.length || query.trim()) setOpen(true) }}
          placeholder="بحث..."
          className="w-28 md:w-40 text-xs bg-surface text-text border border-border rounded-full pl-2 pr-7 py-1.5 focus:outline-none focus:border-primary transition-colors"
        />
        {searching && (
          <div className="absolute left-2 top-1/2 -translate-y-1/2">
            <div className="w-3 h-3 border border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        )}
      </div>

      {open && results.length > 0 && (
        <div ref={panelRef} className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-xl shadow-lg z-[999] max-h-72 overflow-y-auto min-w-[220px]">
          {results.map((r, i) => (
            <button key={`${r.type}-${i}`} onClick={() => handleSelect(r)}
              className="w-full text-right px-3 py-2 hover:bg-surface active:bg-surface/70 transition-colors border-b border-border last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded text-white font-semibold shrink-0" style={{ background: typeColors[r.type] }}>
                  {typeLabels[r.type]}
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-text truncate">{r.label}</div>
                  <div className="text-[10px] text-text-secondary truncate">{r.sublabel}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
