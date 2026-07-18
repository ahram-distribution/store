import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { normalizeEmployeeRole, type TargetRole } from '../../utils/roleNormalization'
import { formatDateTime } from '../../utils/format'
import { isProductSaleable } from '../../services/products'

const ALLOWED_ROLES: TargetRole[] = ['الإدارة العليا', 'مدير بيع', 'مندوب مبيعات']

interface ProductRow {
  id: string
  product_name: string
  legacy_code: string
  company_id: string
  company_name: string
  is_active: boolean
  is_visible: boolean
  is_out_of_stock: boolean
  carton_price: number
  carton_quantity: number
  product_units: { id: string; unit_type: string; is_active: boolean }[]
}

interface CompanyGroup {
  companyName: string
  products: ProductRow[]
}

interface UnitPriceInfo {
  unitType: string
  price: number
}

function formatPrice(val: number): string {
  if (!Number.isFinite(val)) return '0'
  const s = new Intl.NumberFormat('en-US', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val)
  const dot = s.indexOf('.')
  if (dot === -1) return s
  const decimals = s.slice(dot + 1)
  const stripped = decimals.replace(/0+$/, '')
  return stripped ? s.slice(0, dot + 1) + stripped : s.slice(0, dot)
}

function computeUnitPrices(p: ProductRow): UnitPriceInfo[] {
  const cartonPrice = Number(p.carton_price) || 0
  const cartonQuantity = Number(p.carton_quantity) || 0
  const activeUnitTypes = (p.product_units || []).filter((u) => u.is_active !== false).map((u) => u.unit_type)
  const hasCarton = activeUnitTypes.includes('carton')
  const rawPrices: UnitPriceInfo[] = []

  if (hasCarton) {
    if (cartonPrice > 0) {
      if (cartonQuantity >= 24) {
        rawPrices.push({ unitType: 'dozen', price: (cartonPrice / cartonQuantity) * 12 })
      }
      rawPrices.push({ unitType: 'carton', price: cartonPrice })
    }
  } else {
    const piecePrice = cartonPrice > 0 && cartonQuantity > 0 ? cartonPrice / cartonQuantity : 0
    if (piecePrice > 0) {
      rawPrices.push({ unitType: 'piece', price: piecePrice })
      rawPrices.push({ unitType: 'dozen', price: piecePrice * 12 })
    }
  }

  return rawPrices.filter((up) => activeUnitTypes.includes(up.unitType))
}

