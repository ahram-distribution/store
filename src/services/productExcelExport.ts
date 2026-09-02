import * as XLSX from 'xlsx'
import { applyExcelPresentation, XL } from './excelStyling'

// =============================================================================
// Product Stock & Price Excel Template — EXPORT
// -----------------------------------------------------------------------------
// Produces a professional, Arabic-first .xlsx snapshot of the CURRENT catalog
// (data scope = whatever the caller already holds from get_governed_products,
// i.e. the products the user is authorized to manage). The user edits the
// quantity and carton price, saves, and re-imports the file.
//
// Matching is by كود الصنف (legacy_code) ONLY. اسم الصنف and الشركة are
// informational for the user's own reference and are never used as identity.
//
// This is a pure data/template export — it never touches the database.
// =============================================================================

export interface ProductTemplateRow {
  code: string
  productName: string
  companyName: string
  cartonQuantity: number | null // pieces per carton (product.carton_quantity)
  quantityCartons: number // current stock expressed in cartons (may be fractional; matches import semantics)
  cartonPrice: number | null
}

/** Official export headers (system-authored). Import recognises them robustly. */
export const PRODUCT_TEMPLATE_HEADERS = [
  'كود الصنف',
  'اسم الصنف',
  'الشركة',
  'الكمية بالكرتونة',
  'سعر الكرتونة',
] as const

/**
 * Build the export row for a governed product. Stock is expressed in cartons
 * (currentPieces / piecesPerCarton) which mirrors how the importer interprets
 * الكمية بالكرتونة, so a round-trip (export → edit → import) is stable.
 * When a product has no carton definition the raw piece count is emitted so the
 * value is still meaningful and re-importing it leaves the stock unchanged.
 */
export function toProductTemplateRow(p: any): ProductTemplateRow {
  const cartonQuantity = Number(p?.carton_quantity) || 0
  const currentPieces = Number(p?.inventory?.quantity) || 0
  const quantityCartons = cartonQuantity > 0
    ? currentPieces / cartonQuantity
    : currentPieces
  const price = p?.carton_price
  return {
    code: String(p?.legacy_code ?? '').trim(),
    productName: p?.product_name || '',
    companyName: p?.company_name || '',
    cartonQuantity: cartonQuantity > 0 ? cartonQuantity : null,
    quantityCartons,
    cartonPrice: price != null && price !== '' ? Number(price) : null,
  }
}

function downloadBlob(bytes: ArrayBuffer, fileName: string): void {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Generate and download the professional stock/price template.
 * - RTL worksheet (Arabic-first).
 * - Header row on row 1, frozen.
 * - Auto-filter over the full data range.
 * - Quantity / price as real numbers with clean numeric formats.
 * - Readable column widths; no merged cells inside the data table.
 * - No title/decoration rows above the table (keeps filter/sort 100% clean).
 */
export function exportProductStockTemplate(products: any[]): { fileName: string; rows: number } {
  const rows = (products || []).map(toProductTemplateRow)

  const ws = XLSX.utils.json_to_sheet([])

  // Header row (system-authored Arabic headers).
  XLSX.utils.sheet_add_aoa(ws, [PRODUCT_TEMPLATE_HEADERS as unknown as string[]], { origin: 'A1' })

  // Data rows (simple AOA — numeric cells stay numeric).
  const body: (string | number | null)[][] = rows.map((r) => [
    r.code,
    r.productName,
    r.companyName,
    r.quantityCartons,
    r.cartonPrice,
  ])
  if (body.length) {
    XLSX.utils.sheet_add_aoa(ws, body, { origin: 'A2' })
  }

  const lastRow = 1 + body.length
  const lastCol = PRODUCT_TEMPLATE_HEADERS.length - 1

  // Column widths: code narrow-ish, name/company wide, numbers comfortable.
  ws['!cols'] = [
    { wch: 14 }, // كود الصنف
    { wch: 36 }, // اسم الصنف
    { wch: 26 }, // الشركة
    { wch: 16 }, // الكمية بالكرتونة
    { wch: 16 }, // سعر الكرتونة
  ]
  ws['!freeze'] = { x: 0, y: 1 }
  ws['!autofilter'] = {
    ref: `A1:${XLSX.utils.encode_cell({ r: lastRow - 1, c: lastCol })}`,
  }
  // No merges — keeps filtering/sorting clean.

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'المخزون والأسعار')
  wb.Workbook = { Views: [{ RTL: true }] }

  const numberFormatFor = (col: number) => (col === 3 || col === 4 ? XL.DATA_BASE_NUM : XL.DATA_BASE_TEXT)

  const enc = XLSX.utils.encode_col
  const styleByCell = new Map<string, number>()
  const setCell = (r: number, c: number, s: number) => styleByCell.set(`${enc(c)}${r + 1}`, s)
  // Header styling.
  for (let c = 0; c < PRODUCT_TEMPLATE_HEADERS.length; c++) setCell(0, c, XL.HEADER)
  // Body styling (striped, numeric for qty & price).
  body.forEach((_row, di) => {
    const r = di + 1
    for (let c = 0; c < PRODUCT_TEMPLATE_HEADERS.length; c++) {
      setCell(r, c, di % 2 === 0 ? numberFormatFor(c) : (c === 3 || c === 4 ? XL.DATA_STRIPE_NUM : XL.DATA_STRIPE_TEXT))
    }
  })

  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const styled = applyExcelPresentation(buffer, {
    rtl: true,
    landscape: false,
    fitToWidth: true,
    freezeRows: 1,
    printTitleRow: 1,
    sheetName: 'المخزون والأسعار',
    styleByCell,
  })

  const datePart = new Date().toISOString().slice(0, 10)
  const fileName = `قالب_المخزون_والأسعار_${datePart}.xlsx`
  downloadBlob(styled, fileName)
  return { fileName, rows: body.length }
}