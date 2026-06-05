import { Fragment } from 'react'
import { formatCurrencyShort, formatDate, formatDateTime } from '../../utils/format'
import { StatusBadge } from './StatusBadge'

function esc(s: string | null | undefined): string {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

function money(n: number | null | undefined): string {
  if (n == null) return '0 ج.م'
  return Math.round(Number(n)).toLocaleString('en-US') + ' ج.م'
}

interface CompanyGroup {
  company: string
  items: any[]
  subtotal: number
}

function groupItems(items: any[]): CompanyGroup[] {
  const map: Record<string, CompanyGroup> = {}
  for (const item of items) {
    const companyName = item.products?.companies?.company_name || 'أخرى'
    if (!map[companyName]) map[companyName] = { company: companyName, items: [], subtotal: 0 }
    map[companyName].items.push(item)
    map[companyName].subtotal += Number(item.total_price || 0)
  }
  return Object.values(map)
}

const unitLabels: Record<string, string> = { piece: 'قطعة', dozen: 'دستة', carton: 'كرتونة' }

/* ─── PDF ──────────────────────────────────────────── */

function renderPdfHtml(order: any, groups: CompanyGroup[], items: any[], history: any[], compact: boolean): string {
  const now = new Date()
  const docType = (order.status === 'submitted' || order.status === 'reviewing') ? 'طلب شراء' : 'فاتورة'
  const statusLabel = config[order.status]?.label || order.status || 'غير معروف'

  function itemsTable(compact: boolean): string {
    const tableFont = compact ? '7pt' : '9pt'
    const headerFont = compact ? '7pt' : '9pt'
    const groupFont = compact ? '8pt' : '10pt'
    const largeFont = compact ? '9pt' : '13pt'
    let h = '<table>'
    h += `<thead><tr><th style="font-size:${headerFont}">كود الصنف</th><th style="font-size:${headerFont}">اسم الصنف</th><th style="font-size:${headerFont}">الوحدة</th><th style="font-size:${headerFont}">الكمية</th><th style="font-size:${headerFont}">السعر</th><th style="font-size:${headerFont}">الإجمالي</th></tr></thead><tbody>`
    let grandTotal = 0
    for (const group of groups) {
      let groupTotal = 0
      h += `<tr class="group-header"><td colspan="6"><strong style="font-size:${groupFont}">${esc(group.company)} (${group.items.length})</strong></td></tr>`
      for (const item of group.items) {
        const qty = Number(item.unit_quantity || 1)
        const price = Number(item.unit_price || 0)
        const lineTotal = qty * price
        groupTotal += lineTotal
        grandTotal += lineTotal
        const code = item.products?.legacy_code || ''
        const name = item.products?.product_name || ''
        const unit = unitLabels[item.unit_type] || item.unit_type || 'قطعة'
        h += `<tr><td style="font-family:monospace;direction:ltr;font-size:${tableFont}">${esc(code || '—')}</td><td style="text-align:right;font-size:${tableFont}">${esc(name)}</td><td style="font-size:${tableFont}">${esc(unit)}</td><td style="font-size:${tableFont}">${qty}</td><td style="font-size:${tableFont}">${money(price)}</td><td style="font-size:${tableFont}">${money(lineTotal)}</td></tr>`
      }
      if (groups.length > 1) {
        h += `<tr class="group-subtotal"><td colspan="5" style="text-align:left;font-size:${groupFont}">إجمالي ${esc(group.company)}</td><td style="font-size:${groupFont}">${money(groupTotal)}</td></tr>`
      }
    }
    h += `</tbody><tfoot><tr class="total-row"><td colspan="5" style="text-align:left;font-size:${largeFont}">الإجمالي النهائي</td><td style="font-size:${largeFont}">${money(grandTotal)} ج.م</td></tr></tfoot></table>`
    return h
  }

  function identityBlock(): string {
    let h = ''
    h += '<div class="section"><div class="section-title">العميل</div><div class="section-body">'
    h += `<div style="font-weight:700;font-size:11pt">${esc(order.customer_name || '')}</div>`
    if (order.customer_phone) h += `<div dir="ltr">📞 ${esc(order.customer_phone)}</div>`
    if (order.customer_address) h += `<div>📍 ${esc(order.customer_address)}</div>`
    h += '</div></div>'
    h += '<div class="section"><div class="section-title">مندوب المبيعات</div><div class="section-body">'
    h += `<div style="font-weight:700;font-size:11pt">${esc(order.created_by_name || '')}</div>`
    if (order.created_by_phone) h += `<div dir="ltr">📞 ${esc(order.created_by_phone)}</div>`
    h += '</div></div>'
    return h
  }

  function executionBlock(): string {
    if (!order.execution_latitude && !order.execution_accuracy_meters) return ''
    let h = '<div class="section"><div class="section-title">موقع التنفيذ</div><div class="section-body">'
    if (order.execution_maps_url) h += `<div><a href="${esc(order.execution_maps_url)}" target="_blank">فتح الخريطة</a></div>`
    if (order.execution_source) {
      const srcLabels: Record<string, string> = { gps: 'GPS', network: 'Network', cached: 'Cached', manual: 'يدوي' }
      h += `<div>المصدر: ${srcLabels[order.execution_source.toLowerCase()] || order.execution_source}</div>`
    }
    if (order.execution_accuracy_meters != null) h += `<div>الدقة: ${order.execution_accuracy_meters} متر</div>`
    if (order.execution_captured_at) h += `<div>وقت الالتقاط: ${formatDateTime(order.execution_captured_at)}</div>`
    h += '</div></div>'
    return h
  }

  function timelineHtml(): string {
    if (!history || !history.length) return ''
    const actionMap: Record<string, string> = {
      order_created: 'تم إنشاء الطلب', order_edited: 'تم تعديل الطلب',
      approved: 'تم اعتماد الطلب', status_changed: 'تم تغيير الحالة',
    }
    let h = '<div class="timeline"><div class="timeline-title">📋 سجل التغييرات</div>'
    for (const ev of history) {
      const ts = ev.changed_at ? new Date(ev.changed_at) : null
      const dateStr = ts ? ts.toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric' }) : ''
      const timeStr = ts ? ts.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''
      const changedByName = ev.changed_by_name || ''
      const fromLabel = config[ev.from_status]?.label || ev.from_status
      const toLabel = config[ev.to_status]?.label || ev.to_status
      h += `<div class="tl-item"><span class="tl-time">${esc(dateStr)} ${esc(timeStr)}</span>${changedByName ? ` &mdash; ${esc(changedByName)}` : ''} &mdash; ${esc(fromLabel)} → ${esc(toLabel)}${ev.reason ? ` (${esc(ev.reason)})` : ''}</div>`
    }
    h += '</div>'
    return h
  }

  const size = compact ? 'A5' : 'A4'
  const margin = compact ? '.7cm' : '1.5cm'

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><title>${esc(docType)} ${esc(order.order_number)}</title>
<style>
  @page { margin: ${margin}; size: ${size}; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: ${compact ? '8pt' : '10pt'}; color: #222; line-height: ${compact ? '1.4' : '1.6'}; padding: ${compact ? '8px' : '10px'}; }
  .header { text-align: center; margin-bottom: ${compact ? '8px' : '18px'}; padding-bottom: ${compact ? '6px' : '14px'}; border-bottom: ${compact ? '2px' : '3px double'} solid #0052cc; }
  .header .brand { font-size: ${compact ? '11pt' : '18pt'}; font-weight: 800; color: #0052cc; }
  .header .brand-sub { font-size: ${compact ? '7pt' : '9pt'}; color: #6b7280; }
  .header .doc-title { font-size: ${compact ? '9pt' : '12pt'}; font-weight: 700; color: #333; }
  .header .invoice-num { font-size: ${compact ? '14pt' : '20pt'}; font-weight: 700; color: #0052cc; }
  .header .meta { font-size: ${compact ? '6.5pt' : '8pt'}; color: #9ca3af; }
  .sections { display: flex; flex-wrap: wrap; gap: ${compact ? '6px' : '14px'}; margin-bottom: ${compact ? '8px' : '18px'}; }
  .section { flex: 1; min-width: ${compact ? '110px' : '170px'}; padding: ${compact ? '6px 8px' : '10px 12px'}; background: #f8f9fa; border-radius: 6px; page-break-inside: avoid; border: 1px solid #e5e7eb; }
  .section-title { font-size: ${compact ? '6.5pt' : '8pt'}; font-weight: 700; color: #6b7280; margin-bottom: ${compact ? '2px' : '4px'}; text-transform: uppercase; }
  .section-body { font-size: ${compact ? '7.5pt' : '10pt'}; }
  .section-body div { padding: ${compact ? '1px' : '2px'} 0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: ${compact ? '8px' : '16px'}; }
  thead { display: table-header-group; }
  tbody { display: table-row-group; }
  tfoot { display: table-footer-group; }
  th { background: #0052cc; color: #fff; padding: ${compact ? '4px 3px' : '7px 5px'}; text-align: center; font-weight: 600; }
  td { padding: ${compact ? '3px' : '5px'}; border-bottom: 1px solid #e5e7eb; text-align: center; }
  tbody tr { page-break-inside: avoid; }
  .group-header td { background: #eef2ff; font-weight: 700; text-align: right; padding: ${compact ? '4px 6px' : '6px 10px'}; border-bottom: ${compact ? '1.5px' : '2px'} solid #0052cc; color: #0d2b6b; }
  .group-subtotal td { background: #f8f9fa; font-weight: 600; border-top: 1px solid #0052cc; color: #374151; }
  .total-row td { font-weight: 700; border-top: ${compact ? '2px' : '3px double'} solid #0052cc; background: #f0f5ff; padding: ${compact ? '5px 3px' : '8px 5px'}; color: #0d2b6b; }
  .notes { margin: 0 0 16px; padding: 10px 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; }
  .timeline { margin-top: ${compact ? '8px' : '16px'}; padding: ${compact ? '8px' : '12px'}; background: #fafafa; border-radius: 6px; border: 1px solid #e5e7eb; }
  .timeline-title { font-size: 9pt; font-weight: 700; color: #0052cc; margin-bottom: 8px; }
  .tl-item { font-size: 7.5pt; padding: 3px 0; border-bottom: 1px solid #f3f4f6; color: #374151; }
  .tl-time { color: #0052cc; font-weight: 600; }
  .footer { text-align: center; margin-top: ${compact ? '8px' : '24px'}; font-size: ${compact ? '5.5pt' : '7pt'}; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: ${compact ? '4px' : '8px'}; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
<div class="header">
  <div class="brand">${esc('شركة الأهرام للتجارة والتوزيع')}</div>
  <div class="doc-title">${esc(docType)}</div>
  <div class="invoice-num">${esc(order.order_number)}</div>
  <div class="meta">${formatDate(order.created_at)} | ${esc(statusLabel)}</div>
</div>
<div class="sections">${identityBlock()}${executionBlock()}</div>
${order.notes ? `<div class="notes"><strong>ملاحظات:</strong> ${esc(order.notes)}</div>` : ''}
${itemsTable(compact)}
${!compact ? timelineHtml() : ''}
<div class="footer"><div>شركة الأهرام للتجارة والتوزيع - جميع الحقوق محفوظة</div><div>تمت الطباعة: ${formatDate(now)}</div></div>
</body></html>`
}

function printInvoice(html: string) {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => { try { w.print() } catch {} }, 500)
}

/* ─── WhatsApp ─────────────────────────────────────── */

function buildWhatsAppMessage(order: any, groups: CompanyGroup[], items: any[]): string {
  const num = '201040880002'
  const docType = (order.status === 'submitted' || order.status === 'reviewing') ? 'طلب شراء' : 'فاتورة'
  let msg = `🏢 شركة الأهرام للتجارة والتوزيع\n`
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`
  msg += `📄 ${docType} رقم ${order.order_number}\n\n`
  msg += `┌─ ❲ معلومات العميل ❳ ─┐\n`
  msg += `الاسم: ${order.customer_name || ''}\n`
  if (order.customer_phone) msg += `الهاتف: ${order.customer_phone}\n`
  if (order.customer_address) msg += `العنوان: ${order.customer_address}\n`
  if (order.execution_maps_url) msg += `الموقع: ${order.execution_maps_url}\n`
  msg += `\n┌─ ❲ مندوب المبيعات ❳ ─┐\n`
  msg += `الاسم: ${order.created_by_name || ''}\n`
  if (order.created_by_phone) msg += `الهاتف: ${order.created_by_phone}\n`
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━\n📦 بيان الطلب\n\n`
  for (const group of groups) {
    if (!group.items.length) continue
    msg += `◈ ${group.company} (${group.items.length} أصناف)\n`
    for (const item of group.items) {
      const name = item.products?.product_name || ''
      const code = item.products?.legacy_code || ''
      const unit = unitLabels[item.unit_type] || item.unit_type || 'قطعة'
      const qty = Number(item.unit_quantity || 1)
      const price = Number(item.unit_price || 0)
      const lineTotal = qty * price
      msg += `▸ ${name}\n  كود: ${code || '—'}\n  الكمية: ${qty} ${unit} | السعر: ${money(price)}\n  الإجمالي: ${money(lineTotal)}\n\n`
    }
    msg += `  ───── ${money(group.subtotal)} ─────\n\n`
  }
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n💵 إجمالي الفاتورة: ${money(order.total_amount)}`
  if (order.execution_latitude || order.execution_maps_url) {
    msg += `\n\n📍 موقع التنفيذ`
    if (order.execution_source) msg += `\nالمصدر: ${order.execution_source}`
    if (order.execution_accuracy_meters != null) msg += `\nالدقة: ${order.execution_accuracy_meters} متر`
    if (order.execution_captured_at) msg += `\nوقت الالتقاط: ${formatDateTime(order.execution_captured_at)}`
    if (order.execution_maps_url) msg += `\n${order.execution_maps_url}`
  }
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`
}

/* ─── Status Config ───────────────────────────────── */

const config: Record<string, { label: string; icon: string }> = {
  draft: { label: 'مسودة', icon: '📄' },
  submitted: { label: 'تم الإرسال', icon: '📝' },
  reviewing: { label: 'تحت المراجعة', icon: '🔍' },
  approved: { label: 'معتمد', icon: '✅' },
  preparing: { label: 'قيد التجهيز', icon: '🔧' },
  prepared: { label: 'تم التجهيز', icon: '📦' },
  ready_for_dispatch: { label: 'بانتظار قرار الشحن', icon: '⏳' },
  sent_to_delivery: { label: 'تم الإرسال للتوصيل', icon: '🚚' },
  deferred: { label: 'مؤجل', icon: '🕐' },
  dispatched: { label: 'خرج للشحن', icon: '🚚' },
  delivered: { label: 'تم التسليم', icon: '✅' },
  cancelled: { label: 'ملغي', icon: '❌' },
  returned_for_revision: { label: 'معاد للتعديل', icon: '✏️' },
}

/* ─── Component ───────────────────────────────────── */

interface InvoiceViewProps {
  order: any
  items: any[]
  history?: any[]
  showActions?: boolean
  showTimeline?: boolean
  onBack?: () => void
}

export function InvoiceView({ order, items, history = [], showActions = true, showTimeline = true, onBack }: InvoiceViewProps) {
  const groups = groupItems(items)
  const grandTotal = groups.reduce((s, g) => s + g.subtotal, 0)
  const totalQty = items.reduce((s: number, i: any) => s + Number(i.unit_quantity || 0), 0)
  const docType = (order.status === 'submitted' || order.status === 'reviewing') ? 'طلب شراء' : 'فاتورة'
  const c = config[order.status] || { label: order.status || 'غير معروف', icon: '📄' }
  const isPositive = order.status === 'delivered' || order.status === 'approved'
  const isNegative = order.status === 'cancelled'
  const stampClass = isPositive ? 'bg-success/10 text-success border-success/30' : isNegative ? 'bg-danger/10 text-danger border-danger/30' : 'bg-warning/10 text-warning border-warning/30'

  function handlePdf(compact: boolean) {
    const html = renderPdfHtml(order, groups, items, history, compact)
    printInvoice(html)
  }

  function handleWhatsApp() {
    const url = buildWhatsAppMessage(order, groups, items)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Back */}
      {onBack && (
        <button onClick={onBack} className="text-text-secondary text-lg hover:text-text transition-colors">&larr;</button>
      )}

      {/* Header */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] text-text-secondary">شركة الأهرام للتجارة والتوزيع</p>
              <p className="text-[10px] text-text-secondary">متجر الأهرام</p>
            </div>
            <div className="text-right">
              <div className={`text-[10px] px-2 py-0.5 rounded-full border inline-flex items-center gap-1 ${stampClass}`}>
                <span>{c.icon}</span>
                <span>{c.label}</span>
              </div>
              <p className="text-[9px] text-text-secondary mt-1">{order.created_at ? formatDate(order.created_at) : ''}</p>
              <p className="text-[9px] text-text-secondary">{order.created_at ? new Date(order.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''}</p>
            </div>
          </div>
          <div className="mt-2">
            <p className="text-lg font-bold text-text">{esc(docType)}</p>
            <p className="text-xl font-bold text-primary">{esc(order.order_number)}</p>
          </div>
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-2 gap-3 p-4 bg-surface/30">
          <div className="bg-white rounded-lg border border-border p-3">
            <p className="text-[9px] font-bold text-text-secondary uppercase mb-1">العميل</p>
            <p className="text-xs font-bold text-text">{esc(order.customer_name || '')}</p>
            {order.customer_phone && <p className="text-[10px] text-text-secondary mt-0.5" dir="ltr">📞 {esc(order.customer_phone)}</p>}
            {order.customer_address && <p className="text-[10px] text-text-secondary mt-0.5">📍 {esc(order.customer_address)}</p>}
            {order.execution_maps_url && (
              <a href={order.execution_maps_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary underline mt-1 block">موقع العميل</a>
            )}
          </div>
          <div className="bg-white rounded-lg border border-border p-3">
            <p className="text-[9px] font-bold text-text-secondary uppercase mb-1">مندوب المبيعات</p>
            <p className="text-xs font-bold text-text">{esc(order.created_by_name || '')}</p>
            {order.created_by_phone && <p className="text-[10px] text-text-secondary mt-0.5" dir="ltr">📞 {esc(order.created_by_phone)}</p>}
          </div>
        </div>

        {/* Execution Info (if available) */}
        {(order.execution_latitude || order.execution_accuracy_meters != null || order.execution_maps_url) && (
          <div className="px-4 pb-4">
            <div className="bg-white rounded-lg border border-border p-3">
              <p className="text-[9px] font-bold text-text-secondary uppercase mb-1">📍 موقع التنفيذ</p>
              {order.execution_maps_url && (
                <a href={order.execution_maps_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-primary underline block mb-1">فتح الخريطة</a>
              )}
              {order.execution_source && <p className="text-[10px] text-text-secondary">المصدر: {order.execution_source}</p>}
              {order.execution_accuracy_meters != null && <p className="text-[10px] text-text-secondary">الدقة: {order.execution_accuracy_meters} متر</p>}
              {order.execution_captured_at && <p className="text-[10px] text-text-secondary">وقت الالتقاط: {formatDateTime(order.execution_captured_at)}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Items Table */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border bg-surface/50 text-text-secondary">
                <th className="px-2 py-1.5 text-right">كود الصنف</th>
                <th className="px-2 py-1.5 text-right">اسم الصنف</th>
                <th className="px-2 py-1.5 text-center">الوحدة</th>
                <th className="px-2 py-1.5 text-center">الكمية</th>
                <th className="px-2 py-1.5 text-left">السعر</th>
                <th className="px-2 py-1.5 text-left">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.company}>
                  <tr className="bg-primary/5 border-b border-primary/20">
                    <td colSpan={6} className="px-2 py-1.5 text-xs font-bold text-primary-dark">{esc(group.company)} ({group.items.length})</td>
                  </tr>
                  {group.items.map((item: any, idx: number) => {
                    const qty = Number(item.unit_quantity || 1)
                    const price = Number(item.unit_price || 0)
                    const lineTotal = qty * price
                    return (
                      <tr key={item.id || idx} className="border-b border-border last:border-0">
                        <td className="px-2 py-1.5 text-text-secondary font-mono text-[10px]" dir="ltr">{item.products?.legacy_code || '—'}</td>
                        <td className="px-2 py-1.5 text-text font-semibold">{item.products?.product_name || '—'}</td>
                        <td className="px-2 py-1.5 text-center text-text-secondary">{unitLabels[item.unit_type] || item.unit_type}</td>
                        <td className="px-2 py-1.5 text-center text-text">{qty}</td>
                        <td className="px-2 py-1.5 text-left text-text">{formatCurrencyShort(price)}</td>
                        <td className="px-2 py-1.5 text-left text-text font-semibold">{formatCurrencyShort(lineTotal)}</td>
                      </tr>
                    )
                  })}
                  {groups.length > 1 && (
                    <tr className="bg-surface/30 border-b border-border">
                      <td colSpan={5} className="px-2 py-1 text-left text-[10px] text-text-secondary">إجمالي {esc(group.company)}</td>
                      <td className="px-2 py-1 text-left text-xs font-bold text-text">{formatCurrencyShort(group.subtotal)}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">عدد الأصناف</span>
          <span className="font-semibold text-text">{items.length}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-secondary">إجمالي الكميات</span>
          <span className="font-semibold text-text">{totalQty.toLocaleString('ar-EG')}</span>
        </div>
        <hr className="border-border" />
        <div className="flex justify-between text-sm font-bold">
          <span className="text-text-secondary">الإجمالي النهائي</span>
          <span className="text-text">{formatCurrencyShort(grandTotal)}</span>
        </div>
        {order.notes && (
          <div className="mt-2 text-xs p-2 bg-amber-50 border border-amber-200 rounded-lg">
            <span className="text-text-secondary">ملاحظات: </span><span className="text-text">{esc(order.notes)}</span>
          </div>
        )}
      </div>

      {/* Timeline */}
      {showTimeline && history.length > 0 && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-surface/50">
            <h3 className="text-xs font-semibold text-text">سجل التغييرات</h3>
          </div>
          <div className="divide-y divide-border">
            {history.map((h: any) => {
              const fromLabel = config[h.from_status]?.label || h.from_status
              const toLabel = config[h.to_status]?.label || h.to_status
              return (
                <div key={h.id} className="px-3 py-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-text font-semibold">{esc(fromLabel)} → {esc(toLabel)}</span>
                    <span className="text-text-secondary text-[10px]">{h.changed_at ? formatDateTime(h.changed_at) : ''}</span>
                  </div>
                  {h.reason && <p className="text-text-secondary text-[10px] mt-0.5">{esc(h.reason)}</p>}
                  {h.changed_by_name && <p className="text-text-secondary text-[10px]">بواسطة: {esc(h.changed_by_name)}</p>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      {showActions && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => handlePdf(false)} className="flex-1 min-w-[100px] bg-primary text-white text-xs py-2.5 rounded-lg active:opacity-90 transition-colors">
            🖨️ PDF A4
          </button>
          <button onClick={() => handlePdf(true)} className="flex-1 min-w-[100px] bg-emerald-600 text-white text-xs py-2.5 rounded-lg active:opacity-90 transition-colors">
            📱 PDF A5
          </button>
          <button onClick={handleWhatsApp} className="flex-1 min-w-[100px] bg-green-600 text-white text-xs py-2.5 rounded-lg active:opacity-90 transition-colors">
            📱 واتساب
          </button>
        </div>
      )}
    </div>
  )
}


