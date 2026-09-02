import * as XLSX from 'xlsx'

// =============================================================================
// Product Excel Import — parse → validate → match → preview
// -----------------------------------------------------------------------------
// Reads a spreadsheet with (at minimum) the three columns:
//   1. كود الصنف      (product code → matched by legacy_code)
//   2. سعر الكرتونه/ة  (carton price)
//   3. الكمية بالكرتونة OR إجمالى الكمية (carton quantity — may be fractional)
//
// Matching is by legacy_code ONLY (exact normalized equality). Unknown codes are
// ignored + counted, never created. Invalid rows (missing/non-numeric/negative
// values) are rejected and reported — they are excluded from the approved batch.
// =============================================================================

export type ImportRow = {
  rowIndex: number // 1-based Excel row number (for display)
  code: string
  cartons: number | null
  cartonPrice: number | null
  productName?: string // informational (from header اسم الصنف) — never used for matching
  companyName?: string // informational (from header الشركة) — never used for matching
}

export type MatchedPreviewRow = {
  rowIndex: number
  code: string
  productName: string
  companyName: string
  productId: string
  cartons: number // the Excel carton quantity (may be fractional)
  cartonQuantity: number | null
  currentPieces: number
  newPieces: number
  currentPrice: number | null
  newPrice: number
  currentStatus: string // 'نشط' | 'نفذت الكمية' | 'مخفي'
  newStatus: string // 'نشط' when newPieces > 0 (price validated), otherwise 'نفذت الكمية'
}

export type InvalidPreviewRow = {
  rowIndex: number
  code: string
  reason: string
}

// A database product whose legacy_code is absent from the Excel file. Per the
// "complete current stock list" rule: stock → 0 and status → "مخفي".
export type MissingProductRow = {
  code: string
  productName: string
  companyName: string
  productId: string
  currentPieces: number
  currentStatus: string // 'نشط' | 'نفذت الكمية' | 'مخفي'
  newStatus: string // always 'مخفي'
  needsChange: boolean // true when a write is needed (stock>0 or not already hidden)
}

export type ImportPreview = {
  matched: MatchedPreviewRow[] // will apply on approval
  unmatched: UnmatchedRow[] // unknown legacy codes (need coding) — informational, never created
  invalid: InvalidPreviewRow[] // rejected — excluded from the batch
  excelCodes: string[] // every distinct normalized code present in the Excel file
  missing: MissingProductRow[] // DB products absent from Excel → will be zeroed
}

// An Excel row whose legacy_code does not exist in the database. These are
// products that require product coding in the DB first. They are never created
// automatically and are excluded from the approval/write payload. Sorted by
// code ascending for review.
export type UnmatchedRow = {
  rowIndex: number
  code: string
  cartons: number | null // quantity read from Excel
  cartonPrice: number | null // carton price read from Excel
  productName?: string // informational from Excel (never used for matching)
  companyName?: string // informational from Excel (never used for matching)
}

// -----------------------------------------------------------------------------
// Arabic header normalization:
//   ة → ه  ، ى → ي  ، أ/آ/إ → ا  ، strip spaces/diacritics, lowercase.
// Lets us treat "سعر الكرتونه"/"سعر الكرتونة" and "إجمالى الكمية" alike.
// -----------------------------------------------------------------------------
export function normalizeHeader(s: string): string {
  return (s || '')
    .replace(/[\u064B-\u0652]/g, '') // Arabic diacritics
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/[\u0623\u0622\u0625]/g, 'ا')
    .replace(/[\s\-_/]/g, '')
    .toLowerCase()
}

const CODE_HEADERS = new Set(['كودالصنف', 'الكود', 'code', 'كود', 'كودالمنتج'])
const PRICE_HEADERS = new Set(['سعرالكرتونه', 'سعرالكرتون', 'سعرالكرتونهs'])
const QTY_HEADERS = new Set(['اجماليالكميه', 'الكميهبالكرتونه', 'الكميهبالكرتون', 'الكميه', 'كميهالكترون', 'اجماليالكميهبالكرتونه'])
// Informational columns from the official template (اسم الصنف / الشركة). They are
// NEVER used as the product identity — only surfaced for display in the review.
const NAME_HEADERS = new Set(['اسمالصنف', 'اسمالمنتج', 'الصنف', 'اسم'])
const COMPANY_HEADERS = new Set(['الشركه', 'شركه', 'اسمالشركه'])

