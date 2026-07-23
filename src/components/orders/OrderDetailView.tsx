import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { sendWhatsAppFromDisplay, copyWhatsAppFromDisplay } from '../../lib/whatsapp'
import { buildOrderDisplayData } from '../../types/order-display'
import { creditService } from '../../services/credit'
import { StatusBadge } from '../shared/StatusBadge'
import { OrderProductsSection } from './OrderProductsSection'
import { OrderDeliverySection } from './OrderDeliverySection'
import { OrderCollectionsSection } from './OrderCollectionsSection'
import { OrderReturnsSection } from './OrderReturnsSection'
import { OrderTimelineSection } from './OrderTimelineSection'
import { ModificationHistoryPanel } from './ModificationHistoryPanel'
import { formatDateTime, formatCurrencyShort } from '../../utils/format'
import { CustomerAddressCard } from '../customers/CustomerAddressCard'
import { ORDER_STATUS_LABELS } from '../../types/order-display'
import { renderDeliveryPermitHtml, printInvoice, downloadInvoicePdf } from './order-printing'
import { buildTimelineEvents } from './order-detail.utils'
import { copyToClipboard } from '../../utils/safeClipboard'
import { OrderOwnershipInfo } from './OrderOwnershipInfo'
import type { UnifiedOrder, UnifiedOrderItem } from '../../types/unified-order'

interface OrderDetailViewProps {
  data: UnifiedOrder
  actions?: React.ReactNode
  onBack?: () => void
  editMode?: boolean
  editItems?: UnifiedOrderItem[]
  onQuantityChange?: (productId: string, unitType: string, newQty: number) => void
  onRemoveItem?: (productId: string, unitType: string) => void
  onPriceChange?: (productId: string, unitType: string, newPrice: number) => void
  onAddProduct?: (companyName: string) => void
  editActions?: React.ReactNode
}

