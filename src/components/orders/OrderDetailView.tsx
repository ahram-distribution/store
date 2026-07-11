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
import { resolveLocation } from '../../utils/location-resolver'
import { ORDER_STATUS_LABELS } from '../../types/order-display'
import { renderDeliveryPermitHtml, printInvoice } from './order-printing'
import { buildTimelineEvents } from './order-detail.utils'
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
  const resolvedLocation = useMemo(() => resolveLocation(customer, order), [customer, order])
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

  function handleWhatsApp() {
    const display = buildOrderDisplayData({ order: data.order as any, items: data.items as any })
    sendWhatsAppFromDisplay(display)
  }

  function handleCopyMessage() {
    const display = buildOrderDisplayData({ order: data.order as any, items: data.items as any })
    copyWhatsAppFromDisplay(display)
  }

  function renderCreator() {
    const name = order.order_creator_name
    const role = order.order_creator_role || 'عميل'
    if (!name) return <span className="text-[#6B7280]">—</span>
    const target = order.order_creator_type === 'customer'
      ? `/customers/${order.order_creator_id}`
      : `/employees/${order.order_creator_id}`
    if (!order.order_creator_id) return <span>{name}<span className="text-[#6B7280]"> — {role}</span></span>
    return (
      <span className="cursor-pointer hover:opacity-70 transition-opacity" onClick={() => navigate(target)}>
        {name}
        <span className="text-[#6B7280]"> — {role}</span>
      </span>
    )
  }

  const revisionCount = order.revision_number
  const totalEditCount = modification_history?.filter(e => e.field_name === 'REVISION_SNAPSHOT').length || 0
  const lastRevision = modification_history?.filter(e => e.field_name === 'REVISION_SNAPSHOT').sort((a, b) =>
    new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime()
  )[0]

  return (
    <div className="max-w-[1400px] mx-auto px-4 lg:px-6 pb-6 space-y-3">

      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm">
        <div className="px-5 py-3">
          <div className="flex items-center gap-3">
            {onBack && (
              <button onClick={onBack} className="text-[#6B7280] text-lg hover:text-[#111827] transition-colors shrink-0 leading-none">&larr;</button>
            )}
            <h1 className="text-[18px] font-bold text-[#111827] truncate leading-tight">{order.order_number}</h1>
            <StatusBadge status={order.status} size="sm" />
            {overLimit && (
              <span className="text-[10px] bg-[#FEF2F2] text-[#DC2626] px-2 py-0.5 rounded-full border border-[#FECACA] shrink-0 font-medium">
                تجاوز الحد
              </span>
            )}
            <div className="mr-auto flex items-center gap-2">
              {actions}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 mt-2 text-[12px]">
            <div className="flex items-center gap-1.5">
              <span style={{color:'#9CA3AF'}}>المسؤول:</span>
              <span className="font-medium text-[#111827]">{order.customer_owner_name || '—'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{color:'#9CA3AF'}}>المنشئ:</span>
              <span className="font-medium text-[#111827]">{renderCreator()}</span>
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
              <span style={{color:'#9CA3AF'}}>طريقة الدفع:</span>
              <span className="font-medium text-[#111827]">{order.payment_method === 'credit' ? 'آجل' : 'نقدي'}</span>
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

      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
          <div><span style={{color:'#9CA3AF'}}>اسم العميل:</span> <span className="font-semibold text-primary cursor-pointer hover:text-primary/70 underline decoration-transparent hover:decoration-primary/30 transition-all" onClick={() => customer?.id && navigate(`/customers/${customer.id}`)}>{customer?.company_name || order.snapshot_customer_name || 'غير متوفر'}</span></div>
          <div><span style={{color:'#9CA3AF'}}>الكود:</span> <span className="font-semibold text-[#111827]">{customer?.code || '—'}</span></div>
          <div><span style={{color:'#9CA3AF'}}>الهاتف:</span> <span className="font-semibold text-[#111827] font-mono">{customer?.phone || order.snapshot_customer_phone || 'غير متوفر'}</span></div>
          <div><span style={{color:'#9CA3AF'}}>المحافظة:</span> <span className="font-semibold text-[#111827]">{resolvedLocation.governorate}</span></div>
          <div><span style={{color:'#9CA3AF'}}>المدينة:</span> <span className="font-semibold text-[#111827]">{resolvedLocation.city}</span></div>
          <div><span style={{color:'#9CA3AF'}}>المندوب:</span> <span className="font-semibold text-[#111827]">{order.customer_owner_name || '—'}</span></div>
        </div>
        {customer?.display_address && (
          <p className="text-[12px] text-[#6B7280] leading-relaxed mt-1">{customer.display_address}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-[#E5E7EB]">
          <a href={`tel:${customer?.phone || order.snapshot_customer_phone}`}
            className="flex items-center justify-center gap-1.5 text-xs text-[#2563EB] bg-[#EFF6FF] hover:bg-[#DBEAFE] px-3 py-1.5 rounded-lg transition-colors font-medium h-[32px]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
            اتصال
          </a>
          <a href={`https://wa.me/${(customer?.phone || order.snapshot_customer_phone || '').replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 text-xs text-[#059669] bg-[#ECFDF5] hover:bg-[#D1FAE5] px-3 py-1.5 rounded-lg transition-colors font-medium h-[32px]">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            واتساب
          </a>
          {customer?.address_latitude != null && customer?.address_longitude != null && (
            <>
              <a href={`https://www.google.com/maps?q=${customer.address_latitude},${customer.address_longitude}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 text-xs text-[#DC2626] bg-[#FEF2F2] hover:bg-[#FEE2E2] px-3 py-1.5 rounded-lg transition-colors font-medium h-[32px]">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                فتح الموقع
              </a>
              <button onClick={() => { navigator.clipboard.writeText(`https://www.google.com/maps?q=${customer.address_latitude},${customer.address_longitude}`); window.alert('تم نسخ الرابط')}}
                className="flex items-center justify-center gap-1.5 text-xs text-[#2563EB] bg-[#EFF6FF] hover:bg-[#DBEAFE] px-3 py-1.5 rounded-lg transition-colors font-medium h-[32px]">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                نسخ
              </button>
              <button onClick={() => { if (navigator.share) navigator.share({title:'الموقع', text:'', url:`https://www.google.com/maps?q=${customer.address_latitude},${customer.address_longitude}`}) }}
                className="flex items-center justify-center gap-1.5 text-xs text-[#059669] bg-[#ECFDF5] hover:bg-[#D1FAE5] px-3 py-1.5 rounded-lg transition-colors font-medium h-[32px]">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
                مشاركة
              </button>
            </>
          )}
        </div>
        {customer?.address_latitude == null && (
          <div className="mt-2 bg-[#F9FAFB] rounded-lg border border-[#E5E7EB] p-3 flex items-center gap-2">
            <span className="text-lg">📍</span>
            <p className="text-xs text-[#6B7280]">لم يتم رصد موقع العميل.</p>
          </div>
        )}
      </div>

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
                <button onClick={() => { navigator.clipboard.writeText(data.last_visit.maps_url); window.alert('تم نسخ الرابط')}}
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
      {order.notes && (
        <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4">
          <p className="text-[13px] font-bold text-[#111827] mb-1">ملاحظات</p>
          <p className="text-[12px] text-[#6B7280] leading-relaxed">{order.notes}</p>
        </div>
      )}

      <OrderDeliverySection current_delivery={current_delivery} delivery_mode={order.delivery_mode} customer={customer} />

      {collections && collections.length > 0 && (
        <OrderCollectionsSection collections={collections} />
      )}
      <OrderReturnsSection returns={data.returns} />
      {modification_history && modification_history.length > 0 && (
        <ModificationHistoryPanel
          entries={modification_history}
          revisionNumber={order.revision_number}
          lastRevisedAt={order.last_revised_at}
        />
      )}
      <OrderTimelineSection timelineEvents={timelineEvents} />

      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4">
        <p className="text-[13px] font-bold text-[#111827] mb-3">إجراءات</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <button onClick={() => handlePdf(false)}
            className="bg-[#2563EB] text-white text-[12px] py-2.5 rounded-lg active:opacity-90 transition-colors hover:bg-[#1D4ED8] font-medium h-[38px]">
            PDF
          </button>
          <button onClick={() => handlePdf(true)}
            className="bg-[#059669] text-white text-[12px] py-2.5 rounded-lg active:opacity-90 transition-colors hover:bg-[#047857] font-medium h-[38px]">
            PDF A5
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
    </div>
  )
}