export class ColumnDetectionError extends Error {}

interface DetectedColumns { code: number; price: number; qty: number; name: number; company: number }

function detectColumns(headers: (string | number | null)[]): DetectedColumns {
  const roles: { key: 'code' | 'price' | 'qty' | 'name' | 'company'; set: Set<string> }[] = [
    { key: 'code', set: CODE_HEADERS },
    { key: 'price', set: PRICE_HEADERS },
    { key: 'qty', set: QTY_HEADERS },
    { key: 'name', set: NAME_HEADERS },
    { key: 'company', set: COMPANY_HEADERS },
  ]
  // role -> list of column indices that matched it
  const found = new Map<string, number[]>()
  headers.forEach((h, i) => {
    const norm = normalizeHeader(String(h ?? '').trim())
    if (!norm) return
    for (const { key, set } of roles) {
      if (set.has(norm)) {
        const arr = found.get(key) ?? []
        arr.push(i)
        found.set(key, arr)
        break
      }
    }
  })

  const label: Record<string, string> = {
    code: 'كود الصنف',
    price: 'سعر الكرتونة',
    qty: 'الكمية بالكرتونة',
  }

  for (const key of ['code', 'price', 'qty'] as const) {
    const cols = found.get(key) ?? []
    if (cols.length === 0) {
      throw new ColumnDetectionError(`لم يتم العثور على عمود (${label[key]}) في الملف — لا يمكن الاستيراد بدون هذا العمود`)
    }
    if (cols.length > 1) {
      throw new ColumnDetectionError(`عمود (${label[key]}) غير محسوم — توجد أكثر من خانة تحمل هذا المعنى في رأس الملف. رجّع الملف الأصلي أو أزل التكرار`)
    }
  }

  // Informational columns are optional; ambiguity here is not fatal for the
  // required columns but we still refuse when the code column is ambiguous.
  return {
    code: found.get('code')![0],
    price: found.get('price')![0],
    qty: found.get('qty')![0],
    name: (found.get('name') ?? [])[0] ?? -1,
    company: (found.get('company') ?? [])[0] ?? -1,
  }
}

