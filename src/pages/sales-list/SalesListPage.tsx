import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { useCartStore } from '../../store/cart'
import { applyGeographicAdjustment } from '../../engine/pricing'
import { normalizeEmployeeRole, type TargetRole } from '../../utils/roleNormalization'
import { buildSearchIndex, searchProducts, type ProductSearchIndex } from '../../utils/smartSearch'
import { SearchHighlight } from '../../components/shared/SearchHighlight'
import { exportToExcel } from '../../services/excelExporter'
import {
  getGovernorateAdjustmentRows,
  getSectorAdjustmentRows,
  type GeoAdjustmentRow,
} from '../../services/geographicPricing'
import {
  getGeographicVisibilityHiddenProducts,
  getGeographicVisibilityHiddenProductsForSector,
  toVisibilitySets,
} from '../../services/geographicVisibility'
import { useGeographicVisibility } from '../../hooks/useGeographicVisibility'

const ALLOWED_ROLES: TargetRole[] = ['الإدارة العليا', 'مدير بيع', 'مندوب مبيعات']

interface GovernorateItem {
  id: string
  name: string
}

interface SectorItem {
  id: string
  name: string
}

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
  piece_price: number
  dozen_price: number
}

interface CompanyGroup {
  companyName: string
  products: ProductRow[]
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

// Product-level availability only — unit availability never hides the product
// or its prices (piece/carton prices are shown for every active saleable product).
function isProductAvailable(p: ProductRow): boolean {
  if (!p.is_active) return false
  if (p.is_visible === false) return false
  if (p.is_out_of_stock) return false
  return !!p.carton_price && Number(p.carton_price) > 0
}

function esc(s: string | null | undefined): string {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

function generatePrintHtml(groups: CompanyGroup[], logoUrl: string, regionLabel?: string): string {
  const now = new Date()
  const dateStr = now.toLocaleDateString('ar-EG-u-nu-latn', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: false })
  const docTitle = regionLabel ? `قائمة أسعار — ${regionLabel}` : 'قائمة أسعار البيع'

  function productRow(p: ProductRow, bgColor: string): string {
    const code = esc(p.legacy_code || '---')
    const name = esc(p.product_name)
    const piece = Number(p.piece_price) || 0
    const carton = Number(p.carton_price) || 0
    const cellStyle = `border:1px solid #e2e8f0;padding:4px 3px;text-align:center;vertical-align:middle;background:${bgColor}`
    return `<tr>
      <td style="width:8%;${cellStyle};font-family:monospace;direction:ltr;font-size:10px;color:#475569">${code}</td>
      <td style="width:60%;${cellStyle};text-align:right;padding:4px 6px;font-size:11px;line-height:1.5;color:#111827">${name}</td>
      <td style="width:16%;${cellStyle}">${piece > 0 ? `<span style="font-size:10px;font-weight:700;color:#111827">${formatPrice(piece)}</span>` : '<span style="color:#d1d5db;font-size:9px">&mdash;</span>'}</td>
      <td style="width:16%;${cellStyle}">${carton > 0 ? `<span style="font-size:10px;font-weight:700;color:#111827">${formatPrice(carton)}</span>` : '<span style="color:#d1d5db;font-size:9px">&mdash;</span>'}</td>
    </tr>`
  }

  function groupSection(g: CompanyGroup, idx: number): string {
    const bgColor = idx % 2 === 0 ? '#f8fafc' : '#f7faff'
    const header = `<tr><td colspan="4" style="background:${bgColor};border-bottom:1px solid #e2e8f0;padding:5px 10px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;border-top:none"><div style="display:flex;align-items:center;gap:6px"><span style="display:inline-block;width:6px;height:6px;border-radius:1px;background:rgba(0,82,204,0.6)"></span><span style="font-weight:700;color:#111827;font-size:11px">${esc(g.companyName)}</span><span style="font-weight:400;color:#6b7280;font-size:9px">${g.products.length} منتج</span></div></td></tr>`
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
  .top-bar-wrap { display: table-header-group; }
  .brand { font-size: 13px; font-weight: 700; color: #003366; }
  .contact { font-size: 8px; color: #6b7280; }
  .logo { height: 40px; object-fit: contain; }
  .doc-title { font-size: 18px; font-weight: 700; color: #003366; text-align: left; }
  .doc-meta { font-size: 8px; color: #9ca3af; text-align: left; margin-top: 2px; line-height: 1.6; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-bottom: 6px; }
  thead tr { background: #003366; color: #fff; }
  th { width: 8%; padding: 4px 3px; text-align: center; font-weight: 600; font-size: 10px; border: 1px solid #003366; }
  th:nth-child(2) { width: 60%; }
  th:nth-child(3) { width: 16%; }
  th:nth-child(4) { width: 16%; }
  thead { display: table-header-group; }
  tbody { display: table-row-group; }
  tbody tr { page-break-inside: avoid; }
  .footer { text-align: center; font-size: 7px; color: #d1d5db; border-top: 1px solid #f3f4f6; padding-top: 4px; margin-top: 6px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<thead class="top-bar-wrap">
<tr><td>
<div class="top-bar">
  <div style="flex:2;text-align:right">
    <div class="brand">شركة الأهرام للتجارة والتوزيع</div>
    <div class="contact">الوراق - الجيزة | تليفون: 01040880002</div>
  </div>
  <div style="flex:3;text-align:center">
    <img src="${esc(logoUrl)}" alt="الأهرام" class="logo" />
  </div>
  <div style="flex:2">
    <div class="doc-title">${docTitle}</div>
    <div class="doc-meta">${regionLabel ? `القائمة: ${regionLabel}<br/>` : ''}تاريخ الطباعة: ${dateStr}<br/>وقت الطباعة: ${timeStr}</div>
  </div>
</div>
</td></tr>
</thead>
<table>
  <thead>
    <tr>
      <th>الكود</th>
      <th>اسم الصنف</th>
      <th>سعر القطعة</th>
      <th>سعر الكرتونة</th>
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
  const { geographicContext, resolveEmployeeGeographicContext, geoItemAdjustments, geoResolveEpoch, ensureGeoItemAdjustments } = useCartStore()
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfPhase, setPdfPhase] = useState<'idle' | 'preparing' | 'done'>('idle')
  const [listType, setListType] = useState<'basic' | 'governorate' | 'sector'>('basic')
  const [governorates, setGovernorates] = useState<GovernorateItem[]>([])
  const [sectors, setSectors] = useState<SectorItem[]>([])
  const [selectedGovernorate, setSelectedGovernorate] = useState('')
  const [selectedSector, setSelectedSector] = useState('')
  const [geoOverride, setGeoOverride] = useState<Record<string, number> | null>(null)
  const [geoOverrideRows, setGeoOverrideRows] = useState<GeoAdjustmentRow[]>([])
  const [geoResolving, setGeoResolving] = useState(false)

  const userRoles = user?.roles || []
  const normalizedRoles = userRoles.map(normalizeEmployeeRole)
  const hasAccess = ALLOWED_ROLES.some((r) => normalizedRoles.includes(r))
  const isUpperMgmt = userRoles.includes('الإدارة العليا')

  const { hiddenProductIds: ctxHiddenProductIds } = useGeographicVisibility()
  const [overrideHiddenProductIds, setOverrideHiddenProductIds] = useState<Set<string>>(new Set())
  const [overrideHiddenResolving, setOverrideHiddenResolving] = useState(false)

  useEffect(() => {
    if (!hasAccess) return
    if (!authToken) { setLoading(false); return }
    setLoading(true)
    supabase.rpc('get_governed_products', { p_token: authToken, p_active_only: true, p_visible_only: true })
      .then(({ data }) => {
        const arr = Array.isArray(data) ? data : []
        setProducts(arr)
      })
      .finally(() => setLoading(false))
  }, [hasAccess, authToken])

  useEffect(() => {
    if (user?.identity_type !== 'employee' || !user.employee_id) return
    resolveEmployeeGeographicContext(user.employee_id)
  }, [user?.identity_type, user?.employee_id, resolveEmployeeGeographicContext])

  useEffect(() => {
    if (products.length > 0) {
      ensureGeoItemAdjustments(products.map((p) => ({ id: p.id, companyId: p.company_id })))
    }
  }, [products, geographicContext?.governorateId, geoResolveEpoch, ensureGeoItemAdjustments])

  useEffect(() => {
    if (!isUpperMgmt || !authToken) return
    supabase.rpc('get_reference_governorates', { p_token: authToken })
      .then(({ data }) => {
        if (!Array.isArray(data)) return
        setGovernorates(data.map((g: { id?: string; name_ar?: string }) => ({ id: g.id || '', name: g.name_ar || '' })).filter((g) => !!g.id))
      })
    supabase.rpc('get_governed_sectors', { p_token: authToken, p_search: null })
      .then(({ data }) => {
        if (!Array.isArray(data)) return
        setSectors(data.map((s: { id?: string; name?: string; name_ar?: string | null }) => ({ id: s.id || '', name: s.name_ar || s.name || '' })).filter((s) => !!s.id))
      })
  }, [isUpperMgmt, authToken])

  useEffect(() => {
    if (!isUpperMgmt) {
      setGeoOverride(null)
      setGeoOverrideRows([])
      setGeoResolving(false)
      return
    }
    const regionId = listType === 'governorate' ? selectedGovernorate : listType === 'sector' ? selectedSector : ''
    if (!regionId || products.length === 0) {
      setGeoOverride(null)
      setGeoOverrideRows([])
      setGeoResolving(false)
      return
    }
    const targets = products.map((p) => ({ id: p.id, companyId: p.company_id }))
    setGeoResolving(true)
    const task = listType === 'governorate'
      ? getGovernorateAdjustmentRows(regionId, targets)
      : getSectorAdjustmentRows(regionId, targets)
    task
      .then((res) => {
        setGeoOverride(res.map)
        setGeoOverrideRows(res.rows)
      })
      .catch(() => {
        setGeoOverride(null)
        setGeoOverrideRows([])
      })
      .finally(() => setGeoResolving(false))
  }, [isUpperMgmt, listType, selectedGovernorate, selectedSector, products])

  const geoAdjustedProducts = useMemo(() => {
    if (products.length === 0) return products
    const overrideActive = isUpperMgmt && geoOverride !== null
    return products.map(p => {
      const adj = overrideActive ? (geoOverride?.[p.id] ?? 0) : (geoItemAdjustments[p.id] ?? geographicContext?.adjustmentPercent ?? 0)
      if (adj === 0) return p
      return {
        ...p,
        piece_price: Math.round(applyGeographicAdjustment(Number(p.piece_price) || 0, adj) * 100) / 100,
        carton_price: Math.round(applyGeographicAdjustment(Number(p.carton_price) || 0, adj) * 100) / 100,
        dozen_price: Math.round(applyGeographicAdjustment(Number(p.dozen_price) || 0, adj) * 100) / 100,
      }
    })
  }, [products, geographicContext?.adjustmentPercent, geoItemAdjustments, geoOverride, isUpperMgmt])

  useEffect(() => {
    const overrideActive = isUpperMgmt && geoOverride !== null
    if (!overrideActive) {
      setOverrideHiddenProductIds(new Set())
      setOverrideHiddenResolving(false)
      return
    }
    let cancelled = false
    setOverrideHiddenResolving(true)
    const task = listType === 'governorate' && selectedGovernorate
      ? getGeographicVisibilityHiddenProducts(selectedGovernorate)
      : listType === 'sector' && selectedSector
        ? getGeographicVisibilityHiddenProductsForSector(selectedSector)
        : Promise.resolve([])
    task
      .then((rows) => {
        if (cancelled) return
        setOverrideHiddenProductIds(toVisibilitySets(rows).hiddenProductIds)
      })
      .catch(() => {
        if (cancelled) return
        setOverrideHiddenProductIds(new Set())
      })
      .finally(() => {
        if (!cancelled) setOverrideHiddenResolving(false)
      })
    return () => { cancelled = true }
  }, [isUpperMgmt, listType, selectedGovernorate, selectedSector, geoOverride])

  const hiddenForList = isUpperMgmt && geoOverride !== null ? overrideHiddenProductIds : ctxHiddenProductIds

  const saleableProducts = useMemo(() => geoAdjustedProducts.filter((p) => isProductAvailable(p) && !hiddenForList.has(p.id)), [geoAdjustedProducts, hiddenForList])

  const companyNames = useMemo(() => {
    const names = new Set<string>()
    for (const p of saleableProducts) {
      if (p.company_name) names.add(p.company_name)
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [saleableProducts])

  const searchIndices = useMemo(() => {
    return saleableProducts.map((p) => ({
      id: p.id,
      product: p,
      index: buildSearchIndex({
        id: p.id,
        legacyCode: p.legacy_code,
        productName: p.product_name,
        companyName: p.company_name,
      }),
    }))
  }, [saleableProducts])

  const smartFiltered = useMemo(() => {
    let list = saleableProducts
    if (search.trim()) {
      const indices = searchIndices.filter((si) => list.includes(si.product))
      list = searchProducts(search, indices, (si) => si.index).map((si) => si.product)
    } else {
      if (companyFilter) {
        list = list.filter((p) => p.company_name === companyFilter)
      }
      list = [...list].sort((a, b) => a.product_name.localeCompare(b.product_name))
    }
    return list
  }, [saleableProducts, search, companyFilter, searchIndices])

  const groupedProducts = useMemo((): CompanyGroup[] => {
    const isSearching = search.trim().length > 0
    const map: Record<string, ProductRow[]> = {}
    for (const p of smartFiltered) {
      const key = p.company_name || 'غير مصنف'
      if (!map[key]) map[key] = []
      map[key].push(p)
    }
    if (!isSearching) {
      for (const key of Object.keys(map)) {
        map[key].sort((a, b) => a.product_name.localeCompare(b.product_name))
      }
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([companyName, prods]) => ({ companyName, products: prods }))
  }, [smartFiltered, search])

  const regionInfo = useMemo<{ label: string; name: string } | null>(() => {
    if (listType === 'governorate' && selectedGovernorate) {
      const g = governorates.find((x) => x.id === selectedGovernorate)
      if (!g || !g.name) return null
      return { label: `محافظة ${g.name}`, name: g.name }
    }
    if (listType === 'sector' && selectedSector) {
      const s = sectors.find((x) => x.id === selectedSector)
      if (!s || !s.name) return null
      return { label: `قطاع ${s.name}`, name: s.name }
    }
    return null
  }, [listType, selectedGovernorate, selectedSector, governorates, sectors])

  const handleListTypeChange = useCallback((value: string) => {
    setListType(value as 'basic' | 'governorate' | 'sector')
    setSelectedGovernorate('')
    setSelectedSector('')
  }, [])

  const handleDownloadPdf = useCallback(() => {
    if (pdfLoading) return
    setPdfLoading(true)
    setPdfPhase('preparing')
    try {
      const logoUrl = window.location.origin + '/store/branding/ahram-logo.png'
      const html = generatePrintHtml(groupedProducts, logoUrl, regionInfo?.label ?? undefined)
      printHtml(html)
      setPdfPhase('done')
    } finally {
      setPdfLoading(false)
      setPdfPhase('idle')
    }
  }, [pdfLoading, groupedProducts, regionInfo])

  const handleDownloadExcel = useCallback(() => {
    if (smartFiltered.length === 0) return
    const columns: { key: string; label: string; format?: 'number' | 'currency' }[] = [
      { key: 'legacy_code', label: 'كود الصنف' },
      { key: 'product_name', label: 'اسم الصنف' },
      { key: 'carton_quantity', label: 'عدد الوحدات', format: 'number' },
      { key: 'company_name', label: 'اسم الشركة' },
      { key: 'piece_price', label: 'سعر القطعة', format: 'currency' },
      { key: 'dozen_price', label: 'سعر الدستة', format: 'currency' },
      { key: 'carton_price', label: 'سعر الكرتونة', format: 'currency' },
    ]
    const data: Record<string, unknown>[] = smartFiltered.map((p) => ({
      legacy_code: p.legacy_code || '',
      product_name: p.product_name,
      carton_quantity: Number(p.carton_quantity) || 0,
      company_name: p.company_name || '',
      piece_price: Number(p.piece_price) || 0,
      dozen_price: Number(p.dozen_price) || 0,
      carton_price: Number(p.carton_price) || 0,
    }))
    exportToExcel({
      title: 'قائمة أسعار البيع',
      subtitle: regionInfo ? `قائمة أسعار — ${regionInfo.label}` : 'أسعار البيع المعتمدة للمنتجات المتاحة للبيع',
      columns,
      data,
      fileName: regionInfo ? `قائمة_أسعار_${regionInfo.name}` : 'قائمة_أسعار_البيع',
      summary: [{ label: 'عدد الأصناف', value: data.length, format: 'number' }],
      filters: [
        `القائمة: ${regionInfo ? regionInfo.label : 'القائمة الأساسية'}`,
        `اسم الشركة: ${companyFilter || 'الكل'}`,
        `نص البحث: ${search.trim() ? `"${search.trim()}"` : 'الكل'}`,
      ],
      columnWidths: [16, 38, 13, 24, 13, 13, 13],
      presentation: { rtl: true, landscape: true, fitToWidth: true, printTitles: true },
    })
  }, [smartFiltered, companyFilter, search, regionInfo])

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
          <div className="flex items-center gap-2">
            {isUpperMgmt && (
              <button
                onClick={handleDownloadExcel}
                disabled={smartFiltered.length === 0}
                className="flex items-center gap-2 bg-white border border-border hover:bg-neutral-50 disabled:bg-text-muted disabled:text-white text-text text-xs px-4 py-2 rounded-lg font-semibold transition-colors shadow-sm"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Excel
              </button>
            )}
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
                  طباعة / حفظ PDF
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-3">
        {isUpperMgmt && (
          <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 bg-card rounded-lg border border-border px-3 py-2">
            <label className="text-[10px] font-semibold text-text-secondary">قائمة الأسعار</label>
            <select
              value={listType}
              onChange={(e) => handleListTypeChange(e.target.value)}
              className="border border-border rounded-lg px-2 py-1.5 text-xs bg-card shrink-0 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="basic">القائمة الأساسية</option>
              <option value="governorate">محافظة</option>
              <option value="sector">قطاع</option>
            </select>
            {listType === 'governorate' && (
              <>
                <label className="text-[10px] font-semibold text-text-secondary">المحافظة</label>
                <select
                  value={selectedGovernorate}
                  onChange={(e) => setSelectedGovernorate(e.target.value)}
                  className="border border-border rounded-lg px-2 py-1.5 text-xs bg-card shrink-0 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">اختر المحافظة...</option>
                  {governorates.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </>
            )}
            {listType === 'sector' && (
              <>
                <label className="text-[10px] font-semibold text-text-secondary">القطاع</label>
                <select
                  value={selectedSector}
                  onChange={(e) => setSelectedSector(e.target.value)}
                  className="border border-border rounded-lg px-2 py-1.5 text-xs bg-card shrink-0 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">اختر القطاع...</option>
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </>
            )}
            {regionInfo && (
              <span className="text-[10px] text-text-muted">
                {geoResolving
                  ? 'جاري تحميل تسعير المنطقة...'
                  : geoOverrideRows.length === 0
                    ? 'لا يوجد تعديل جغرافي — السعر الأساسي'
                    : `تم تطبيق التعديل الجغرافي (${geoOverrideRows.length} قاعدة)`}
              </span>
            )}
          </div>
        )}

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
                  <th className="w-[8%] px-2 py-2 text-center text-[10px] font-semibold text-text-secondary uppercase tracking-wider">الكود</th>
                  <th className="w-[60%] px-3 py-2 text-right text-[10px] font-semibold text-text-secondary uppercase tracking-wider">اسم الصنف</th>
                  <th className="w-[16%] px-2 py-2 text-center text-[10px] font-semibold text-text-secondary uppercase tracking-wider">سعر القطعة</th>
                  <th className="w-[16%] px-2 py-2 text-center text-[10px] font-semibold text-text-secondary uppercase tracking-wider">سعر الكرتونة</th>
                </tr>
              </thead>
              <tbody>
                {groupedProducts.map((group, groupIdx) => (
                  <Fragment key={group.companyName}>
                    <tr>
                      <td colSpan={4} className={`px-3 py-1.5 border-y border-border ${groupIdx % 2 === 0 ? 'bg-[#f8fafc]' : 'bg-[#f7faff]'}`}>
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-sm bg-primary/60" />
                          <span className="text-xs font-bold text-text">{group.companyName}</span>
                          <span className="text-[10px] text-text-muted font-normal">{group.products.length} منتج</span>
                        </div>
                      </td>
                    </tr>
                    {group.products.map((p) => {
                      const rowBg = groupIdx % 2 === 0 ? 'bg-[#f8fafc]' : 'bg-[#f7faff]'
                      return (
                        <tr key={p.id} className={`border-b border-border/50 ${rowBg}`}>
                          <td className="px-1.5 py-1.5 text-center font-mono text-[10px] text-text-muted ltr align-middle">
                            {p.legacy_code || '---'}
                          </td>
                          <td className="px-3 py-1.5 text-right text-xs text-text align-middle">
                            <SearchHighlight text={p.product_name} query={search} />
                          </td>
                          <td className="px-1.5 py-1.5 text-center align-middle">
                            {Number(p.piece_price) > 0 ? (
                              <span className="text-xs font-bold text-text">{formatPrice(Number(p.piece_price))}</span>
                            ) : (
                              <span className="text-text-muted text-[10px]">&mdash;</span>
                            )}
                          </td>
                          <td className="px-1.5 py-1.5 text-center align-middle">
                            {Number(p.carton_price) > 0 ? (
                              <span className="text-xs font-bold text-text">{formatPrice(Number(p.carton_price))}</span>
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