function esc(s: string | null | undefined): string {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightText(text: string, query: string): string {
  if (!query.trim()) return esc(text)
  const terms = query.trim().split(/\s+/).filter(Boolean)
  let result = esc(text)
  for (const term of terms) {
    const re = new RegExp(`(${escapeRegex(term)})`, 'gi')
    result = result.replace(re, '<mark class="bg-yellow-200 rounded px-0.5">$1</mark>')
  }
  return result
}

function generatePrintHtml(groups: CompanyGroup[], logoUrl: string): string {
  const now = new Date()

  function productRow(p: ProductRow, bgColor: string): string {
    const unitPrices = computeUnitPrices(p)
    const code = esc(p.legacy_code || '---')
    const name = esc(p.product_name)
    const cellStyle = `border:1px solid #e2e8f0;padding:4px 3px;text-align:center;vertical-align:middle;background:${bgColor}`
    return `<tr>
      <td style="width:7%;${cellStyle};font-family:monospace;direction:ltr;font-size:10px;color:#475569">${code}</td>
      <td style="width:40%;${cellStyle};text-align:right;padding:4px 6px;font-size:11px;line-height:1.5;color:#111827">${name}</td>
      <td style="width:18%;${cellStyle}">${unitPrices.find((u) => u.unitType === 'piece') ? `<div style="display:flex;justify-content:space-between;direction:rtl"><span style="font-size:9px;color:#6b7280">قطعة</span><span style="font-size:10px;font-weight:700;color:#111827">${formatPrice(unitPrices.find((u) => u.unitType === 'piece')!.price)}</span></div>` : '<div style="color:#d1d5db;font-size:9px">&mdash;</div>'}</td>
      <td style="width:18%;${cellStyle}">${unitPrices.find((u) => u.unitType === 'dozen') ? `<div style="display:flex;justify-content:space-between;direction:rtl"><span style="font-size:9px;color:#6b7280">دستة</span><span style="font-size:10px;font-weight:700;color:#111827">${formatPrice(unitPrices.find((u) => u.unitType === 'dozen')!.price)}</span></div>` : '<div style="color:#d1d5db;font-size:9px">&mdash;</div>'}</td>
      <td style="width:17%;${cellStyle}">${unitPrices.find((u) => u.unitType === 'carton') ? `<div style="display:flex;justify-content:space-between;direction:rtl"><span style="font-size:9px;color:#6b7280">كرتونة</span><span style="font-size:10px;font-weight:700;color:#111827">${formatPrice(unitPrices.find((u) => u.unitType === 'carton')!.price)}</span></div>` : '<div style="color:#d1d5db;font-size:9px">&mdash;</div>'}</td>
    </tr>`
  }

  function groupSection(g: CompanyGroup, idx: number): string {
    const bgColor = idx % 2 === 0 ? '#f8fafc' : '#f7faff'
    const header = `<tr><td colspan="5" style="background:${bgColor};border-bottom:1px solid #e2e8f0;padding:5px 10px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;border-top:none"><div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:6px;height:6px;border-radius:1px;background:rgba(0,82,204,0.6)"></span><span style="font-weight:700;color:#111827;font-size:11px">${esc(g.companyName)}</span><span style="font-weight:400;color:#6b7280;font-size:9px">${g.products.length} منتج</span></div></td></tr>`
    const body = g.products.map((p) => productRow(p, bgColor)).join('')
    return header + body
  }

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>قائمة أسعار البيع</title>
<style>
  @page { size: A4; margin: 12mm 10mm }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 10px; color: #111827; line-height: 1.5; padding: 0; }
  .top-bar { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 10px; }
  .brand { font-size: 13px; font-weight: 700; color: #003366; }
  .contact { font-size: 8px; color: #6b7280; }
  .logo { height: 40px; object-fit: contain; }
  .doc-title { font-size: 18px; font-weight: 700; color: #003366; text-align: left; }
  .doc-date { font-size: 8px; color: #9ca3af; text-align: left; margin-top: 2px; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-bottom: 6px; }
  thead tr { background: #003366; color: #fff; }
  th { width: 7%; padding: 4px 3px; text-align: center; font-weight: 600; font-size: 10px; border: 1px solid #003366; }
  th:nth-child(2) { width: 40%; }
  th:nth-child(3) { width: 18%; }
  th:nth-child(4) { width: 18%; }
  th:nth-child(5) { width: 17%; }
  thead { display: table-header-group; }
  tbody { display: table-row-group; }
  tbody tr { page-break-inside: avoid; }
  .footer { text-align: center; font-size: 7px; color: #d1d5db; border-top: 1px solid #f3f4f6; padding-top: 4px; margin-top: 6px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="top-bar">
  <div style="flex:2;text-align:right">
    <div class="brand">شركة الأهرام للتجارة والتوزيع</div>
    <div class="contact">كورنيش النيل - الوراق - جيزة | تليفون: 01040880002</div>
  </div>
  <div style="flex:3;text-align:center">
    <img src="${esc(logoUrl)}" alt="الأهرام" class="logo" />
  </div>
  <div style="flex:2">
    <div class="doc-title">قائمة أسعار البيع</div>
    <div class="doc-date">تاريخ الطباعة: ${formatDateTime(now)}</div>
  </div>
</div>
<table>
  <thead>
    <tr>
      <th>الكود</th>
      <th>اسم الصنف</th>
      <th>القطعة</th>
      <th>الدستة</th>
      <th>الكرتونة</th>
    </tr>
  </thead>
  <tbody>
    ${groups.map((g, i) => groupSection(g, i)).join('')}
  </tbody>
</table>
<div class="footer">شركة الأهرام للتجارة والتوزيع — جميع الحقوق محفوظة</div>
</body>
</html>`
}

function printHtml(html: string): void {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => { try { win.print() } catch {} }, 500)
}

export default function SalesListPage() {
  const navigate = useNavigate()
  const { token: authToken, user } = useAuthStore()
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfPhase, setPdfPhase] = useState<'idle' | 'preparing' | 'done'>('idle')

  const userRoles = user?.roles || []
  const normalizedRoles = userRoles.map(normalizeEmployeeRole)
  const hasAccess = ALLOWED_ROLES.some((r) => normalizedRoles.includes(r))

  useEffect(() => {
    if (!hasAccess) return
    if (!authToken) { setLoading(false); return }
    setLoading(true)
    supabase.rpc('get_governed_products', { p_token: authToken })
      .then(({ data }) => {
        const arr = Array.isArray(data) ? data : []
        setProducts(arr)
      })
      .finally(() => setLoading(false))
  }, [hasAccess, authToken])

  const saleableProducts = useMemo(() => products.filter(isProductSaleable), [products])

  const companyNames = useMemo(() => {
    const names = new Set<string>()
    for (const p of saleableProducts) {
      if (p.company_name) names.add(p.company_name)
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [saleableProducts])

  const smartFiltered = useMemo(() => {
    let list = saleableProducts
    if (companyFilter) {
      list = list.filter((p) => p.company_name === companyFilter)
    }
    if (search.trim()) {
      const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
      list = list.filter((p) => {
        const name = p.product_name.toLowerCase()
        const code = (p.legacy_code || '').toLowerCase()
        const company = (p.company_name || '').toLowerCase()
        return terms.every((t) => name.includes(t) || code.includes(t) || company.includes(t))
      })
    }
    return list
  }, [saleableProducts, search, companyFilter])

  const groupedProducts = useMemo((): CompanyGroup[] => {
    const map: Record<string, ProductRow[]> = {}
    for (const p of smartFiltered) {
      const key = p.company_name || 'غير مصنف'
      if (!map[key]) map[key] = []
      map[key].push(p)
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.product_name.localeCompare(b.product_name))
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([companyName, prods]) => ({ companyName, products: prods }))
  }, [smartFiltered])

  const handleDownloadPdf = useCallback(() => {
    if (pdfLoading) return
    setPdfLoading(true)
    setPdfPhase('preparing')
    try {
      const logoUrl = window.location.origin + '/store/branding/ahram-logo.png'
      const html = generatePrintHtml(groupedProducts, logoUrl)
      printHtml(html)
      setPdfPhase('done')
    } finally {
      setPdfLoading(false)
      setPdfPhase('idle')
    }
  }, [pdfLoading, groupedProducts])

  if (!hasAccess) {
    return (
      <div className="text-center py-12 text-text-secondary text-sm">
        ليس لديك صلاحية الوصول لهذه الشاشة
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="bg-card border-b border-border px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="text-text-muted hover:text-text text-lg transition-colors">&larr;</button>
            <h1 className="text-lg font-bold text-text leading-tight">قائمة أسعار البيع</h1>
          </div>
          <button
            onClick={handleDownloadPdf}
            disabled={pdfLoading || smartFiltered.length === 0}
            className="flex items-center gap-2 bg-primary hover:bg-primary-dark disabled:bg-text-muted text-white text-xs px-4 py-2 rounded-lg font-semibold transition-colors shadow-sm"
          >
            {pdfLoading ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {pdfPhase === 'preparing' ? 'جارى تجهيز قائمة الأسعار...' : 'تم إنشاء الملف... جارى التحميل...'}
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                تحميل PDF
              </>
            )}
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-3">
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث باسم الصنف، الكود، اسم الشركة..."
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card pr-8 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-shadow"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-sm">&#x1F50D;</span>
          </div>
          {companyNames.length > 1 && (
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              className="border border-border rounded-lg px-2 py-2 text-sm bg-card shrink-0 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">كل الشركات</option>
              {companyNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          )}
        </div>

        {loading ? (
          <div className="text-center py-16 text-text-muted text-sm">جاري تحميل المنتجات...</div>
        ) : smartFiltered.length === 0 ? (
          <div className="text-center py-16 text-text-muted text-sm">
            {search || companyFilter ? 'لا توجد نتائج مطابقة للبحث' : 'لا توجد منتجات متاحة للبيع'}
          </div>
        ) : (
          <div className="bg-card rounded-lg border border-border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface border-b border-border">
                  <th className="w-[7%] px-2 py-2 text-center text-[10px] font-semibold text-text-secondary uppercase tracking-wider">الكود</th>
                  <th className="w-[40%] px-3 py-2 text-right text-[10px] font-semibold text-text-secondary uppercase tracking-wider">اسم الصنف</th>
                  <th className="w-[18%] px-2 py-2 text-center text-[10px] font-semibold text-text-secondary uppercase tracking-wider">القطعة</th>
                  <th className="w-[18%] px-2 py-2 text-center text-[10px] font-semibold text-text-secondary uppercase tracking-wider">الدستة</th>
                  <th className="w-[17%] px-2 py-2 text-center text-[10px] font-semibold text-text-secondary uppercase tracking-wider">الكرتونة</th>
                </tr>
              </thead>
              <tbody>
                {groupedProducts.map((group, groupIdx) => (
                  <Fragment key={group.companyName}>
                    <tr>
                      <td colSpan={5} className={`px-3 py-1.5 border-y border-border ${groupIdx % 2 === 0 ? 'bg-[#f8fafc]' : 'bg-[#f7faff]'}`}>
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-sm bg-primary/60" />
                          <span className="text-xs font-bold text-text">{group.companyName}</span>
                          <span className="text-[10px] text-text-muted font-normal">{group.products.length} منتج</span>
                        </div>
                      </td>
                    </tr>
                    {group.products.map((p) => {
                      const unitPrices = computeUnitPrices(p)
                      const priceByType = Object.fromEntries(unitPrices.map((up) => [up.unitType, up.price]))
                      const rowBg = groupIdx % 2 === 0 ? 'bg-[#f8fafc]' : 'bg-[#f7faff]'
                      return (
                        <tr key={p.id} className={`border-b border-border/50 ${rowBg}`}>
                          <td className="px-2 py-1.5 text-center font-mono text-[10px] text-text-muted ltr align-middle">
                            {p.legacy_code || '---'}
                          </td>
                          <td className="px-3 py-1.5 text-right text-xs text-text align-middle" dangerouslySetInnerHTML={{ __html: highlightText(p.product_name, search) }} />
                          <td className="px-2 py-1.5 text-center align-middle">
                            {priceByType.piece != null ? (
                              <span className="text-xs font-bold text-text">{formatPrice(priceByType.piece)}</span>
                            ) : (
                              <span className="text-text-muted text-[10px]">&mdash;</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center align-middle">
                            {priceByType.dozen != null ? (
                              <span className="text-xs font-bold text-text">{formatPrice(priceByType.dozen)}</span>
                            ) : (
                              <span className="text-text-muted text-[10px]">&mdash;</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center align-middle">
                            {priceByType.carton != null ? (
                              <span className="text-xs font-bold text-text">{formatPrice(priceByType.carton)}</span>
                            ) : (
                              <span className="text-text-muted text-[10px]">&mdash;</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
