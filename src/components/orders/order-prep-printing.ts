import { formatDate } from '../../utils/format'
import { formatNumber } from '../../utils/numbers'
import { UNIT_LABELS } from '../../types/order-display'
import type { UnifiedOrder, UnifiedOrderItem } from '../../types/unified-order'
import { printInvoice } from './order-printing'

function esc(s: string | null | undefined): string {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Strip embedded consumer-price suffixes from product names (e.g. "مستهلك230ج")
 * so the operational sheet never shows any price text. Display-only; data is untouched. */
function cleanProductName(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .replace(/\s*مستهلك\s*[0-9۰-۹,]+\s*ج\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Runs inside the printed/downloaded document. Replaces the flowing `.sheet` with
 * explicit A5 `.page` divs so that:
 *  - total page count is computed dynamically,
 *  - the page count line ("عدد صفحات إذن التحضير: N صفحات") shows on page 1 only,
 *  - every page footer shows "صفحة X من Y",
 *  - the table header repeats on every continued page,
 *  - a company heading is kept with its first product row when possible.
 */
const PAGINATION_SCRIPT = `
(function () {
  var MM = 25.4 / 96;
  function mm(px) { return px * MM; }
  var sheet = document.querySelector('.sheet');
  if (!sheet || sheet.getAttribute('data-paginated')) return;
  var USABLE = (210 - 7 - 6 - 6) - 0.5; /* mm for page-body content */
  var head = sheet.querySelector('.head');
  var info = sheet.querySelector('.info');
  var summary = sheet.querySelector('.summary');
  var sigs = sheet.querySelector('.signatures');
  var tbody = sheet.querySelector('.items tbody');
  var thead = sheet.querySelector('.items thead');
  if (!head || !info || !summary || !sigs || !tbody || !thead) return;

  var blocks = [head, info];
  var rows = Array.prototype.slice.call(tbody.children);
  for (var i = 0; i < rows.length; i++) blocks.push(rows[i]);
  blocks.push(summary, sigs);

  var rects = blocks.map(function (el) { return el.getBoundingClientRect(); });
  var sizes = [];
  for (var j = 0; j < blocks.length; j++) {
    if (j < blocks.length - 1) sizes.push(mm(rects[j + 1].top - rects[j].top));
    else sizes.push(mm(rects[j].height));
  }
  /* keep a company heading with its first product row */
  var required = sizes.slice();
  for (var g = 0; g < blocks.length - 1; g++) {
    if (blocks[g].tagName === 'TR' && /group-header/.test(blocks[g].className)) {
      required[g] = sizes[g] + sizes[g + 1];
    }
  }

  var pages = [], cur = [], curH = 0;
  for (var p = 0; p < blocks.length; p++) {
    if (cur.length > 0 && curH + required[p] > USABLE) { pages.push(cur); cur = []; curH = 0; }
    cur.push(p); curH += sizes[p];
  }
  if (cur.length) pages.push(cur);

  var total = pages.length;

  var wrap = document.createElement('div');
  wrap.className = 'prep-pages';
  for (var pg = 0; pg < pages.length; pg++) {
    var page = document.createElement('div');
    page.className = 'page';
    var body = document.createElement('div');
    body.className = 'page-body';
    var tbl = null;
    for (var k = 0; k < pages[pg].length; k++) {
      var bi = pages[pg][k];
      var blk = blocks[bi];
      if (blk.tagName === 'TR') {
        if (!tbl) {
          tbl = document.createElement('table');
          tbl.className = 'items';
          tbl.appendChild(thead.cloneNode(true));
          var tb = document.createElement('tbody');
          tbl.appendChild(tb);
          body.appendChild(tbl);
        }
        tbl.lastChild.appendChild(blk);
      } else {
        tbl = null;
        body.appendChild(blk);
      }
    }
    var foot = document.createElement('div');
    foot.className = 'page-footer';
    foot.textContent = '\u0635\u0641\u062d\u0629 ' + (pg + 1) + ' \u0645\u0646 ' + total;
    page.appendChild(body);
    page.appendChild(foot);
    wrap.appendChild(page);
  }

  var countEl = head.querySelector('.page-count');
  if (countEl) {
    countEl.innerHTML = '\u0639\u062f\u062f \u0635\u0641\u062d\u0627\u062a \u0625\u0630\u0646 \u0627\u0644\u062a\u062d\u0636\u064a\u0631: <b>' + total + '</b> ' + (total === 1 ? '\u0635\u0641\u062d\u0629' : '\u0635\u0641\u062d\u0627\u062a');
  }

  sheet.setAttribute('data-paginated', '1');
  sheet.parentNode.replaceChild(wrap, sheet);
})();
`

/**
 * "إذن تحضير للمخزن" — internal A5 warehouse preparation sheet (print-first, B&W).
 * Operational form, NOT an invoice: no logo, no prices, no financial totals.
 * RTL column order (right → left):
 * كود الصنف | اسم الصنف | الكمية | الوحدة | تم التحضير | تمت المراجعة
 * so the two manual checkbox columns sit on the LEFT.
 */
export function renderPreparationPermitHtml(data: UnifiedOrder): string {
  const order = data.order
  const items = data.items
  const lc = data.customer
  const useLive = order.status !== 'delivered' && lc

  const customerName = useLive ? (lc.company_name || '') : (order.snapshot_customer_name || '')
  const customerPhone = useLive ? (lc.phone || '') : (order.snapshot_customer_phone || '')
  const customerAddress = useLive
    ? [lc.governorate, lc.city, lc.address_line1, lc.address_line2].filter(Boolean).join(' - ')
    : (order.snapshot_customer_address || '')
  const repName = order.order_creator_name || order.snapshot_sender_name || ''

  const groups: { company: string; items: UnifiedOrderItem[] }[] = (() => {
    const map: Record<string, { company: string; items: UnifiedOrderItem[] }> = {}
    for (const item of items) {
      const companyName = item.company_name || 'أخرى'
      if (!map[companyName]) map[companyName] = { company: companyName, items: [] }
      map[companyName].items.push(item)
    }
    return Object.values(map)
  })()

  const totalPieces = items.reduce((s, i) => s + num(i.piece_quantity), 0)

  function itemsTable(): string {
    let h = '<table class="items"><thead><tr>'
    h += '<th class="col-code">كود الصنف</th>'
    h += '<th class="col-name">اسم الصنف</th>'
    h += '<th class="col-qty">الكمية</th>'
    h += '<th class="col-unit">الوحدة</th>'
    h += '<th class="col-chk">تم التحضير</th>'
    h += '<th class="col-chk">تمت المراجعة</th>'
    h += '</tr></thead><tbody>'
    for (const g of groups) {
      const pieces = g.items.reduce((s, i) => s + num(i.piece_quantity), 0)
      h += `<tr class="group-header"><td colspan="6"><div class="group-head-line"><span class="group-company">شركة: ${esc(g.company)}</span><span class="group-totals"><span class="g-total-label">إجمالي الأصناف: ${g.items.length}</span><span class="g-total-sep">|</span><span class="g-total-label">إجمالي القطع: ${formatNumber(pieces)}</span></span></div></td></tr>`
      for (const item of g.items) {
        const qty = num(item.unit_quantity)
        const unit = UNIT_LABELS[item.unit_type] || item.unit_type || 'قطعة'
        h += `<tr class="item-row">`
        h += `<td class="col-code" style="font-family:monospace;direction:ltr">${esc(item.legacy_code || 'غير متوفر')}</td>`
        h += `<td class="col-name">${esc(cleanProductName(item.product_name))}</td>`
        h += `<td class="col-qty num">${formatNumber(qty)}</td>`
        h += `<td class="col-unit">${esc(unit)}</td>`
        h += `<td class="col-chk"><span class="chk-box"></span></td>`
        h += `<td class="col-chk"><span class="chk-box"></span></td>`
        h += `</tr>`
      }
    }
    h += '</tbody></table>'
    return h
  }

  function infoBlock(): string {
    const rightCol = `
      ${customerName ? `<div class="info-line"><span class="label">العميل:</span> <span class="value">${esc(customerName)}</span></div>` : ''}
      ${customerPhone ? `<div class="info-line"><span class="label">الهاتف:</span> <span class="value" dir="ltr">${esc(customerPhone)}</span></div>` : ''}
      ${customerAddress ? `<div class="info-line"><span class="label">العنوان:</span> <span class="value">${esc(customerAddress)}</span></div>` : ''}
    `
    const leftCol = `
      ${repName ? `<div class="info-line"><span class="label">المندوب:</span> <span class="value">${esc(repName)}</span></div>` : ''}
    `
    return `<div class="info">
      <div class="info-col">${rightCol}</div>
      <div class="info-col">${leftCol}</div>
    </div>`
  }

  function summarySection(): string {
    return `<table class="summary">
      <tr>
        <td><span class="s-label">عدد الشركات</span><span class="s-value">${groups.length}</span></td>
        <td><span class="s-label">عدد الأصناف</span><span class="s-value">${items.length}</span></td>
        <td><span class="s-label">إجمالي القطع</span><span class="s-value">${formatNumber(totalPieces)}</span></td>
      </tr>
    </table>`
  }

  function signatureBlock(title: string): string {
    return `<div class="sig-box">
      <div class="sig-title">${title}</div>
      <div class="sig-line">الاسم: <span class="sig-underline">${'_________________________________'.slice(0, 33)}</span></div>
      <div class="sig-line">التوقيع: <span class="sig-underline">${'_________________________________'.slice(0, 29)}</span></div>
      <div class="sig-line">التاريخ: __ / __ / ____</div>
    </div>`
  }

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>إذن تحضير للمخزن ${esc(order.order_number)}</title>
<style>
  @page { size: A5 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Cairo', 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 7.5pt; color: #000; line-height: 1.35; background: #fff; }
  .sheet { width: 148mm; padding: 7mm 7mm 6mm; background: #fff; }

  /* ── Compact header (no logo) ── */
  .head { border-bottom: 1px solid #000; padding-bottom: 1.4mm; }
  .head-row { display: flex; justify-content: space-between; align-items: baseline; }
  .brand { font-size: 9.5pt; font-weight: 800; }
  .title { font-size: 10.5pt; font-weight: 800; }
  .meta { display: flex; justify-content: space-between; font-size: 7pt; margin-top: 1.2mm; }
  .page-count { margin-top: 1.2mm; font-size: 7pt; font-weight: 700; text-align: center; }

  /* ── Order / customer info ── */
  .info { display: flex; justify-content: space-between; gap: 3mm; border: 1px solid #000; padding: 1.8mm 2.5mm; margin: 2.5mm 0; }
  .info-col { display: flex; flex-direction: column; gap: 0.8mm; }
  .info-line { font-size: 7.5pt; }
  .info-line .label { font-weight: 700; }

  /* ── Product table (light gray header, black text, thin borders) ── */
  table.items { width: 100%; border-collapse: collapse; margin: 2.5mm 0 0; }
  thead { display: table-header-group; }
  tbody { display: table-row-group; }
  th { background: #E6E6E6; color: #000; font-weight: 700; font-size: 7pt; padding: 1.4mm 0.6mm !important; text-align: center; border: 0.5px solid #000; }
  td { padding: 1.3mm 0.6mm !important; border: 0.5px solid #666; text-align: center; vertical-align: middle; font-size: 7.5pt; }
  .col-code { width: 13%; }
  .col-name { width: 44%; text-align: right; }
  .col-unit { width: 10%; }
  .col-qty { width: 9%; }
  .col-chk { width: 12%; }
  .num { font-weight: 700; }
  .chk-box { display: inline-block; width: 4.5mm; height: 4.5mm; border: 1px solid #000; background: #fff; }

  /* ── Company grouping (light gray / white, no dark fills) ── */
  .group-header td { background: #F2F2F2; font-weight: 700; text-align: right; font-size: 7.5pt; border: 0.5px solid #666; padding: 1.4mm 0.6mm; }
  .group-head-line { display: flex; flex-direction: row; align-items: baseline; justify-content: space-between; gap: 4mm; width: 100%; }
  .group-company { font-weight: 800; white-space: normal; overflow: visible; }
  .group-totals { white-space: nowrap; flex: none; }
  .g-total-label { font-weight: 700; }
  .g-total-sep { margin: 0 2.5mm; color: #000; }

  /* ── Overall summary (simple bordered table) ── */
  table.summary { width: 100%; border-collapse: collapse; margin: 2.5mm 0 0; }
  table.summary td { border: 0.5px solid #000; text-align: center; padding: 1.6mm 1mm; }
  .s-label { display: block; font-size: 6.5pt; font-weight: 700; }
  .s-value { display: block; font-size: 9.5pt; font-weight: 800; }

  /* ── Signatures (preparer right, reviewer left) ── */
  .signatures { display: flex; gap: 3mm; margin: 2.5mm 0 0; }
  .sig-box { flex: 1; border: 1px solid #000; padding: 2mm 2.5mm; }
  .sig-title { text-align: center; font-weight: 800; font-size: 8pt; margin-bottom: 1.5mm; }
  .sig-line { font-size: 7pt; margin: 1.4mm 0; }
  .sig-underline { font-family: 'Courier New', monospace; letter-spacing: 0; }

  /* ── Explicit pages ── */
  .prep-pages { }
  .page { width: 148mm; height: 210mm; padding: 7mm 7mm 6mm; page-break-after: always; display: flex; flex-direction: column; background: #fff; }
  .page:last-child { page-break-after: auto; }
  .page-body { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .page-footer { flex: 0 0 auto; height: 6mm; line-height: 6mm; text-align: center; font-size: 6.5pt; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
<div class="sheet">

  <div class="head">
    <div class="head-row">
      <div class="brand">شركة الأهرام للتجارة والتوزيع</div>
      <div class="title">إذن تحضير للمخزن</div>
    </div>
    <div class="meta">
      <div class="doc-num">رقم الطلب: ${esc(order.order_number)}</div>
      <div class="doc-date">تاريخ الطلب: ${formatDate(order.created_at)}</div>
    </div>
    <div class="page-count">عدد صفحات إذن التحضير: <b>&mdash;</b></div>
  </div>

  ${infoBlock()}

  ${itemsTable()}

  ${summarySection()}

  <div class="signatures">
    ${signatureBlock('توقيع المحضر')}
    ${signatureBlock('توقيع المراجع')}
  </div>

</div>
<script>${PAGINATION_SCRIPT}<\/script>
</body></html>`
}

export function printPreparationPermit(data: UnifiedOrder) {
  printInvoice(renderPreparationPermitHtml(data))
}

export async function downloadPreparationPermitPdf(data: UnifiedOrder) {
  const html = renderPreparationPermitHtml(data)
  const html2canvas = (await import('html2canvas')).default
  const { jsPDF } = await import('jspdf')

  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:148mm;background:#fff;direction:rtl'
  Array.from(parsed.querySelectorAll('style')).forEach((s) => container.appendChild(s.cloneNode(true)))
  container.innerHTML += parsed.body.innerHTML
  document.body.appendChild(container)

  const inlineScript = container.querySelector('script')
  if (inlineScript) {
    const run = document.createElement('script')
    run.textContent = inlineScript.textContent
    container.appendChild(run)
  }

  await (document.fonts?.ready || Promise.resolve())
  await new Promise((r) => setTimeout(r, 300))

  const pageEls = Array.from(container.querySelectorAll('.page'))
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' })
  const pdfW = pdf.internal.pageSize.getWidth()
  const pdfH = pdf.internal.pageSize.getHeight()

  for (let i = 0; i < pageEls.length; i++) {
    const canvas = await html2canvas(pageEls[i] as HTMLElement, { scale: 2, useCORS: true, logging: false })
    const imgData = canvas.toDataURL('image/jpeg', 0.95)
    if (i > 0) pdf.addPage([pdfW, pdfH], 'portrait')
    pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH)
  }

  document.body.removeChild(container)

  const custName = (data.customer?.company_name || data.order.snapshot_customer_name || 'عميل').replace(/[\\/:*?"<>|]/g, '_')
  const createdDate = new Date(data.order.created_at).toLocaleDateString('ar-EG-u-nu-latn')
  pdf.save(`إذن تحضير - ${custName} - ${createdDate}.pdf`)
}