export function OrderDetailView({ data, actions, onBack, editMode, editItems, onQuantityChange, onRemoveItem, onPriceChange, onAddProduct, editActions }: OrderDetailViewProps) {
  const navigate = useNavigate()
  const { order, customer, items, collections, current_delivery, modification_history } = data
  const [overLimit, setOverLimit] = useState<boolean | null>(null)

  const grandTotal = useMemo(() => items.reduce((s, i) => s + Number(i.total_price || 0), 0), [items])
  const timelineEvents = useMemo(() => buildTimelineEvents(data), [data])

  const collectedAmount = useMemo(() => {
    if (!collections?.length) return 0
    return collections
      .filter(c => c.status !== 'pending' && c.amount != null)
      .reduce((s, c) => s + Number(c.amount), 0)
  }, [collections])

  const collectionStatus = !collections?.length ? 'غير محصل'
    : collectedAmount >= grandTotal ? 'محصل بالكامل'
    : 'محصل جزئى'

  const deliveryAttempts = useMemo(() => data.delivery_history?.length || 0, [data.delivery_history])

  useEffect(() => {
    if (order.payment_method === 'credit' && ['submitted', 'reviewing'].includes(order.status)) {
      creditService.checkOrderOverLimit(order.id).then((r) => {
        if (r.over_limit) setOverLimit(true)
      }).catch(() => {})
    }
  }, [order.id, order.payment_method, order.status])

  function handlePdf(compact: boolean) {
    const logoUrl = window.location.origin + '/store/branding/ahram-logo.png'
    const html = renderDeliveryPermitHtml(data, logoUrl)
    if (compact) {
      const comp = html.replace(/size: A4/, 'size: A5').replace(/1cm/g, '0.4cm').replace(/10pt/g, '8pt').replace(/18pt/g, '11pt').replace(/20pt/g, '14pt')
      printInvoice(comp)
    } else {
      printInvoice(html)
    }
  }

  async function handlePdfDownload() {
    const logoUrl = window.location.origin + '/store/branding/ahram-logo.png'
    const html = renderDeliveryPermitHtml(data, logoUrl)
      .replace(/size: A4/, 'size: A5')
      .replace(/1cm/g, '0.4cm')
      .replace(/10pt/g, '8pt')
      .replace(/18pt/g, '11pt')
      .replace(/20pt/g, '14pt')
    const custName = (customer?.company_name || order.snapshot_customer_name || 'عميل').replace(/[\\/:*?"<>|]/g, '_')
    const createdDate = new Date(order.created_at).toLocaleDateString('ar-EG')
    const filename = `${custName} - ${createdDate}.pdf`
    await downloadInvoicePdf(html, filename)
  }

  function handleWhatsApp() {
    const display = buildOrderDisplayData({ order: data.order as any, items: data.items as any, liveCustomer: customer })
    sendWhatsAppFromDisplay(display)
  }

  function handleCopyMessage() {
    const display = buildOrderDisplayData({ order: data.order as any, items: data.items as any, liveCustomer: customer })
    copyWhatsAppFromDisplay(display)
  }

  const revisionCount = order.revision_number
  const totalEditCount = modification_history?.filter(e => e.field_name === 'REVISION_SNAPSHOT').length || 0
  const lastRevision = modification_history?.filter(e => e.field_name === 'REVISION_SNAPSHOT').sort((a, b) =>
    new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime()
  )[0]

  return (
    <div className="max-w-[1400px] mx-auto px-4 lg:px-6 pb-6 space-y-3">

      {/* ── 1. HEADER: Back + Status ── */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm">
        <div className="px-5 py-3">
          <div className="flex items-center justify-between">
            {onBack && (
              <button onClick={onBack} className="text-[13px] text-[#2563EB] hover:text-[#1D4ED8] transition-colors shrink-0 font-medium">
                الرجوع للطلبات
              </button>
            )}
            {overLimit && (
              <span className="text-[10px] bg-[#FEF2F2] text-[#DC2626] px-2 py-0.5 rounded-full border border-[#FECACA] shrink-0 font-medium">
                تجاوز الحد
              </span>
            )}
          </div>
          <div className="mt-2 flex justify-center">
            <StatusBadge status={order.status} size="lg" />
          </div>
        </div>
      </div>

      {/* ── 2. ORDER SUMMARY: Type + Creation Date + Total ── */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span style={{color:'#9CA3AF'}}>نوع الطلب:</span>
            <span className={'text-xs px-2 py-0.5 rounded font-medium ' + ((order as any).order_type === 'credit' ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700')}>
              {(order as any).order_type === 'credit' ? 'آجل' : 'نقدي'}
            </span>
          </div>
          <div className="text-[13px] text-[#6B7280]">
            <span>{formatDateTime(order.created_at)}</span>
          </div>
          <div className="text-[18px] font-bold text-[#111827]">
            {formatCurrencyShort(grandTotal)}
          </div>
        </div>
      </div>

      {/* ── 3. CUSTOMER: Name, Phone, Address, Location ── */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4 space-y-2 text-[13px]">
        <div>
          <span style={{color:'#9CA3AF'}}>اسم العميل:</span>{' '}
          <span className="font-semibold text-[26px] text-primary cursor-pointer hover:text-primary/70 underline decoration-transparent hover:decoration-primary/30 transition-all" onClick={() => customer?.id && navigate(`/customers/${customer.id}`)}>
            {customer?.company_name || order.snapshot_customer_name || 'غير متوفر'}
          </span>
        </div>
        <div>
          <span style={{color:'#9CA3AF'}}>الهاتف:</span>{' '}
          <a href={`tel:${customer?.phone || order.snapshot_customer_phone}`} className="font-semibold text-[#2563EB] font-mono underline">
            {customer?.phone || order.snapshot_customer_phone || 'غير متوفر'}
          </a>
        </div>
        {customer && (customer.address_line1 || customer.address_line2 || customer.city || customer.governorate) && (
          <div>
            <span style={{color:'#9CA3AF'}}>العنوان:</span>{' '}
            <span className="font-semibold text-[#111827]">
              {[customer.address_line1, customer.address_line2, customer.city, customer.governorate].filter(Boolean).join(', ')}
            </span>
          </div>
        )}
        {customer?.gps_latitude != null && customer?.gps_longitude != null && (
          <div>
            <a
              href={`https://www.google.com/maps?q=${customer.gps_latitude},${customer.gps_longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-[#2563EB] bg-[#EFF6FF] hover:bg-[#DBEAFE] px-3 py-1.5 rounded-lg transition-colors font-medium"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              فتح الموقع على الخريطة
            </a>
          </div>
        )}
      </div>

      {/* ── 4. ORDER CREATOR ── */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4 text-[13px]">
        <span style={{color:'#9CA3AF'}}>منشئ الطلب:</span>{' '}
        <span className="font-semibold text-[#111827]">
          <OrderOwnershipInfo
            creatorName={order.order_creator_name}
            creatorId={order.order_creator_id}
            creatorType={order.order_creator_type}
            creatorRole={order.order_creator_role}
            ownerId={order.owner_id}
            currentOwnerName={order.current_owner_name}
          />
        </span>
      </div>

      {/* ── 5. PRODUCTS TABLE (unchanged) ── */}
      <OrderProductsSection
        items={editMode && editItems ? editItems : items}
        order={order}
        mode={editMode ? 'edit' : 'view'}
        onQuantityChange={onQuantityChange}
        onRemoveItem={onRemoveItem}
        onPriceChange={onPriceChange}
        onAddProduct={onAddProduct}
      />
      {editMode && editActions && (
        <div className="sticky bottom-0 z-10 bg-white border-t border-[#E5E7EB] shadow-[0_-4px_12px_rgba(0,0,0,0.08)] px-4 py-3 -mx-4 lg:-mx-6">
          {editActions}
        </div>
      )}

      {/* ── 6. PRIMARY ACTIONS ── */}
      {actions && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4">
          <div className="flex items-stretch gap-2 flex-wrap">
            {actions}
          </div>
        </div>
      )}

      {/* ── 7. ORDER TIMELINE ── */}
      <OrderTimelineSection timelineEvents={timelineEvents} />

      {/* ── 8. REMAINING: everything else ── */}

      {/* Last Visit */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div>
          {data.last_visit && data.last_visit.start_latitude != null && data.last_visit.start_longitude != null ? (
            <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4 h-full">
              <p className="text-[14px] font-bold text-[#111827] mb-2">آخر زيارة للعميل</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                <div><p className="text-[#9CA3AF] text-[11px]">المسؤول</p><p className="font-semibold text-[#111827]">{data.last_visit.employee_name || 'غير متوفر'}</p></div>
                <div><p className="text-[#9CA3AF] text-[11px]">بداية الزيارة</p><p className="font-semibold text-[#111827]">{formatDateTime(data.last_visit.started_at)}</p></div>
                {data.last_visit.completed_at && <div><p className="text-[#9CA3AF] text-[11px]">نهاية الزيارة</p><p className="font-semibold text-[#111827]">{formatDateTime(data.last_visit.completed_at)}</p></div>}
                <div><p className="text-[#9CA3AF] text-[11px]">حالة الزيارة</p><p className="font-semibold text-[#111827]">{data.last_visit.status}</p></div>
              </div>
              <div className="grid grid-cols-4 gap-2 mt-2">
                <a href={data.last_visit.maps_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1 text-xs text-[#DC2626] bg-[#FEF2F2] hover:bg-[#FEE2E2] px-2 py-1.5 rounded-lg transition-colors font-medium h-[30px]">
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                  فتح
                </a>
                <button onClick={() => { copyToClipboard(data.last_visit.maps_url).then((ok) => { if (ok) window.alert('تم نسخ الرابط') }) }}
                  className="flex items-center justify-center gap-1 text-xs text-[#2563EB] bg-[#EFF6FF] hover:bg-[#DBEAFE] px-2 py-1.5 rounded-lg transition-colors font-medium h-[30px]">
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                  نسخ
                </button>
                <button onClick={() => { if (navigator.share) navigator.share({title:'الموقع', text:'', url:data.last_visit.maps_url}) }}
                  className="flex items-center justify-center gap-1 text-xs text-[#059669] bg-[#ECFDF5] hover:bg-[#D1FAE5] px-2 py-1.5 rounded-lg transition-colors font-medium h-[30px]">
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
                  مشاركة
                </button>
                <button onClick={() => fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${data.last_visit.start_latitude}&lon=${data.last_visit.start_longitude}&accept-language=ar`).then(r=>r.json()).then(d=>window.alert(d.display_name||'تعذر استخراج العنوان')).catch(()=>window.alert('تعذر استخراج العنوان'))}
                  className="flex items-center justify-center gap-1 text-xs text-[#D97706] bg-[#FFFBEB] hover:bg-[#FEF3C7] px-2 py-1.5 rounded-lg transition-colors font-medium h-[30px]">
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
                  عنوان
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5 flex flex-col items-center justify-center gap-1.5 h-full min-h-[100px]">
              <span className="text-2xl">📍</span>
              <p className="text-xs text-[#6B7280] text-center">لم تتم أي زيارة لهذا العميل حتى الآن.</p>
            </div>
          )}
        </div>
        <div>
          {(customer?.previous_order_count != null && customer.previous_order_count > 0) ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-3 flex flex-col items-center justify-center">
                <p className="text-[10px] text-[#9CA3AF] font-medium text-center">الطلبات السابقة</p>
                <p className="text-[15px] font-bold text-[#111827]">{customer.previous_order_count}</p>
              </div>
              <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-3 flex flex-col items-center justify-center">
                <p className="text-[10px] text-[#9CA3AF] font-medium text-center">المشتريات السابقة</p>
                <p className="text-[15px] font-bold text-[#059669]">{formatCurrencyShort(Number(customer.previous_orders_total))}</p>
              </div>
              <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-3 flex flex-col items-center justify-center">
                <p className="text-[10px] text-[#9CA3AF] font-medium text-center">آخر طلب سابق</p>
                <p className="text-[12px] font-bold text-[#111827] font-mono">{customer.previous_order_number || '—'}</p>
              </div>
              <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-3 flex flex-col items-center justify-center">
                <p className="text-[10px] text-[#9CA3AF] font-medium text-center">قيمة آخر طلب</p>
                {customer.previous_order_total != null && <p className="text-[13px] font-bold text-[#111827]">{formatCurrencyShort(Number(customer.previous_order_total))}</p>}
                {customer.previous_order_date && <p className="text-[10px] text-[#6B7280]">{new Date(customer.previous_order_date).toLocaleDateString('ar-EG')}</p>}
              </div>
            </div>
          ) : customer?.previous_order_count != null ? (
            <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5 flex flex-col items-center justify-center h-full min-h-[100px]">
              <p className="text-xs text-[#6B7280]">هذا أول طلب للعميل</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Order Notes */}
      {order.notes && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4">
          <p className="text-[13px] font-bold text-[#111827] mb-1">ملاحظات</p>
          <p className="text-[12px] text-[#6B7280] leading-relaxed">{order.notes}</p>
        </div>
      )}

      {/* Delivery */}
      <OrderDeliverySection current_delivery={current_delivery} delivery_mode={order.delivery_mode} customer={customer} />

      {/* ── Order Number ── */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4">
        <div className="flex items-center gap-1.5">
          <span style={{color:'#9CA3AF'}}>رقم الطلب:</span>
          <span className="text-[18px] font-bold text-[#111827]">{order.order_number}</span>
        </div>
      </div>

      {/* Collections */}
      {collections && collections.length > 0 && (
        <OrderCollectionsSection collections={collections} />
      )}

      {/* Returns */}
      <OrderReturnsSection returns={data.returns} />

      {/* Modification History */}
      {modification_history && modification_history.length > 0 && (
        <ModificationHistoryPanel
          entries={modification_history}
          revisionNumber={order.revision_number}
          lastRevisedAt={order.last_revised_at}
        />
      )}

      {/* Quick Actions */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4">
        <p className="text-[13px] font-bold text-[#111827] mb-3">إجراءات</p>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          <button onClick={() => handlePdf(false)}
            className="bg-[#2563EB] text-white text-[12px] py-2.5 rounded-lg active:opacity-90 transition-colors hover:bg-[#1D4ED8] font-medium h-[38px]">
            PDF
          </button>
          <button onClick={() => handlePdf(true)}
            className="bg-[#059669] text-white text-[12px] py-2.5 rounded-lg active:opacity-90 transition-colors hover:bg-[#047857] font-medium h-[38px]">
            PDF A5
          </button>
          <button onClick={handlePdfDownload}
            className="bg-[#D97706] text-white text-[12px] py-2.5 rounded-lg active:opacity-90 transition-colors hover:bg-[#B45309] font-medium h-[38px]">
            تحميل PDF A5
          </button>
          <button onClick={handleWhatsApp}
            className="bg-[#059669] text-white text-[12px] py-2.5 rounded-lg active:opacity-90 transition-colors hover:bg-[#047857] font-medium h-[38px]">
            مشاركة واتساب
          </button>
          <button onClick={handleCopyMessage}
            className="bg-[#6B7280] text-white text-[12px] py-2.5 rounded-lg active:opacity-90 transition-colors hover:bg-[#4B5563] font-medium h-[38px]">
            نسخ الرسالة
          </button>
        </div>
      </div>

      {/* Remaining admin info */}
      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
          <div className="flex items-center gap-1.5">
            <span style={{color:'#9CA3AF'}}>المسؤول:</span>
            <span className="font-medium text-[#111827]">{order.customer_owner_name || '—'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{color:'#9CA3AF'}}>تاريخ الإنشاء:</span>
            <span className="font-medium text-[#111827]">{formatDateTime(order.created_at)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{color:'#9CA3AF'}}>آخر تحديث:</span>
            <span className="font-medium text-[#111827]">{formatDateTime(order.updated_at)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span style={{color:'#9CA3AF'}}>نوع التوصيل:</span>
            <span className="font-medium text-[#111827]">{order.delivery_mode === 'internal' ? 'داخلى' : 'شركة شحن'}</span>
          </div>
        </div>
        {(revisionCount > 0 || order.status === 'returned_for_revision') && (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className="text-[10px] bg-[#FFFBEB] text-[#D97706] px-2 py-0.5 rounded-full border border-[#FDE68A] font-medium">
              Revision #{revisionCount + 1}
            </span>
            {totalEditCount > 0 && (
              <span className="text-[10px] bg-[#EFF6FF] text-[#2563EB] px-2 py-0.5 rounded-full border border-[#BFDBFE] font-medium">
                {totalEditCount} تعديل{totalEditCount !== 1 ? 'ات' : ''}
              </span>
            )}
            {lastRevision?.reason && (
              <span className="text-[10px] text-[#6B7280]">{lastRevision.reason}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
