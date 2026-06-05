import { Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatCurrencyShort, formatDate, formatDateTime } from '../../utils/format'
import { StatusBadge } from '../shared/StatusBadge'
import { sendFullOrderToWhatsApp } from '../../lib/whatsapp'

function esc(s: string | null | undefined): string {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

const unitLabels: Record<string, string> = { piece: 'قطعة', dozen: 'دستة', carton: 'كرتونة' }

interface CustomerInfo {
  id?: string; name: string; phone?: string; address?: string; mapsUrl?: string
}
interface EmployeeInfo {
  id?: string; name: string; role?: string; phone?: string; address?: string; mapsUrl?: string
}
interface OrderItem {
  id: string; product_id?: string; unit_type: string; unit_quantity: number
  piece_quantity?: number; unit_price: number; total_price: number
  products?: { product_name?: string; legacy_code?: string; image_url?: string | null; companies?: { company_name?: string }; company_id?: string }
}
interface HistoryEntry {
  id: string; from_status?: string | null; to_status: string; changed_by?: string
  changed_by_name?: string; reason?: string | null; changed_at: string
}

interface OrderDetailViewProps {
  order: any; items: OrderItem[]; history: HistoryEntry[]
  customer?: CustomerInfo | null; creator?: EmployeeInfo | null; owner?: EmployeeInfo | null
  actions?: React.ReactNode; onBack?: () => void; onSharePdf?: (compact: boolean) => void; onShareWhatsApp?: () => void
}

function money(n: number | null | undefined): string {
  if (n == null) return '0 ج.م'
  return Math.round(Number(n)).toLocaleString('en-US') + ' ج.م'
}

const statusLabels: Record<string, string> = {
  draft: 'مسودة', submitted: 'مقدم', reviewing: 'قيد المراجعة',
  returned_for_revision: 'معاد للتعديل', approved: 'معتمد',
  preparing: 'قيد التجهيز', prepared: 'تم التجهيز',
  ready_for_dispatch: 'بانتظار القرار', sent_to_delivery: 'أرسل للتوصيل',
  deferred: 'مؤجل', dispatched: 'تم الشحن', delivered: 'تم التسليم',
  cancelled: 'ملغي',
}

function renderPdfHtml(order: any, items: OrderItem[], customer?: CustomerInfo | null, creator?: EmployeeInfo | null, owner?: EmployeeInfo | null): string {
  const now = new Date()
  const statusLabel = statusLabels[order.status] || order.status || 'غير معروف'
  const grandTotal = items.reduce((s, i) => s + Number(i.total_price || 0), 0)

  function itemsTable(): string {
    let h = '<table><thead><tr><th>كود الصنف</th><th>اسم الصنف</th><th>الشركة</th><th>الوحدة</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>'
    for (const item of items) {
      const qty = Number(item.unit_quantity || 1)
      const price = Number(item.unit_price || 0)
      const lineTotal = qty * price
      const code = item.products?.legacy_code || ''
      const name = item.products?.product_name || ''
      const company = item.products?.companies?.company_name || ''
      const unit = unitLabels[item.unit_type] || item.unit_type || 'قطعة'
      h += `<tr><td style="font-family:monospace;direction:ltr">${esc(code || '—')}</td><td>${esc(name)}</td><td>${esc(company)}</td><td>${esc(unit)}</td><td>${qty}</td><td>${money(price)}</td><td>${money(lineTotal)}</td></tr>`
    }
    h += `</tbody><tfoot><tr class="total-row"><td colspan="6" style="text-align:left">الإجمالي النهائي</td><td>${money(grandTotal)}</td></tr></tfoot></table>`
    return h
  }

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
    <div style="font-weight:700;font-size:11pt">${esc(customer?.name || order.customer_name || '')}</div>
    ${customer?.phone ? `<div dir="ltr">📞 ${esc(customer.phone)}</div>` : ''}
    ${customer?.address ? `<div>📍 ${esc(customer.address)}</div>` : ''}
  </div></div>
  ${owner ? `<div class="section"><div class="section-title">المسؤول</div><div class="section-body">
    <div style="font-weight:700;font-size:11pt">${esc(owner.name)}</div>${owner.role ? `<div>${esc(owner.role)}</div>` : ''}${owner.phone ? `<div dir="ltr">📞 ${esc(owner.phone)}</div>` : ''}${owner.address ? `<div>📍 ${esc(owner.address)}</div>` : ''}
  </div></div>` : ''}
  <div class="section"><div class="section-title">منشئ الطلب</div><div class="section-body">
    <div style="font-weight:700;font-size:11pt">${esc(creator?.name || order.created_by_name || '')}</div>${creator?.phone ? `<div dir="ltr">📞 ${esc(creator.phone)}</div>` : ''}${creator?.address ? `<div>📍 ${esc(creator.address)}</div>` : ''}
  </div></div>
</div>
${itemsTable()}
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

export function OrderDetailView({
  order, items, history,
  customer, creator, owner,
  actions, onBack,
}: OrderDetailViewProps) {
  const navigate = useNavigate()
  const grandTotal = items.reduce((s, i) => s + Number(i.total_price || 0), 0)
  const totalQty = items.reduce((s, i) => s + Number(i.unit_quantity || 0), 0)

  function handlePdf(compact: boolean) {
    const html = renderPdfHtml(order, items, customer, creator, owner)
    if (compact) {
      const comp = html.replace(/size: A4/, 'size: A5').replace(/1\.5cm/g, '0.7cm').replace(/10pt/g, '8pt').replace(/18pt/g, '11pt').replace(/20pt/g, '14pt')
      printInvoice(comp)
    } else {
      printInvoice(html)
    }
  }

  function handleWhatsApp() {
    sendFullOrderToWhatsApp(order, customer, owner, creator, items)
  }

  function ContactActions({ phone, mapsUrl }: { phone?: string; mapsUrl?: string }) {
    return (
      <div className="flex gap-1.5 mt-1.5 flex-wrap">
        {phone && (
          <a href={`tel:${phone}`} className="inline-flex items-center gap-0.5 text-[10px] text-primary bg-primary/5 px-2 py-1 rounded-lg active:bg-primary/10 transition-colors">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
            اتصال
          </a>
        )}
        {phone && (
          <a href={`https://wa.me/${phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-green-600 bg-green-50 px-2 py-1 rounded-lg active:bg-green-100 transition-colors">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            واتساب
          </a>
        )}
        {mapsUrl && (
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-red-500 bg-red-50 px-2 py-1 rounded-lg active:bg-red-100 transition-colors">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            الخريطة
          </a>
        )}
      </div>
    )
  }

  interface CompanyGroup { company: string; items: OrderItem[]; subtotal: number }
  const groups: CompanyGroup[] = (() => {
    const map: Record<string, CompanyGroup> = {}
    for (const item of items) {
      const companyName = item.products?.companies?.company_name || 'أخرى'
      if (!map[companyName]) map[companyName] = { company: companyName, items: [], subtotal: 0 }
      map[companyName].items.push(item)
      map[companyName].subtotal += Number(item.total_price || 0)
    }
    return Object.values(map)
  })()

  const creatorLabel = order.owner_type === 'customer' ? 'عميل'
    : order.created_by === order.owner_id ? 'مندوب مبيعات'
    : 'موظف'

  return (
    <div className="space-y-4 pb-4">

      {/* SECTION A: ORDER HEADER */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
          <div className="flex items-start justify-between">
            <div>
              {onBack && (
                <button onClick={onBack} className="text-text-secondary text-lg hover:text-text transition-colors">&larr;</button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={order.status} size="md" />
              {actions}
            </div>
          </div>
          <div className="mt-2">
            <p className="text-lg font-bold text-text">{order.order_number}</p>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-[11px]">
            <div>
              <span className="text-text-secondary">تاريخ الإنشاء</span>
              <p className="text-text font-medium">{order.created_at ? formatDateTime(order.created_at) : '—'}</p>
            </div>
            <div>
              <span className="text-text-secondary">آخر تحديث</span>
              <p className="text-text font-medium">{order.updated_at ? formatDateTime(order.updated_at) : '—'}</p>
            </div>
            <div className="col-span-2">
              <span className="text-text-secondary">الإجمالي</span>
              <p className="text-lg font-bold text-primary">{formatCurrencyShort(Number(order.total_amount) || grandTotal)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION B: CUSTOMER INFORMATION */}
      <div className="bg-white rounded-xl border border-border p-4">
        <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">معلومات العميل</p>
        <p className="text-sm font-bold text-primary cursor-pointer" onClick={() => customer?.id && navigate(`/customers/${customer.id}`)}>{customer?.name || order.customer_name || '—'}</p>
        {customer?.phone && <p className="text-xs text-text-secondary mt-0.5 text-left" dir="ltr">{customer.phone}</p>}
        {customer?.address && <p className="text-xs text-text-secondary mt-0.5">{customer.address}</p>}
        <ContactActions phone={customer?.phone} mapsUrl={customer?.mapsUrl} />
      </div>

      {/* SECTION C: RESPONSIBLE USER */}
      <div className="bg-white rounded-xl border border-border p-4">
        <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">المسؤول عن العميل</p>
        <p className="text-sm font-bold text-primary cursor-pointer" onClick={() => owner?.id && navigate(`/employees/${owner.id}`)}>{owner?.name || '—'}</p>
        {owner?.role && <p className="text-xs text-text-secondary mt-0.5">{owner.role}</p>}
        {owner?.phone && <p className="text-xs text-text-secondary mt-0.5 text-left" dir="ltr">{owner.phone}</p>}
        {owner?.address && <p className="text-xs text-text-secondary mt-0.5">{owner.address}</p>}
        <ContactActions phone={owner?.phone} mapsUrl={owner?.mapsUrl} />
      </div>

      {/* SECTION D: ORDER CREATOR */}
      <div className="bg-white rounded-xl border border-border p-4">
        <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">منشئ الطلب</p>
        <p className="text-sm font-bold text-primary cursor-pointer" onClick={() => creator?.id && navigate(`/employees/${creator.id}`)}>{creator?.name || order.created_by_name || '—'}</p>
        <p className="text-xs text-text-secondary mt-0.5">{creatorLabel}</p>
        {creator?.phone && <p className="text-xs text-text-secondary mt-0.5 text-left" dir="ltr">{creator.phone}</p>}
        {creator?.role && <p className="text-xs text-text-secondary mt-0.5">{creator.role}</p>}
        {creator?.address && <p className="text-xs text-text-secondary mt-0.5">{creator.address}</p>}
        <ContactActions phone={creator?.phone} mapsUrl={creator?.mapsUrl} />
        {creator && owner && creator.name === owner.name && (
          <div className="mt-2 text-[10px] bg-blue-50 text-blue-700 px-2 py-1 rounded-lg inline-block">
            منشئ الطلب هو المسؤول عن العميل
          </div>
        )}
      </div>

      {/* SECTION E: ORDER ITEMS */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-surface/50">
          <h3 className="text-xs font-semibold text-text">المنتجات</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border bg-surface/50 text-text-secondary">
                <th className="px-2 py-1.5 text-right w-10"></th>
                <th className="px-2 py-1.5 text-right">كود الصنف</th>
                <th className="px-2 py-1.5 text-right">اسم الصنف</th>
                <th className="px-2 py-1.5 text-center">الشركة</th>
                <th className="px-2 py-1.5 text-center">الوحدة</th>
                <th className="px-2 py-1.5 text-center">الكمية</th>
                <th className="px-2 py-1.5 text-left">سعر الوحدة</th>
                <th className="px-2 py-1.5 text-left">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.company}>
                  <tr className="bg-primary/5 border-b border-primary/20">
                    <td colSpan={8} className="px-2 py-1.5 text-xs font-bold text-primary-dark">{group.company} ({group.items.length})</td>
                  </tr>
                  {group.items.map((item, idx) => {
                    const qty = Number(item.unit_quantity || 1)
                    const price = Number(item.unit_price || 0)
                    const lineTotal = qty * price
                    return (
                      <tr key={item.id || idx} className="border-b border-border last:border-0">
                        <td className="px-1 py-1.5">
                          {item.products?.image_url ? (
                            <img src={item.products.image_url} alt="" className="w-7 h-7 rounded object-contain bg-surface" />
                          ) : (
                            <div className="w-7 h-7 rounded bg-surface flex items-center justify-center text-text-secondary text-[8px]">—</div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-text-secondary font-mono text-[10px]" dir="ltr">{item.products?.legacy_code || '—'}</td>
                        <td className="px-2 py-1.5 text-primary font-semibold cursor-pointer" onClick={() => item.product_id && navigate(`/products/${item.product_id}`)}>{item.products?.product_name || '—'}</td>
                        <td className="px-2 py-1.5 text-center text-text-secondary text-[10px]">{item.products?.companies?.company_name || ''}</td>
                        <td className="px-2 py-1.5 text-center text-text-secondary">{unitLabels[item.unit_type] || item.unit_type}</td>
                        <td className="px-2 py-1.5 text-center text-text">{qty}</td>
                        <td className="px-2 py-1.5 text-left text-text">{formatCurrencyShort(price)}</td>
                        <td className="px-2 py-1.5 text-left text-text font-semibold">{formatCurrencyShort(lineTotal)}</td>
                      </tr>
                    )
                  })}
                  {groups.length > 1 && (
                    <tr className="bg-surface/30 border-b border-border">
                      <td colSpan={7} className="px-2 py-1 text-left text-[10px] text-text-secondary">إجمالي {group.company}</td>
                      <td className="px-2 py-1 text-left text-xs font-bold text-text">{formatCurrencyShort(group.subtotal)}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-border px-3 py-2 space-y-1 bg-surface/20">
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
            <div className="mt-1 text-[10px] p-2 bg-amber-50 border border-amber-200 rounded-lg">
              <span className="text-text-secondary">ملاحظات: </span><span className="text-text">{order.notes}</span>
            </div>
          )}
        </div>
      </div>

      {/* SECTION F: ORDER TIMELINE */}
      {history.length > 0 && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-surface/50">
            <h3 className="text-xs font-semibold text-text">سجل الطلب</h3>
          </div>
          <div className="divide-y divide-border">
            {history.map((h) => {
              const fromLabel = statusLabels[h.from_status || ''] || h.from_status || ''
              const toLabel = statusLabels[h.to_status] || h.to_status
              return (
                <div key={h.id} className="px-3 py-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {h.from_status && <span className="text-text-secondary text-[10px]">{fromLabel}</span>}
                      {h.from_status && <span className="text-text-secondary text-[9px]">→</span>}
                      <span className="text-text font-semibold">{toLabel}</span>
                    </div>
                    <span className="text-text-secondary text-[10px]">{h.changed_at ? formatDateTime(h.changed_at) : ''}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {h.changed_by_name && <span className="text-text-secondary text-[9px]">{h.changed_by_name}</span>}
                    {h.reason && <span className="text-text-secondary text-[9px]">({h.reason})</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* SECTION G: ORDER ACTIONS */}
      <div className="bg-white rounded-xl border border-border p-4">
        <p className="text-[10px] font-bold text-text-secondary uppercase mb-3">الإجراءات</p>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => handlePdf(false)} className="flex-1 min-w-[100px] bg-primary text-white text-xs py-2.5 rounded-lg active:opacity-90 transition-colors">
            PDF
          </button>
          <button onClick={() => handlePdf(true)} className="flex-1 min-w-[100px] bg-emerald-600 text-white text-xs py-2.5 rounded-lg active:opacity-90 transition-colors">
            PDF A5
          </button>
          <button onClick={handleWhatsApp} className="flex-1 min-w-[100px] bg-green-600 text-white text-xs py-2.5 rounded-lg active:opacity-90 transition-colors">
            مشاركة واتساب
          </button>
        </div>
      </div>
    </div>
  )
}
