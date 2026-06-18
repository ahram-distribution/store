import { formatCurrencyShort, formatDate } from '../../utils/format'
import { UNIT_LABELS, ORDER_STATUS_LABELS } from '../../types/order-display'
import type { UnifiedOrder } from '../../types/unified-order'

function esc(s: string | null | undefined): string {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

export function renderPdfHtml(data: UnifiedOrder): string {
  const order = data.order
  const items = data.items
  const now = new Date()
  const statusLabel = ORDER_STATUS_LABELS[order.status] || order.status || 'غير معروف'
  const grandTotal = items.reduce((s, i) => s + Number(i.total_price || 0), 0)

  const customerName = order.snapshot_customer_name || ''
  const customerCode = order.snapshot_customer_code || ''
  const customerPhone = order.snapshot_customer_phone || ''
  const customerAddress = order.snapshot_customer_address || ''
  const ownerName = order.snapshot_owner_name || ''
  const ownerPhone = order.snapshot_owner_phone || ''
  const ownerAddress = order.snapshot_owner_address || ''
  const creatorName = order.snapshot_sender_name || ''
  const creatorPhone = order.snapshot_sender_phone || ''
  const creatorAddress = order.snapshot_sender_address || ''
  const creatorLabel = order.owner_type === 'customer' ? 'عميل'
    : order.created_by === order.owner_id ? 'مندوب مبيعات' : 'موظف'

  function itemsTable(): string {
    let h = '<table><thead><tr><th>كود الصنف</th><th>اسم الصنف</th><th>الشركة</th><th>الوحدة</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>'
    for (const item of items) {
      const qty = Number(item.unit_quantity || 1)
      const price = Number(item.unit_price || 0)
      const lineTotal = qty * price
      const unit = UNIT_LABELS[item.unit_type] || item.unit_type || 'قطعة'
      h += `<tr><td style="font-family:monospace;direction:ltr">${esc(item.legacy_code || 'غير متوفر')}</td><td>${esc(item.product_name)}</td><td>${esc(item.company_name || '')}</td><td>${esc(unit)}</td><td>${qty}</td><td>${formatCurrencyShort(price)}</td><td>${formatCurrencyShort(lineTotal)}</td></tr>`
    }
    h += `</tbody><tfoot><tr class="total-row"><td colspan="6" style="text-align:left">الإجمالي النهائي</td><td>${formatCurrencyShort(grandTotal)}</td></tr></tfoot></table>`
    return h
  }

  const paymentLabel = order.payment_method === 'cash' ? 'نقداً' : order.payment_method === 'credit' ? 'آجل' : order.payment_method || ''

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>فاتورة ${esc(order.order_number)}</title>
<style>
  @page { margin: 1.5cm; size: A4; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 10pt; color: #222; line-height: 1.6; padding: 10px; }
  .header { text-align: center; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 3px double #0052cc; }
  .header .brand { font-size: 18pt; font-weight: 800; color: #0052cc; }
  .header .doc-title { font-size: 12pt; font-weight: 700; color: #333; margin-top: 4px; }
  .header .invoice-num { font-size: 20pt; font-weight: 700; color: #0052cc; margin: 4px 0; }
  .header .meta { font-size: 8pt; color: #9ca3af; }
  .sections { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 18px; }
  .section { flex: 1; min-width: 170px; padding: 10px 12px; background: #f8f9fa; border-radius: 6px; border: 1px solid #e5e7eb; page-break-inside: avoid; }
  .section-title { font-size: 8pt; font-weight: 700; color: #6b7280; margin-bottom: 4px; text-transform: uppercase; }
  .section-body { font-size: 10pt; }
  .section-body div { padding: 2px 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  thead { display: table-header-group; }
  tbody { display: table-row-group; }
  tfoot { display: table-footer-group; }
  th { background: #0052cc; color: #fff; padding: 7px 5px; text-align: center; font-weight: 600; }
  td { padding: 5px; border-bottom: 1px solid #e5e7eb; text-align: center; }
  tbody tr { page-break-inside: avoid; }
  .total-row td { font-weight: 700; border-top: 3px double #0052cc; background: #f0f5ff; padding: 8px 5px; color: #0d2b6b; }
  .footer { text-align: center; margin-top: 24px; font-size: 7pt; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 8px; }
  .badge { display: inline-block; padding: 2px 12px; border-radius: 12px; font-size: 9pt; font-weight: 700; border: 2px solid #0052cc; color: #0052cc; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
<div class="header">
  <div class="brand">شركة الأهرام للتجارة والتوزيع</div>
  <div class="doc-title">فاتورة</div>
  <div class="invoice-num">${esc(order.order_number)}</div>
  <div class="meta">${formatDate(order.created_at)} | <span class="badge">${esc(statusLabel)}</span></div>
</div>
<div class="sections">
  <div class="section"><div class="section-title">العميل</div><div class="section-body">
    <div style="font-weight:700;font-size:11pt">${esc(customerName)}</div>
    ${customerCode ? `<div style="font-size:8pt;color:#6b7280;font-family:monospace" dir="ltr">${esc(customerCode)}</div>` : ''}
    ${customerPhone ? `<div dir="ltr">📞 ${esc(customerPhone)}</div>` : ''}
    ${customerAddress ? `<div>📍 ${esc(customerAddress)}</div>` : ''}
  </div></div>
  <div class="section"><div class="section-title">المسؤول عن العميل</div><div class="section-body">
    <div style="font-weight:700;font-size:11pt">${esc(ownerName || 'غير متوفر')}</div>
    ${ownerPhone ? `<div dir="ltr">📞 ${esc(ownerPhone)}</div>` : ''}
    ${ownerAddress ? `<div>📍 ${esc(ownerAddress)}</div>` : ''}
  </div></div>
  <div class="section"><div class="section-title">مرسل الطلب</div><div class="section-body">
    <div style="font-weight:700;font-size:11pt">${esc(creatorName)}</div>
    <div style="font-size:8pt;color:#6b7280">${creatorLabel}</div>
    ${creatorPhone ? `<div dir="ltr">📞 ${esc(creatorPhone)}</div>` : ''}
    ${creatorAddress ? `<div>📍 ${esc(creatorAddress)}</div>` : ''}
  </div></div>
</div>
${itemsTable()}
<div class="footer"><div>شركة الأهرام للتجارة والتوزيع - جميع الحقوق محفوظة</div><div>تمت الطباعة: ${formatDate(now)}</div></div>
</body></html>`
}

export function printInvoice(html: string) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none'
  document.body.appendChild(iframe)
  const win = iframe.contentWindow
  if (!win) { document.body.removeChild(iframe); return }
  win.document.write(html)
  win.document.close()
  setTimeout(() => { try { win.print() } catch {}; document.body.removeChild(iframe) }, 500)
}
