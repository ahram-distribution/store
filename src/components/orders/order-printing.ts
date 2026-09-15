import { formatCurrencyShort, formatDate } from '../../utils/format'
import { formatNumber } from '../../utils/numbers'
import { UNIT_LABELS, ORDER_STATUS_LABELS } from '../../types/order-display'
import type { UnifiedOrder } from '../../types/unified-order'
import { buildOrderFinancialPresentation } from '../../utils/order-benefit-presentation'

function esc(s: string | null | undefined): string {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

export function renderPdfHtml(data: UnifiedOrder): string {
  const order = data.order
  const items = data.items
  const lc = data.customer
  const useLive = order.status !== 'delivered' && lc
  const now = new Date()
  const statusLabel = ORDER_STATUS_LABELS[order.status] || order.status || 'غير معروف'
  const grandTotal = items.reduce((s, i) => s + Number(i.total_price || 0), 0)

  const netTotal = Number(order.total_amount ?? (grandTotal - Number(order.discount_amount || 0)))
  const hasNetItems = items.length > 0 && items.some((i: any) => {
    const base = Number(i.base_unit_price ?? 0)
    const unit = Number(i.unit_price ?? 0)
    return base > 0 && Math.abs(base - unit) > 0.009
  })
  const netFactor = !hasNetItems && grandTotal > 0 && netTotal > 0 && netTotal < grandTotal ? netTotal / grandTotal : 1
  const net = (amount: number) => Math.round(amount * netFactor * 100) / 100

  const customerName = useLive ? (lc.company_name || '') : (order.snapshot_customer_name || '')
  const customerCode = useLive ? (lc.code || '') : (order.snapshot_customer_code || '')
  const customerPhone = useLive ? (lc.phone || '') : (order.snapshot_customer_phone || '')
  const customerAddress = useLive ? [lc.governorate, lc.city, lc.address_line1, lc.address_line2].filter(Boolean).join(' - ') : (order.snapshot_customer_address || '')
  const ownerName = order.snapshot_owner_name || ''
  const ownerPhone = order.snapshot_owner_phone || ''
  const ownerAddress = order.snapshot_owner_address || ''
  const creatorName = order.snapshot_sender_name || ''
  const creatorPhone = order.snapshot_sender_phone || ''
  const creatorAddress = order.snapshot_sender_address || ''
  const creatorLabel = order.owner_type === 'customer' ? 'عميل'
    : order.order_creator_id === order.owner_id ? 'مندوب مبيعات' : 'موظف'

  function itemsTable(): string {
    let h = '<table><thead><tr><th>كود الصنف</th><th>اسم الصنف</th><th>الشركة</th><th>الوحدة</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>'
    for (const item of items) {
      const qty = Number(item.unit_quantity || 1)
      const price = Number(item.unit_price || 0)
      const lineTotal = qty * price
      const unit = UNIT_LABELS[item.unit_type] || item.unit_type || 'قطعة'
      h += `<tr><td style="font-family:monospace;direction:ltr">${esc(item.legacy_code || 'غير متوفر')}</td><td>${esc(item.product_name)}</td><td>${esc(item.company_name || '')}</td><td>${esc(unit)}</td><td>${qty}</td><td>${formatCurrencyShort(net(price))}</td><td>${formatCurrencyShort(net(lineTotal))}</td></tr>`
    }
    h += `</tbody><tfoot><tr class="total-row"><td colspan="6" style="text-align:left">الإجمالي النهائي</td><td>${formatCurrencyShort(net(grandTotal))}</td></tr></tfoot></table>`
    return h
  }

  const paymentLabel = order.payment_method === 'cash' ? 'نقداً' : order.payment_method === 'ittiman' ? 'ائتمان' : order.payment_method || ''

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

export function renderDeliveryPermitHtml(data: UnifiedOrder, logoUrl?: string): string {
  const order = data.order
  const items = data.items
  const lc = data.customer
  const useLive = order.status !== 'delivered' && lc
  const now = new Date()

  const customerName = useLive ? (lc.company_name || '') : (order.snapshot_customer_name || '')
  const customerPhone = useLive ? (lc.phone || '') : (order.snapshot_customer_phone || '')
  const customerAddress = useLive ? [lc.governorate, lc.city, lc.address_line1, lc.address_line2].filter(Boolean).join(' - ') : (order.snapshot_customer_address || '')
  const repName = order.order_creator_name || order.snapshot_sender_name || ''
  const paymentLabel = order.payment_method === 'cash' ? 'نقداً' : order.payment_method === 'ittiman' ? 'ائتمان' : order.payment_method || ''

  const grandTotal = items.reduce((s, i) => s + Number(i.total_price || 0), 0)
  const totalPieces = items.reduce((s, i) => s + Number(i.piece_quantity || 0), 0)
  const totalQty = items.reduce((s, i) => s + Number(i.unit_quantity || 0), 0)

  const financial = buildOrderFinancialPresentation(order, items)
  const statusLabel = ORDER_STATUS_LABELS[order.status] || order.status || ''
  const effectivePercent = financial.mode !== 'none'
    ? (financial.effectivePercent > 0 ? financial.effectivePercent : Number(order.effective_discount_percent || 0))
    : 0

  const netTotal = Number(order.total_amount ?? (grandTotal - Number(order.discount_amount || 0)))
  const hasNetItems = items.length > 0 && items.some((i: any) => {
    const base = Number(i.base_unit_price ?? 0)
    const unit = Number(i.unit_price ?? 0)
    return base > 0 && Math.abs(base - unit) > 0.009
  })
  const netFactor = !hasNetItems && grandTotal > 0 && netTotal > 0 && netTotal < grandTotal ? netTotal / grandTotal : 1
  const net = (amount: number) => Math.round(amount * netFactor * 100) / 100

  const finalTotal = financial.mode !== 'none' && financial.finalTotal > 0 ? financial.finalTotal : Number(order.total_amount ?? 0) || net(grandTotal)

  const groups = () => {
    const map: Record<string, { company: string; items: typeof items; subtotal: number }> = {}
    for (const item of items) {
      if (item.is_bonus === true) continue
      const companyName = item.company_name || 'أخرى'
      if (!map[companyName]) map[companyName] = { company: companyName, items: [], subtotal: 0 }
      map[companyName].items.push(item)
      map[companyName].subtotal += Number(item.total_price || 0)
    }
    return Object.values(map)
  }

  const bonusItems = items.filter((i) => i.is_bonus === true)

  function itemsTable(): string {
    const gs = groups()
    let h = '<table><thead><tr><th>كود الصنف</th><th>اسم الصنف</th><th>الوحدة</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>'
    for (const g of gs) {
      h += `<tr class="group-header"><td colspan="6">${esc(g.company)} (${g.items.length})</td></tr>`
      for (const item of g.items) {
        const qty = Number(item.unit_quantity || 1)
        const price = Number(item.unit_price || 0)
        const lineTotal = qty * price
        const unit = UNIT_LABELS[item.unit_type] || item.unit_type || 'قطعة'
        h += `<tr><td style="font-family:monospace;direction:ltr">${esc(item.legacy_code || 'غير متوفر')}</td><td>${esc(item.product_name)}</td><td>${esc(unit)}</td><td>${qty}</td><td>${formatCurrencyShort(net(price))}</td><td>${formatCurrencyShort(net(lineTotal))}</td></tr>`
      }
      if (gs.length > 1) {
        h += `<tr class="subtotal-row"><td colspan="5" style="text-align:left">إجمالي ${esc(g.company)}</td><td>${formatCurrencyShort(net(g.subtotal))}</td></tr>`
      }
    }
    h += '</tbody></table>'
    return h
  }

  function bonusSection(): string {
    if (bonusItems.length === 0) return ''
    let h = '<table><thead><tr><th>كود الصنف</th><th>اسم الصنف</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>'
    h += `<tr class="group-header bonus-header"><td colspan="6">منتجات البونص (${bonusItems.length})</td></tr>`
    for (const item of bonusItems) {
      const qty = Number(item.unit_quantity || 1)
      const unit = UNIT_LABELS[item.unit_type] || item.unit_type || 'قطعة'
      const price = Number(item.base_unit_price ?? item.unit_price ?? 0)
      const lineTotal = qty * Number(item.base_unit_price ?? item.unit_price ?? 0)
      h += `<tr class="bonus-row"><td style="font-family:monospace;direction:ltr">${esc(item.legacy_code || 'غير متوفر')}</td><td><span class="bonus-badge">بونص</span>${esc(item.product_name)}</td><td>${esc(unit)}</td><td>${qty}</td><td>${formatCurrencyShort(price)}</td><td>${formatCurrencyShort(lineTotal)}</td></tr>`
    }
    h += '</tbody></table>'
    return h
  }

  function summarySection(): string {
    return `<div class="summary">
      <div class="summary-row"><span class="summary-label">عدد الأصناف</span><span class="summary-value">${items.length}</span></div>
      <div class="summary-row"><span class="summary-label">إجمالي الوحدات</span><span class="summary-value">${formatNumber(totalQty)}</span></div>
      <div class="summary-row"><span class="summary-label">إجمالي القطع</span><span class="summary-value">${formatNumber(totalPieces)}</span></div>
      <hr class="summary-divider" />
      <div class="summary-row summary-grand"><span class="summary-label">الإجمالي النهائي</span><span class="summary-value">${formatCurrencyShort(finalTotal)}</span></div>
    </div>`
  }

  function calcTableRow(label: string, value: string, symbol?: string, tone?: 'default' | 'credit' | 'result' | 'final'): string {
    const rowCls = tone === 'final' ? ' calc-final' : ''
    const labelCls = tone === 'result' || tone === 'final' ? ' calc-label-strong' : ''
    const valueCls = tone === 'credit' ? ' calc-value-credit' : tone === 'final' ? ' calc-value-final' : ''
    return `<tr class="calc-row${rowCls}"><td class="calc-label${labelCls}">${label}</td><td class="calc-value${valueCls}" dir="ltr">${symbol ? `${symbol} ` : ''}${value}</td></tr>`
  }

  function calcSection(): string {
    if (financial.mode === 'none') {
      return `<div class="bill-section"><div class="bill-title">حساب قيمة الطلب النهائية</div><table class="calc-table">${calcTableRow('الاجمالى النهائى', formatCurrencyShort(finalTotal), '=', 'final')}</table></div>`
    }
    let body = ''
    if (financial.mode === 'bonus') {
      body = calcTableRow('إجمالي المنتجات الأساسية', formatCurrencyShort(financial.mainBaseTotal), '+', 'result')
        + calcTableRow('قيمة منتجات البونص المختارة', formatCurrencyShort(financial.bonusProductsTotal), '+')
        + calcTableRow('المطلوب قبل حساب البونص', formatCurrencyShort(financial.beforeBonusTotal), '=', 'result')
        + calcTableRow('بونص الفاتورة', formatCurrencyShort(financial.bonusApplied), '−', 'credit')
      if (financial.bonusUnused > 0) body += calcTableRow('رصيد البونص المتبقي', formatCurrencyShort(financial.bonusUnused))
      if (financial.bonusOverflow > 0) body += calcTableRow('الزيادة المطلوب دفعها', formatCurrencyShort(financial.bonusOverflow), '+', 'result')
      body += calcTableRow('الاجمالى النهائى', formatCurrencyShort(finalTotal), '=', 'final')
    } else {
      body = calcTableRow('إجمالي الطلب بالسعر الأساسي', formatCurrencyShort(financial.directBaseTotal), '+')
        + calcTableRow('إجمالي الخصم', formatCurrencyShort(financial.directDiscountAmount), '−', 'credit')
        + calcTableRow('الاجمالى النهائى', formatCurrencyShort(finalTotal), '=', 'final')
    }
    return `<div class="bill-section"><div class="bill-title">حساب قيمة الطلب النهائية</div><table class="calc-table">${body}</table></div>`
  }

  function benefitDetailsSection(): string {
    const rows: string[] = []
    const add = (label: string, value: string) => rows.push(`<div class="b-item"><span class="b-label">${label}</span><span class="b-value">${value}</span></div>`)

    if (order.snapshot_tier_name) {
      add('الشريحة السعرية', `${esc(order.snapshot_tier_name)}${order.snapshot_tier_discount ? ` <span class="b-pct">(${order.snapshot_tier_discount}%)</span>` : ''}`)
    }
    if (order.snapshot_payment_name) {
      add('طريقة الدفع', `${esc(order.snapshot_payment_name)}${order.snapshot_payment_discount ? ` <span class="b-pct">(${order.snapshot_payment_discount}%)</span>` : ''}`)
    }
    if (order.snapshot_shipping_name) {
      add('نظام الشحن', `${esc(order.snapshot_shipping_name)}${order.snapshot_shipping_discount ? ` <span class="b-pct">(${order.snapshot_shipping_discount}%)</span>` : ''}`)
    }

    if (financial.mode === 'bonus') {
      if (effectivePercent > 0) add('إجمالي نسبة المنفعة', `${effectivePercent}%`)
      add('قيمة البونص', formatCurrencyShort(financial.bonusApplied))
      add('رصيد البونص', formatCurrencyShort(financial.bonusCredit))
      add('قيمة منتجات البونص', formatCurrencyShort(financial.bonusProductsTotal))
      if (financial.bonusUnused > 0) add('البونص غير المستخدم', formatCurrencyShort(financial.bonusUnused))
      if (financial.bonusOverflow > 0) add('الزيادة المطلوب دفعها', formatCurrencyShort(financial.bonusOverflow))
    } else if (financial.directDiscountAmount > 0 || effectivePercent > 0) {
      if (effectivePercent > 0) add('إجمالي نسبة الخصم', `${effectivePercent}%`)
      add('قيمة الخصم', formatCurrencyShort(financial.directDiscountAmount))
    }

    if (rows.length === 0) return ''
    return `<div class="bill-section"><div class="bill-title">تفاصيل الشريحة والخصومات</div><div class="bill-grid">${rows.join('')}</div></div>`
  }

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>إذن تسليم ${esc(order.order_number)}</title>
<style>
  @page { margin: 0 !important; size: A4; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Cairo', 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 10pt; color: #222; line-height: 1.6; position: relative; padding: 0; }
  .watermark-wrap { position: fixed; top: 0; bottom: 0; left: 0; right: 0; z-index: -10; display: flex; justify-content: center; align-items: center; pointer-events: none; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .watermark-wrap img { transform: rotate(-45deg) scale(2.5); opacity: 0.05; max-width: 100%; max-height: 100%; }
  .print-content { position: relative; z-index: 1; }
  .top-bar { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #003366; padding-bottom: 15px; margin-bottom: 20px; }
  .header-right { flex: 3; text-align: right; }
  .header-right .brand { font-size: 16pt; font-weight: 700; color: #003366; white-space: nowrap; }
  .header-right .contact { font-size: 11pt; color: #333333; }
  .header-center { flex: 4; text-align: center; }
  .header-center .logo-img { height: auto; max-height: 150px; max-width: 100%; object-fit: contain; margin: 0 auto; }
  .header-left { flex: 3; text-align: left; }
  .header-left { text-align: left; }
  .header-left .doc-title { font-size: 16pt; font-weight: 700; color: #003366; }
  .header-left .doc-num,
  .header-left .doc-date { font-size: 11pt; white-space: nowrap; }
  .header-left .doc-num { color: #333; }
  .header-left .doc-date { color: #555; margin-top: 2px; }
  .info-card { background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; margin-bottom: 16px; page-break-inside: avoid; }
  .info-grid { display: flex; flex-wrap: wrap; gap: 4px 20px; font-size: 10pt; }
  .info-grid .label { color: #6b7280; font-size: 8pt; font-weight: 700; }
  .info-grid .value { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  thead { display: table-header-group; }
  tbody { display: table-row-group; }
  th { background: #0052cc; color: #fff; padding: 8px 4px !important; text-align: center; vertical-align: middle !important; font-weight: 600; font-size: 9pt; word-wrap: break-word; }
  td { padding: 8px 4px !important; border-bottom: 1px solid #e5e7eb; text-align: center; vertical-align: middle !important; font-size: 9pt; word-wrap: break-word; }
  tbody tr { page-break-inside: avoid; }
  .group-header td { background: #e8f0fe; font-weight: 700; color: #0d2b6b; font-size: 10pt; text-align: right; padding: 6px 10px; border-bottom: 1px solid #0052cc; }
  .bonus-header td { background: #fef3c7; color: #92400e; border-bottom: 1px solid #f59e0b; }
  .bonus-row td { background: #fffbeb; }
  .bonus-badge { display: inline-block; background: #f59e0b; color: #fff; font-size: 7pt; font-weight: 700; padding: 1px 6px; border-radius: 9px; margin-inline-end: 6px; vertical-align: middle; }
  .subtotal-row td { font-weight: 700; background: #f0f5ff; border-top: 2px solid #0052cc; padding: 6px 5px; color: #0d2b6b; font-size: 9pt; }
  .summary { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; background: #fafafa; page-break-inside: avoid; }
  .summary-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 10pt; }
  .summary-label { color: #6b7280; }
  .summary-value { font-weight: 600; color: #222; }
  .summary-divider { border: none; border-top: 1px solid #d1d5db; margin: 5px 0; }
  .summary-grand .summary-label { font-weight: 700; color: #0d2b6b; font-size: 11pt; }
  .summary-grand .summary-value { font-weight: 800; color: #0052cc; font-size: 11pt; }
  .bill-section { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; background: #fafafa; page-break-inside: avoid; }
  .bill-title { font-size: 11pt; font-weight: 700; color: #0d2b6b; margin-bottom: 8px; padding-bottom: 5px; border-bottom: 1px solid #d1d5db; }
  .bill-grid { display: flex; flex-wrap: wrap; gap: 4px 24px; font-size: 9pt; }
  .b-item { min-width: 42%; display: flex; gap: 6px; align-items: baseline; padding: 2px 0; }
  .b-label { color: #6b7280; font-weight: 700; white-space: nowrap; }
  .b-value { font-weight: 600; color: #222; }
  .b-pct { color: #059669; font-weight: 700; font-size: 8pt; }
  .calc-table { width: 100%; border-collapse: collapse; }
  .calc-table tr { page-break-inside: avoid; }
  .calc-row td { padding: 5px 6px; border-bottom: 1px solid #e5e7eb; font-size: 9pt; text-align: right; }
  .calc-row .calc-label { color: #6b7280; }
  .calc-row .calc-label-strong { color: #0d2b6b; font-weight: 700; }
  .calc-row .calc-value { text-align: left; font-weight: 700; color: #111; white-space: nowrap; }
  .calc-row .calc-value-credit { color: #059669; }
  .calc-final td { background: #f0f5ff; border-top: 2px solid #0052cc; border-bottom: none; }
  .calc-final .calc-label-strong { font-size: 11pt; color: #0d2b6b; }
  .calc-final .calc-value-final { font-size: 11pt; font-weight: 800; color: #0052cc; }
  .legal-box { border: 2px solid #dc2626; border-radius: 6px; padding: 10px 14px; margin-top: 20px; background: #fff5f5; page-break-inside: avoid; }
  .legal-box .legal-title { font-size: 9pt; font-weight: 700; color: #dc2626; margin-bottom: 4px; }
  .legal-box .legal-text { font-size: 9pt; color: #555; line-height: 1.8; }
  .signatures { display: flex; justify-content: space-around; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; page-break-inside: avoid; }
  .signature-field { text-align: center; }
  .signature-field .sig-label { font-size: 9pt; font-weight: 700; color: #333; margin-bottom: 4px; }
  .signature-field .sig-line { width: 180px; border-bottom: 1px solid #333; height: 30px; margin: 0 auto; }
  .footer { text-align: center; margin-top: 20px; font-size: 7pt; color: #9ca3af; padding-top: 8px; }
  @media print { @page { margin: 0 !important; } body { margin: 1cm !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
<div class="watermark-wrap"><img src="${logoUrl || ''}" alt="" /></div>
<div class="print-content">
<div class="top-bar">
  <div class="header-right">
    <div class="brand">شركة الأهرام للتجارة والتوزيع</div>
    <div class="contact">كورنيش النيل - الوراق - جيزة</div>
    <div class="contact">تليفون: 01040880002</div>
  </div>
  <div class="header-center">
    <img src="${logoUrl || ''}" alt="الأهرام" class="logo-img" />
  </div>
  <div class="header-left">
    <div class="doc-title">إذن تسليم</div>
    <div class="doc-num">رقم: ${esc(order.order_number)}</div>
    <div class="doc-date">التاريخ: ${formatDate(order.created_at)}</div>
  </div>
</div>

<div class="info-card">
  <div class="info-grid">
    <div><span class="label">العميل:</span> <span class="value">${esc(customerName)}</span></div>
    <div><span class="label">تليفون:</span> <span class="value" dir="ltr">${esc(customerPhone)}</span></div>
    <div style="width:100%"><span class="label">العنوان:</span> <span class="value">${esc(customerAddress) || 'غير متوفر'}</span></div>
    <div><span class="label">المندوب:</span> <span class="value">${esc(repName)}</span></div>
    <div><span class="label">نوع الدفع:</span> <span class="value">${esc(paymentLabel)}</span></div>
    <div><span class="label">الحالة:</span> <span class="value">${esc(statusLabel)}</span></div>
  </div>
</div>

${itemsTable()}

${bonusSection()}

${summarySection()}

${benefitDetailsSection()}

${calcSection()}

<div class="legal-box">
  <div class="legal-title">تنويه قانوني</div>
  <div class="legal-text">بمجرد التوقيع والاستلام أصبحت البضاعة في عهدة المستلم، وقيمتها المالية حق للشركة يجب الالتزام بسداده.</div>
</div>

<div class="signatures">
  <div class="signature-field">
    <div class="sig-label">توقيع المندوب</div>
    <div class="sig-line"></div>
  </div>
  <div class="signature-field">
    <div class="sig-label">توقيع المستلم</div>
    <div class="sig-line"></div>
  </div>
</div>

<div class="footer"><div>شركة الأهرام للتجارة والتوزيع - جميع الحقوق محفوظة</div><div>تمت الطباعة: ${formatDate(now)}</div></div>
</div>
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

export async function downloadInvoicePdf(html: string, filename: string) {
  const html2canvas = (await import('html2canvas')).default
  const { jsPDF } = await import('jspdf')

  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;left:-9999px;top:0;width:148mm;background:#fff;direction:rtl'
  Array.from(parsed.querySelectorAll('style')).forEach(s => container.appendChild(s.cloneNode(true)))
  container.innerHTML += parsed.body.innerHTML
  document.body.appendChild(container)

  await new Promise(r => setTimeout(r, 1000))

  const canvas = await html2canvas(container, { scale: 2, useCORS: true, logging: false })
  document.body.removeChild(container)

  const imgData = canvas.toDataURL('image/jpeg', 0.95)
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' })
  const pdfW = pdf.internal.pageSize.getWidth()
  const pdfH = pdf.internal.pageSize.getHeight()
  const ratio = Math.min(pdfW / canvas.width, pdfH / canvas.height)
  const imgW = canvas.width * ratio
  const imgH = canvas.height * ratio
  const x = (pdfW - imgW) / 2
  pdf.addImage(imgData, 'JPEG', x, 0, imgW, imgH)
  pdf.save(filename)
}
