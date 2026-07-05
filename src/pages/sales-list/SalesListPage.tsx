import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { normalizeEmployeeRole, type TargetRole } from '../../utils/roleNormalization'
import { formatDateTime } from '../../utils/format'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

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

function renderPriceLines(unitPrices: UnitPriceInfo[]): string {
  return unitPrices.map((up) => `${formatPrice(up.price)} : ${UNIT_LABELS[up.unitType] || up.unitType}`).join('<br/>')
}

function renderSalesListHtml(groups: CompanyGroup[], logoUrl: string): string {
  const now = new Date()

  function productRow(p: ProductRow): string {
    const unitPrices = computeUnitPrices(p)
    const code = esc(p.legacy_code || '---')
    const name = esc(p.product_name)
    const prices = renderPriceLines(unitPrices)
    return `<tr>
      <td style="width:5%;border:1px solid #000;padding:8px 6px;text-align:center;vertical-align:middle;font-family:monospace;direction:ltr;font-size:14px">${code}</td>
      <td style="width:65%;border:1px solid #000;padding:8px 6px;text-align:right;vertical-align:middle;font-size:16px;line-height:1.5;white-space:normal !important;word-wrap:break-word;word-break:break-word">${name}</td>
      <td style="width:30%;border:1px solid #000;padding:8px 6px;text-align:center;vertical-align:middle;font-size:14px;line-height:1.5">${prices}</td>
    </tr>`
  }

  function groupRows(): string {
    return groups.map((g) => {
      const body = g.products.map(productRow).join('')
      const header = `<tr><td colspan="3" style="background:#e8f0fe;font-weight:700;color:#0d2b6b;font-size:10pt;text-align:right;padding:6px 10px;border:1px solid #000;border-bottom:2px solid #0052cc">${esc(g.companyName)} (${g.products.length})</td></tr>`
      return header + body
    }).join('')
  }

  return `<div id="pdf-container">
<style>
  #pdf-container { direction:rtl; font-family:'Cairo','Tajawal','Segoe UI',Tahoma,Arial,sans-serif; font-size:9pt; color:#222; line-height:1.5; padding:10mm; background:#fff; }
  #pdf-container .top-bar { display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #003366; padding-bottom:10px; margin-bottom:14px; }
  #pdf-container .header-right { flex:3; text-align:right; }
  #pdf-container .header-right .brand { font-size:14pt; font-weight:700; color:#003366; }
  #pdf-container .header-right .contact { font-size:8pt; color:#333; }
  #pdf-container .header-center { flex:4; text-align:center; }
  #pdf-container .header-center .logo-img { height:60px; object-fit:contain; }
  #pdf-container .header-left { flex:3; text-align:left; }
  #pdf-container .header-left .doc-title { font-size:20pt; font-weight:700; color:#003366; }
  #pdf-container .header-left .doc-date { font-size:11pt; color:#555; margin-top:2px; }
  #pdf-container table { width:100%; table-layout:fixed; border-collapse:collapse; margin-bottom:10px; }
  #pdf-container th { background:#003366; color:#fff; padding:8px 6px; text-align:center; vertical-align:middle; font-weight:600; font-size:14px; border:1px solid #003366; }
  #pdf-container td { padding:8px 6px; text-align:center; vertical-align:middle; font-size:14px; line-height:1.5; border:1px solid #000; }
  #pdf-container .cell-name { white-space:normal !important; word-wrap:break-word; word-break:break-word; }
  #pdf-container .footer { text-align:center; margin-top:14px; font-size:7pt; color:#9ca3af; border-top:1px solid #e5e7eb; padding-top:6px; }
</style>
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
    <div class="doc-title">sales-list</div>
    <div class="doc-date">تاريخ الطباعة: ${formatDateTime(now)}</div>
  </div>
</div>
<table>
  <thead>
    <tr>
      <th style="width:5%">كود الصنف</th>
      <th style="width:65%">اسم الصنف</th>
      <th style="width:30%">سعر البيع للوحدات المتاحة</th>
    </tr>
  </thead>
  <tbody>
    ${groupRows()}
  </tbody>
</table>
<div class="footer">
  <div>شركة الأهرام للتجارة والتوزيع - جميع الحقوق محفوظة</div>
  <div>تاريخ الطباعة: ${formatDateTime(now)}</div>
</div>
</div>`
}

async function downloadPdf(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  container.style.cssText = 'position:absolute;top:0;left:0;width:210mm;z-index:-1;opacity:0;pointer-events:none'
  document.body.appendChild(container)

  try {
    await document.fonts.ready
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      width: 794,
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
    document.body.removeChild(container)
  }
}

export default function SalesListPage() {
  const navigate = useNavigate()
  const pdfRef = useRef<HTMLDivElement>(null)
  const { token: authToken, user } = useAuthStore()
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)

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

  async function handleDownloadPdf() {
    const logoUrl = window.location.origin + '/store/branding/ahram-logo.png'
    const html = renderSalesListHtml(groupedProducts, logoUrl)
    setPdfLoading(true)
    try {
      await downloadPdf(html)
    } finally {
      setPdfLoading(false)
    }
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
        <h1 className="text-lg font-bold text-text">sales-list</h1>
        <button onClick={handleDownloadPdf} disabled={pdfLoading || smartFiltered.length === 0}
          className="mr-auto bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50">
          {pdfLoading ? 'جاري التحميل...' : 'تحميل PDF'}
        </button>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم الصنف، الكود..."
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
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" ref={pdfRef}>
            <thead>
              <tr className="bg-[#003366] text-white">
                <th className="w-[5%] border border-[#003366] px-1 py-2 text-center text-[10px] font-semibold">كود الصنف</th>
                <th className="w-[65%] border border-[#003366] px-2 py-2 text-center text-[10px] font-semibold">اسم الصنف</th>
                <th className="w-[30%] border border-[#003366] px-2 py-2 text-center text-[10px] font-semibold">سعر البيع للوحدات المتاحة</th>
              </tr>
            </thead>
            <tbody>
              {groupedProducts.map((group) => (
                <Fragment key={group.companyName}>
                  <tr>
                    <td colSpan={3} className="bg-[#e8f0fe] font-bold text-[#0d2b6b] text-xs text-right px-3 py-2 border border-black border-b-2 border-b-[#0052cc]">
                      {group.companyName} <span className="text-gray-500 font-normal text-[10px]">({group.products.length})</span>
                    </td>
                  </tr>
                  {group.products.map((p) => {
                    const unitPrices = computeUnitPrices(p)
                    return (
                      <tr key={p.id} className="even:bg-gray-50">
                        <td className="border border-black px-1 py-1.5 text-center font-mono text-[10px] ltr align-middle">
                          {p.legacy_code || '---'}
                        </td>
                        <td className="border border-black px-2 py-1.5 text-right text-xs align-middle">
                          {p.product_name}
                        </td>
                        <td className="border border-black px-2 py-1.5 text-center text-[10px] align-middle leading-relaxed">
                          {unitPrices.map((up, i) => (
                            <span key={up.unitType} className={i > 0 ? 'block' : ''}>
                              {formatPrice(up.price)} : {UNIT_LABELS[up.unitType] || up.unitType}
                            </span>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div className="text-center text-[10px] text-text-secondary pt-3 pb-4">
            إجمالي الأصناف: {smartFiltered.length} | التصنيفات: {groupedProducts.length}
          </div>
        </div>
      )}
    </div>
  )
}
