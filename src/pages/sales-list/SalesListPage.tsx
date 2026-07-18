import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { normalizeEmployeeRole, type TargetRole } from '../../utils/roleNormalization'
import { formatDateTime } from '../../utils/format'
import { isProductSaleable } from '../../services/products'
import jsPDF from 'jspdf'
import { toCanvas } from 'html-to-image'

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

const UNIT_LABELS: Record<string, string> = {
  piece: 'قطعة',
  dozen: 'دستة',
  carton: 'كرتونة',
}

function formatPrice(val: number): string {
  if (!Number.isFinite(val)) return '0'
  return new Intl.NumberFormat('en-US', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val)
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

function generatePdfHtml(groups: CompanyGroup[], logoUrl: string): string {
  const now = new Date()
  const totalCount = groups.reduce((s, g) => s + g.products.length, 0)
  const companyCount = groups.length

  function productRow(p: ProductRow): string {
    const unitPrices = computeUnitPrices(p)
    const code = esc(p.legacy_code || '---')
    const name = esc(p.product_name)
    return `<tr>
      <td style="width:7%;border:1px solid #d0d0d0;padding:4px 3px;text-align:center;vertical-align:middle;font-family:monospace;direction:ltr;font-size:10px;color:#333">${code}</td>
      <td style="width:40%;border:1px solid #d0d0d0;padding:4px 6px;text-align:right;vertical-align:middle;font-size:11px;line-height:1.5;color:#222">${name}</td>
      <td style="width:18%;border:1px solid #d0d0d0;padding:3px 6px;text-align:right;vertical-align:middle">${unitPrices.find((u) => u.unitType === 'piece') ? `<div style="display:flex;justify-content:space-between;direction:rtl"><span style="font-size:9px;color:#555">قطعة</span><span style="font-size:10px;font-weight:700;color:#111">${formatPrice(unitPrices.find((u) => u.unitType === 'piece')!.price)}</span></div>` : '<div style="color:#ccc;font-size:9px">—</div>'}</td>
      <td style="width:18%;border:1px solid #d0d0d0;padding:3px 6px;text-align:right;vertical-align:middle">${unitPrices.find((u) => u.unitType === 'dozen') ? `<div style="display:flex;justify-content:space-between;direction:rtl"><span style="font-size:9px;color:#555">دستة</span><span style="font-size:10px;font-weight:700;color:#111">${formatPrice(unitPrices.find((u) => u.unitType === 'dozen')!.price)}</span></div>` : '<div style="color:#ccc;font-size:9px">—</div>'}</td>
      <td style="width:17%;border:1px solid #d0d0d0;padding:3px 6px;text-align:right;vertical-align:middle">${unitPrices.find((u) => u.unitType === 'carton') ? `<div style="display:flex;justify-content:space-between;direction:rtl"><span style="font-size:9px;color:#555">كرتونة</span><span style="font-size:10px;font-weight:700;color:#111">${formatPrice(unitPrices.find((u) => u.unitType === 'carton')!.price)}</span></div>` : '<div style="color:#ccc;font-size:9px">—</div>'}</td>
    </tr>`
  }

  function groupSection(g: CompanyGroup): string {
    const header = `<tr><td colspan="5" style="background:#e8f0fe;font-weight:700;color:#0d2b6b;font-size:11px;text-align:right;padding:6px 10px;border:1px solid #d0d0d0;border-bottom:2px solid #0052cc">${esc(g.companyName)} <span style="font-weight:400;color:#666;font-size:9px">(${g.products.length} منتج)</span></td></tr>`
    const body = g.products.map(productRow).join('')
    return header + body
  }

  return `<div id="pdf-container" style="direction:rtl;font-family:'Tajawal','Cairo','Segoe UI',Tahoma,Arial,sans-serif;font-size:11px;color:#222;line-height:1.5;padding:15px;background:#fff">
<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #003366;padding-bottom:10px;margin-bottom:12px">
  <div style="flex:2;text-align:right">
    <div style="font-size:13px;font-weight:700;color:#003366;line-height:1.4">شركة الأهرام للتجارة والتوزيع</div>
    <div style="font-size:8px;color:#666">كورنيش النيل - الوراق - جيزة | تليفون: 01040880002</div>
  </div>
  <div style="flex:3;text-align:center">
    <img src="${esc(logoUrl)}" alt="الأهرام" style="height:45px;object-fit:contain" />
  </div>
  <div style="flex:2;text-align:left">
    <div style="font-size:18px;font-weight:700;color:#003366">قائمة أسعار البيع</div>
    <div style="font-size:9px;color:#666;margin-top:2px">${totalCount} منتج | ${companyCount} شركة</div>
    <div style="font-size:8px;color:#999;margin-top:1px">تاريخ الطباعة: ${formatDateTime(now)}</div>
  </div>
</div>
<table style="width:100%;table-layout:fixed;border-collapse:collapse;margin-bottom:8px">
  <thead>
    <tr style="background:#003366;color:#fff">
      <th style="width:7%;padding:5px 3px;text-align:center;font-weight:600;font-size:10px;border:1px solid #003366">الكود</th>
      <th style="width:40%;padding:5px 6px;text-align:center;font-weight:600;font-size:10px;border:1px solid #003366">اسم الصنف</th>
      <th style="width:18%;padding:5px 3px;text-align:center;font-weight:600;font-size:10px;border:1px solid #003366">القطعة</th>
      <th style="width:18%;padding:5px 3px;text-align:center;font-weight:600;font-size:10px;border:1px solid #003366">الدستة</th>
      <th style="width:17%;padding:5px 3px;text-align:center;font-weight:600;font-size:10px;border:1px solid #003366">الكرتونة</th>
    </tr>
  </thead>
  <tbody>
    ${groups.map(groupSection).join('')}
  </tbody>
</table>
<div style="text-align:center;margin-top:8px;font-size:7px;color:#bbb;border-top:1px solid #eee;padding-top:4px">
  <div>شركة الأهرام للتجارة والتوزيع — جميع الحقوق محفوظة</div>
</div>
</div>`
}

async function downloadPdf(groups: CompanyGroup[], logoUrl: string): Promise<void> {
  const html = generatePdfHtml(groups, logoUrl)
  const el = document.createElement('div')
  el.innerHTML = html
  el.style.cssText = 'position:fixed;left:0;top:0;width:210mm;background:#fff;z-index:99999;pointer-events:none'
  document.body.appendChild(el)
  await document.fonts.ready

  try {
    const canvas = await toCanvas(el, {
      width: el.scrollWidth,
      pixelRatio: 2,
      cacheBust: true,
    })

    const imgData = canvas.toDataURL('image/jpeg', 0.95)
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pw = pdf.internal.pageSize.getWidth()
    const ph = pdf.internal.pageSize.getHeight()
    const totalH = (canvas.height * pw) / canvas.width
    const pages = Math.ceil(totalH / ph)
    for (let i = 0; i < pages; i++) {
      if (i > 0) pdf.addPage()
      pdf.addImage(imgData, 'JPEG', 0, -i * ph, pw, totalH)
    }
    pdf.save('sales-list.pdf')
  } finally {
    document.body.removeChild(el)
  }
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

  const productCount = saleableProducts.length
  const companyCount = useMemo(() => {
    const names = new Set<string>()
    for (const p of saleableProducts) {
      if (p.company_name) names.add(p.company_name)
    }
    return names.size
  }, [saleableProducts])

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

  const handleDownloadPdf = useCallback(async () => {
    if (pdfLoading) return
    setPdfLoading(true)
    setPdfPhase('preparing')
    try {
      const logoUrl = window.location.origin + '/store/branding/ahram-logo.png'
      await new Promise((r) => setTimeout(r, 50))
      await downloadPdf(groupedProducts, logoUrl)
      setPdfPhase('done')
      await new Promise((r) => setTimeout(r, 1500))
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
            <div>
              <h1 className="text-lg font-bold text-text leading-tight">قائمة أسعار البيع</h1>
              <div className="flex items-center gap-3 text-[11px] text-text-muted mt-0.5">
                {!loading && (
                  <>
                    <span>{productCount} منتج</span>
                    <span className="text-border">|</span>
                    <span>{companyCount} شركة</span>
                    <span className="text-border">|</span>
                    <span>آخر تحديث: {formatDateTime(new Date())}</span>
                  </>
                )}
              </div>
            </div>
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
                {groupedProducts.map((group) => (
                  <Fragment key={group.companyName}>
                    <tr>
                      <td colSpan={5} className="bg-primary/10 border-y border-primary/20 px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-primary">{group.companyName}</span>
                          <span className="text-[10px] text-primary-light font-normal bg-primary/20 px-1.5 py-0.5 rounded-full">{group.products.length}</span>
                        </div>
                      </td>
                    </tr>
                    {group.products.map((p) => {
                      const unitPrices = computeUnitPrices(p)
                      const priceByType = Object.fromEntries(unitPrices.map((up) => [up.unitType, up.price]))
                      return (
                        <tr key={p.id} className="border-b border-border-light hover:bg-surface transition-colors">
                          <td className="px-2 py-1.5 text-center font-mono text-[10px] text-text-muted ltr align-middle">
                            {p.legacy_code || '---'}
                          </td>
                          <td className="px-3 py-1.5 text-right text-xs text-text align-middle" dangerouslySetInnerHTML={{ __html: highlightText(p.product_name, search) }} />
                          <td className="px-2 py-1.5 text-center align-middle">
                            {priceByType.piece != null ? (
                              <span className="text-xs font-bold text-text">{formatPrice(priceByType.piece)}</span>
                            ) : (
                              <span className="text-text-muted text-[10px]">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center align-middle">
                            {priceByType.dozen != null ? (
                              <span className="text-xs font-bold text-text">{formatPrice(priceByType.dozen)}</span>
                            ) : (
                              <span className="text-text-muted text-[10px]">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center align-middle">
                            {priceByType.carton != null ? (
                              <span className="text-xs font-bold text-text">{formatPrice(priceByType.carton)}</span>
                            ) : (
                              <span className="text-text-muted text-[10px]">—</span>
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
