import { useState, useEffect, useMemo, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { normalizeEmployeeRole, type TargetRole } from '../../utils/roleNormalization'
import { formatDateTime } from '../../utils/format'
import jsPDF from 'jspdf'
import 'jspdf-autotable'

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
  return unitPrices.map((up) => `${formatPrice(up.price)} : ${UNIT_LABELS[up.unitType] || up.unitType}`).join(' | ')
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.crossOrigin = 'anonymous'
    img.src = url
  })
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

async function downloadPdf(groups: CompanyGroup[], logoUrl: string) {
  const [fontResp, logoImg] = await Promise.all([
    fetch('/store/fonts/Tajawal-Regular.ttf'),
    loadImage(logoUrl).catch(() => null),
  ])
  const fontArrayBuffer = await fontResp.arrayBuffer()
  const fontBase64 = arrayBufferToBase64(fontArrayBuffer)

  const pdf = new jsPDF('p', 'mm', 'a4')
  pdf.addFileToVFS('Tajawal-Regular.ttf', fontBase64)
  pdf.addFont('Tajawal-Regular.ttf', 'Tajawal', 'normal')

  const pw = pdf.internal.pageSize.getWidth()
  const ph = pdf.internal.pageSize.getHeight()
  const margin = 10
  const innerW = pw - 2 * margin

  let startY = margin

  // --- Header ---
  if (logoImg) {
    pdf.addImage(logoImg, 'PNG', pw / 2 - 12.5, margin, 25, 18)
    startY = margin + 22
  }

  pdf.setFont('Tajawal', 'bold')
  pdf.setFontSize(16)
  pdf.text('شركة الأهرام للتجارة والتوزيع', pw - margin, startY, { align: 'right' })
  pdf.setFont('Tajawal', 'normal')
  pdf.setFontSize(8)
  pdf.text('كورنيش النيل - الوراق - جيزة', pw - margin, startY + 5, { align: 'right' })
  pdf.text('تليفون: 01040880002', pw - margin, startY + 10, { align: 'right' })

  pdf.setFont('Tajawal', 'bold')
  pdf.setFontSize(18)
  pdf.text('sales-list', margin, startY, { align: 'left' })
  pdf.setFont('Tajawal', 'normal')
  pdf.setFontSize(9)
  const now = new Date()
  pdf.text(`تاريخ الطباعة: ${formatDateTime(now)}`, margin, startY + 10, { align: 'left' })

  const headerBottom = startY + 15

  // --- Build autotable body ---
  const body: any[][] = []

  for (const group of groups) {
    body.push([
      {
        content: `${group.companyName} (${group.products.length})`,
        colSpan: 3,
        styles: {
          fillColor: [232, 240, 254],
          textColor: [13, 43, 107],
          fontStyle: 'bold',
          fontSize: 9,
          halign: 'right',
          cellPadding: { top: 2, bottom: 2, left: 4, right: 4 },
        },
      },
    ])
    for (const product of group.products) {
      const unitPrices = computeUnitPrices(product)
      const prices = unitPrices
        .map((up) => `${formatPrice(up.price)} : ${UNIT_LABELS[up.unitType] || up.unitType}`)
        .join(' | ')
      body.push([
        { content: product.legacy_code || '---', styles: { font: 'Courier', halign: 'center', fontSize: 7 } },
        { content: product.product_name, styles: { halign: 'right', fontSize: 9 } },
        { content: prices, styles: { halign: 'center', fontSize: 8 } },
      ])
    }
  }

  // --- Draw separator line below header ---
  pdf.setDrawColor(0, 51, 102)
  pdf.setLineWidth(0.5)
  pdf.line(margin, headerBottom + 1, pw - margin, headerBottom + 1)

  // --- Table ---
  pdf.autoTable({
    startY: headerBottom + 4,
    head: [
      [
        { content: 'كود الصنف', styles: { halign: 'center', fillColor: [0, 51, 102], textColor: 255, fontSize: 8, fontStyle: 'bold' } },
        { content: 'اسم الصنف', styles: { halign: 'center', fillColor: [0, 51, 102], textColor: 255, fontSize: 8, fontStyle: 'bold' } },
        { content: 'سعر البيع للوحدات المتاحة', styles: { halign: 'center', fillColor: [0, 51, 102], textColor: 255, fontSize: 8, fontStyle: 'bold' } },
      ],
    ],
    body,
    theme: 'grid',
    tableWidth: innerW,
    columnStyles: {
      0: { cellWidth: innerW * 0.05 },
      1: { cellWidth: innerW * 0.55 },
      2: { cellWidth: innerW * 0.40 },
    },
    styles: {
      font: 'Tajawal',
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 },
    },
    margin: { left: margin, right: margin },
    didDrawPage: () => {
      pdf.setFontSize(6)
      pdf.setTextColor(156, 163, 175)
      pdf.setFont('Tajawal', 'normal')
      const footerText = 'شركة الأهرام للتجارة والتوزيع - جميع الحقوق محفوظة'
      pdf.text(footerText, pw / 2, ph - 5, { align: 'center' })
    },
  })

  pdf.save('sales-list.pdf')
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
    setPdfLoading(true)
    try {
      await downloadPdf(groupedProducts, logoUrl)
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
                <th className="w-[55%] border border-[#003366] px-2 py-2 text-center text-[10px] font-semibold">اسم الصنف</th>
                <th className="w-[40%] border border-[#003366] px-2 py-2 text-center text-[10px] font-semibold">سعر البيع للوحدات المتاحة</th>
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
                        <td className="border border-black px-2 py-1.5 text-center text-[10px] align-middle whitespace-nowrap">
                          {unitPrices.map((up, i) => (
                            <span key={up.unitType}>{i > 0 ? ' | ' : ''}{formatPrice(up.price)} : {UNIT_LABELS[up.unitType] || up.unitType}</span>
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
