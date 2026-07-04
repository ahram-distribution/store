import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { normalizeEmployeeRole, type TargetRole } from '../../utils/roleNormalization'
import { formatCurrencyShort, formatDateTime } from '../../utils/format'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const ALLOWED_ROLES: TargetRole[] = ['الإدارة العليا', 'مدير بيع', 'مندوب مبيعات']

interface ProductRow {
  id: string
  product_name: string
  legacy_code: string
  company_id: string
  company_name: string
  is_active: boolean
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

function esc(s: string | null | undefined): string {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

function formatPrice(val: number): string {
  if (!Number.isFinite(val)) return '0'
  return new Intl.NumberFormat('en-US', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val)
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

function renderSalesListHtml(groups: CompanyGroup[], logoUrl: string): string {
  const now = new Date()
  const totalCount = groups.reduce((s, g) => s + g.products.length, 0)

  function productRow(p: ProductRow): string {
    const unitPrices = computeUnitPrices(p)
    const unitDisplay = unitPrices.map((up) => UNIT_LABELS[up.unitType] || up.unitType).join(' - ')
    const priceDisplay = unitPrices.map((up) => `${UNIT_LABELS[up.unitType] || up.unitType}: ${formatPrice(up.price)}`).join(' | ')
    const displayName = p.legacy_code ? `${p.legacy_code} - ${p.product_name}` : p.product_name
    return `<tr>
      <td style="font-family:monospace;direction:ltr">${esc(p.legacy_code || '---')}</td>
      <td>${esc(displayName)}</td>
      <td>${esc(p.company_name || '')}</td>
      <td>${esc(unitDisplay)}</td>
      <td>${priceDisplay}</td>
    </tr>`
  }

  function rowsHtml(): string {
    return groups.map((g) => {
      const body = g.products.map(productRow).join('')
      return `<tr class="group-header"><td colspan="5">${esc(g.companyName)} (${g.products.length})</td></tr>${body}`
    }).join('')
  }

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>ليست البيع</title>
<style>
  @page { margin: 0 !important; size: A4 landscape; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Cairo', 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 9pt; color: #222; line-height: 1.5; position: relative; padding: 0; }
  .watermark-wrap { position: fixed; top: 0; bottom: 0; left: 0; right: 0; z-index: -10; display: flex; justify-content: center; align-items: center; pointer-events: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .watermark-wrap img { transform: rotate(-45deg) scale(2.5); opacity: 0.05; max-width: 100%; max-height: 100%; }
  .print-content { position: relative; z-index: 1; }
  .top-bar { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #003366; padding-bottom: 12px; margin-bottom: 16px; }
  .header-right { flex: 3; text-align: right; }
  .header-right .brand { font-size: 14pt; font-weight: 700; color: #003366; white-space: nowrap; }
  .header-right .contact { font-size: 9pt; color: #333; }
  .header-center { flex: 4; text-align: center; }
  .header-center .logo-img { height: auto; max-height: 100px; max-width: 100%; object-fit: contain; margin: 0 auto; }
  .header-left { flex: 3; text-align: left; }
  .header-left .doc-title { font-size: 16pt; font-weight: 700; color: #003366; }
  .header-left .doc-date { font-size: 9pt; color: #555; margin-top: 2px; }
  .info-bar { background: #f0f5ff; border: 1px solid #cce0ff; border-radius: 4px; padding: 6px 10px; margin-bottom: 12px; font-size: 8pt; color: #555; text-align: center; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  thead { display: table-header-group; }
  tbody { display: table-row-group; }
  th { background: #003366; color: #fff; padding: 6px 4px !important; text-align: center; vertical-align: middle !important; font-weight: 600; font-size: 8pt; word-wrap: break-word; }
  td { padding: 5px 4px !important; border-bottom: 1px solid #e5e7eb; text-align: center; vertical-align: middle !important; font-size: 8pt; word-wrap: break-word; }
  tbody tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) { background: #f8f9fa; }
  .group-header td { background: #e8f0fe; font-weight: 700; color: #0d2b6b; font-size: 9pt; text-align: right; padding: 6px 10px !important; border-bottom: 2px solid #0052cc; }
  .footer { text-align: center; margin-top: 16px; font-size: 7pt; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 6px; }
  .footer .count { font-weight: 700; color: #003366; }
  @media print { @page { margin: 0 !important; } body { margin: 0.8cm !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
<div class="watermark-wrap"><img src="${esc(logoUrl)}" alt="" /></div>
<div class="print-content">
<div class="top-bar">
  <div class="header-right">
    <div class="brand">شركة الأهرام للتجارة والتوزيع</div>
    <div class="contact">كورنيش النيل - الوراق - جيزة</div>
    <div class="contact">تليفون: 01040880002</div>
  </div>
  <div class="header-center">
    <img src="${esc(logoUrl)}" alt="الأهرام" class="logo-img" />
  </div>
  <div class="header-left">
    <div class="doc-title">ليست البيع</div>
    <div class="doc-date">تاريخ الطباعة: ${formatDateTime(now)}</div>
  </div>
</div>
<table>
  <thead>
    <tr>
      <th>كود الصنف</th>
      <th>اسم الصنف</th>
      <th>التصنيف</th>
      <th>وحدة البيع</th>
      <th>سعر البيع</th>
    </tr>
  </thead>
  <tbody>
    ${rowsHtml()}
  </tbody>
</table>
<div class="footer">
  <div>شركة الأهرام للتجارة والتوزيع - جميع الحقوق محفوظة</div>
  <div>تاريخ الطباعة: ${formatDateTime(now)}</div>
</div>
</div>
</body></html>`
}

function printIframe(html: string) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none'
  document.body.appendChild(iframe)
  const win = iframe.contentWindow
  if (!win) { document.body.removeChild(iframe); return }
  win.document.write(html)
  win.document.close()
  setTimeout(() => { try { win.print() } catch {}; document.body.removeChild(iframe) }, 500)
}

export default function SalesListPage() {
  const navigate = useNavigate()
  const { token: authToken, user } = useAuthStore()
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')

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

  const companyNames = useMemo(() => {
    const names = new Set<string>()
    for (const p of products) {
      if (p.company_name) names.add(p.company_name)
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [products])

  const smartFiltered = useMemo(() => {
    let list = products
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
  }, [products, search, companyFilter])

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

  const handlePrint = () => {
    const logoUrl = window.location.origin + '/store/branding/ahram-logo.png'
    const html = renderSalesListHtml(groupedProducts, logoUrl)
    printIframe(html)
  }

  if (!hasAccess) {
    return (
      <div className="text-center py-12 text-text-secondary text-sm">
        ليس لديك صلاحية الوصول لهذه الشاشة
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">ليست البيع</h1>
        <button onClick={handlePrint} className="mr-auto bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">
          طباعة ليست البيع
        </button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم الصنف، الكود، أو الحجم..."
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white pr-8"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm">&#x1F50D;</span>
        </div>
        {companyNames.length > 1 && (
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="border border-border rounded-lg px-2 py-2 text-sm bg-white shrink-0 max-w-[130px]"
          >
            <option value="">الكل</option>
            {companyNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : smartFiltered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">
          {search || companyFilter ? 'لا توجد نتائج للبحث' : 'لا توجد منتجات متاحة'}
        </div>
      ) : (
        <div className="space-y-4">
          {groupedProducts.map((group) => (
            <div key={group.companyName} className="space-y-1">
              <div className="bg-primary/5 text-primary font-bold text-sm px-3 py-2 rounded-lg sticky top-0 border border-primary/10">
                {group.companyName}
                <span className="text-text-secondary text-[10px] font-normal mr-2">({group.products.length})</span>
              </div>
              <div className="space-y-1">
                {group.products.map((p) => {
                  const unitPrices = computeUnitPrices(p)
                  const unitDisplay = unitPrices.map((up) => UNIT_LABELS[up.unitType] || up.unitType).join(' - ')
                  const displayName = p.legacy_code ? `${p.legacy_code} - ${p.product_name}` : p.product_name
                  return (
                    <div key={p.id} className="bg-white rounded-lg border border-border p-3 space-y-1">
                      <div className="font-semibold text-sm text-text">{displayName}</div>
                      <div className="flex items-center gap-3 text-xs text-text-secondary">
                        <span>{unitDisplay}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {unitPrices.map((up) => (
                          <span key={up.unitType} className="bg-primary/5 text-primary text-[10px] px-2 py-0.5 rounded-full">
                            {UNIT_LABELS[up.unitType] || up.unitType}: {formatCurrencyShort(up.price)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
          <div className="text-center text-[10px] text-text-secondary pb-4 print:hidden">
            إجمالي الأصناف: {smartFiltered.length} | التصنيفات: {groupedProducts.length}
          </div>
        </div>
      )}
    </div>
  )
}
