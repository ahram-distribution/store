import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort } from '../../utils/format'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface SearchResult {
  type: 'product' | 'customer' | 'order' | 'employee'
  id: string
  label: string
  sublabel: string
  meta: string
  companyId?: string
}

const typeColors: Record<string, string> = {
  product: '#9333ea', customer: '#16a34a',
  order: '#0052cc', employee: '#0891b2',
}

const typeLabels: Record<string, string> = {
  product: 'منتج', customer: 'عميل',
  order: 'طلب', employee: 'مندوب',
}

async function searchProducts(token: string, query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('unified_search', {
    p_token: token,
    p_entity: 'products',
    p_query: query,
    p_filters: { visible_only: true },
    p_page: 1,
    p_per_page: 5,
  })
  if (error || !data?.data) return []
  return (data.data as any[]).map((p: any) => ({
    type: 'product' as const,
    id: p.id,
    label: p.product_name || '',
    sublabel: p.company_name || '',
    meta: p.is_out_of_stock ? 'نفذ من المخزون' : (p.carton_price ? formatCurrencyShort(p.carton_price) : ''),
    companyId: p.company_id,
  }))
}

async function searchCustomers(token: string, query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('get_governed_customers', {
    p_token: token,
    p_search: query,
  })
  if (error) return []
  const arr = Array.isArray(data) ? data : []
  return arr.slice(0, 5).map((c: any) => ({
    type: 'customer' as const,
    id: c.id,
    label: c.company_name || '',
    sublabel: c.code || '',
    meta: c.phone || '',
  }))
}

async function searchOrders(token: string, query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('unified_search', {
    p_token: token,
    p_entity: 'orders',
    p_query: query,
    p_filters: {},
    p_page: 1,
    p_per_page: 5,
  })
  if (error || !data?.data) return []
  return (data.data as any[]).map((o: any) => ({
    type: 'order' as const,
    id: o.id,
    label: o.order_number || '',
    sublabel: o.customer_name || '',
    meta: [o.status || '', o.total_amount ? formatCurrencyShort(o.total_amount) : ''].filter(Boolean).join(' | '),
  }))
}

async function searchEmployees(token: string, query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('unified_search', {
    p_token: token,
    p_entity: 'employees',
    p_query: query,
    p_filters: { is_active: true },
    p_page: 1,
    p_per_page: 5,
  })
  if (error || !data?.data) return []
  return (data.data as any[]).map((e: any) => ({
    type: 'employee' as const,
    id: e.id,
    label: e.full_name || '',
    sublabel: e.code || '',
    meta: '',
  }))
}

const navPaths: Record<string, string> = {
  customer: '/customers/',
  order: '/orders/',
  employee: '/employees/',
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
      const [products, customers, orders, employees] = await Promise.all([
        searchProducts(token, q),
        searchCustomers(token, q),
        searchOrders(token, q),
        searchEmployees(token, q),
      ])
      setResults([...products, ...customers, ...orders, ...employees])
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
    if (r.type === 'product' && r.companyId) {
      navigate(`/storefront/products?companyId=${r.companyId}&highlight=${r.id}`)
    } else {
      const base = navPaths[r.type]
      if (base) navigate(base + r.id)
    }
  }

  const isEmpty = results.length === 0 && !searching && query.trim().length > 0

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
        <div ref={panelRef} className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-xl shadow-lg z-[999] max-h-80 overflow-y-auto min-w-[260px]">
          {results.map((r, i) => (
            <button key={`${r.type}-${r.id || i}`} onClick={() => handleSelect(r)}
              className="w-full text-right px-3 py-2 hover:bg-surface active:bg-surface/70 transition-colors border-b border-border last:border-0"
            >
              <div className="flex items-start gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded text-white font-semibold shrink-0 mt-0.5" style={{ background: typeColors[r.type] }}>
                  {typeLabels[r.type]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-text truncate leading-snug">{r.label}</div>
                  {r.sublabel && <div className="text-[10px] text-text-secondary truncate leading-snug mt-0.5">{r.sublabel}</div>}
                  {r.meta && <div className="text-[9px] text-text-muted truncate leading-snug mt-0.5">{r.meta}</div>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && isEmpty && (
        <div ref={panelRef} className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-xl shadow-lg z-[999] min-w-[260px]">
          <div className="px-3 py-4 text-center text-[11px] text-text-secondary">لا توجد نتائج</div>
        </div>
      )}
    </div>
  )
}