function toNumber(v: any): number | null {
  if (v === undefined || v === null) return null
  if (typeof v === 'number') return v
  const s = String(v).trim().replace(/,/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function toCode(v: any): string {
  if (v === undefined || v === null) return ''
  return String(v).trim()
}

export function parseProductExcelFile(file: File): Promise<ImportRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('تعذر قراءة الملف'))
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result as ArrayBuffer, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as (any)[][]
        if (!aoa.length) { resolve([]); return }

        const headers = aoa[0]
        const { code: ci, price: pci, qty: qci, name: nci, company: cc } = detectColumns(headers as (string | number | null)[])

        const rows: ImportRow[] = []
        for (let i = 1; i < aoa.length; i++) {
          const raw = aoa[i] || []
          const rowIndex = i + 1
          const code = toCode(raw[ci])
          // A fully empty physical row → skip silently (no phantom invalid rows)
          const hasAny = (raw as any[]).some((c) => c !== null && c !== undefined && String(c).trim() !== '')
          if (!hasAny) continue
          rows.push({
            rowIndex,
            code,
            cartons: toNumber(raw[qci]),
            cartonPrice: toNumber(raw[pci]),
            productName: nci >= 0 ? toCode(raw[nci]) : undefined,
            companyName: cc >= 0 ? toCode(raw[cc]) : undefined,
          })
        }
        resolve(rows)
      } catch (e) {
        reject(e instanceof Error ? e : new Error('تعذر تحليل ملف Excel'))
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

// Mirrors the manager page's 3-state status model (same authoritative fields
// is_out_of_stock / is_active / is_visible used by the edit screen).
export function productStatusLabel(p: any): string {
  if (p.is_out_of_stock === true && p.is_active !== false) return 'نفذت الكمية'
  if (!p.is_active || p.is_visible === false) return 'مخفي'
  return 'نشط'
}

export function buildImportPreview(rows: ImportRow[], products: any[]): ImportPreview {
  // Every distinct code present in the Excel file (matched or not) — this is
  // the "complete current stock list" used to detect absent products.
  const excelSet = new Set<string>()
  for (const r of rows) {
    if (r.code !== '') excelSet.add(r.code)
  }
  const excelCodes = Array.from(excelSet)

  // Index products by normalized legacy_code for fast exact matching.
  const byCode = new Map<string, any>()
  for (const p of products) {
    const key = String(p?.legacy_code ?? '').trim()
    if (key !== '' && !byCode.has(key)) byCode.set(key, p)
  }

  const matched: MatchedPreviewRow[] = []
  const unmatched: UnmatchedRow[] = []
  const invalid: InvalidPreviewRow[] = []

  for (const r of rows) {
    if (r.code === '') {
      invalid.push({ rowIndex: r.rowIndex, code: '', reason: 'الكود الصنف فارغ' })
      continue
    }
    if (r.cartons === null) {
      invalid.push({ rowIndex: r.rowIndex, code: r.code, reason: 'الكمية غير صالحة أو فارغة' })
      continue
    }
    if (r.cartons < 0) {
      invalid.push({ rowIndex: r.rowIndex, code: r.code, reason: 'الكمية بالسالب' })
      continue
    }
    if (r.cartonPrice === null) {
      invalid.push({ rowIndex: r.rowIndex, code: r.code, reason: 'سعر الكرتونة غير صالح أو فارغ' })
      continue
    }
    if (r.cartonPrice < 0) {
      invalid.push({ rowIndex: r.rowIndex, code: r.code, reason: 'سعر الكرتونة بالسالب' })
      continue
    }
    if (r.cartons > 0 && r.cartonPrice <= 0) {
      invalid.push({ rowIndex: r.rowIndex, code: r.code, reason: 'سعر الكرتونة يجب أن يكون أكبر من صفر' })
      continue
    }

    const product = byCode.get(r.code)
    if (!product) {
      unmatched.push({
        rowIndex: r.rowIndex,
        code: r.code,
        cartons: r.cartons,
        cartonPrice: r.cartonPrice,
        productName: r.productName,
        companyName: r.companyName,
      })
      continue
    }

    const cartonQty = Number(product.carton_quantity) || 0
    const currentPieces = Number(product.inventory?.quantity) || 0
    const newPieces = cartonQty > 0 ? Math.round(r.cartons * cartonQty) : currentPieces

    matched.push({
      rowIndex: r.rowIndex,
      code: r.code,
      productName: product.product_name || '',
      companyName: product.company_name || '',
      productId: product.id,
      cartons: r.cartons,
      cartonQuantity: cartonQty > 0 ? cartonQty : null,
      currentPieces,
      newPieces,
      currentPrice: product.carton_price != null ? Number(product.carton_price) : null,
      newPrice: r.cartonPrice,
      currentStatus: productStatusLabel(product),
      newStatus: newPieces > 0 ? 'نشط' : 'نفذت الكمية',
    })
  }

  // ABSENT PRODUCTS: every existing DB product whose legacy_code is absent
  // from the Excel file → stock becomes 0 and status becomes "مخفي".
  const missing: MissingProductRow[] = []
  if (excelSet.size > 0) {
    for (const p of products) {
      const key = String(p?.legacy_code ?? '').trim()
      if (key === '' || excelSet.has(key)) continue
      const currentPieces = Number(p?.inventory?.quantity) || 0
      const currentStatus = productStatusLabel(p)
      missing.push({
        code: key,
        productName: p?.product_name || '',
        companyName: p?.company_name || '',
        productId: p?.id,
        currentPieces,
        currentStatus,
        newStatus: 'مخفي',
        needsChange: currentPieces > 0 || currentStatus !== 'مخفي',
      })
    }
  }

  // Excel products requiring coding — displayed in a review table, never created.
  unmatched.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }))

  return { matched, unmatched, invalid, excelCodes, missing }
}
