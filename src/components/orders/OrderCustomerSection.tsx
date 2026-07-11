import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFullAddress } from './order-detail.utils'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import toast from 'react-hot-toast'
import type { UnifiedCustomerSummary, UnifiedOrderHeader, UnifiedOrder } from '../../types/unified-order'

interface OrderCustomerSectionProps {
  customer: UnifiedCustomerSummary | null
  order: UnifiedOrderHeader
  lastVisit?: UnifiedOrder['last_visit']
}

function LocationActionButtons({ url, lat, lng }: { url: string; lat: number; lng: number }) {
  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      toast.success('تم نسخ رابط الموقع')
    })
  }

  function handleShare() {
    if (navigator.share) {
      navigator.share({ title: 'الموقع', text: url, url }).catch(() => {
        navigator.clipboard.writeText(url)
        toast.success('تم نسخ رابط الموقع')
      })
    } else {
      navigator.clipboard.writeText(url)
      toast.success('تم نسخ رابط الموقع')
    }
  }

  const [address, setAddress] = useState<string | null>(null)
  const [addressLoading, setAddressLoading] = useState(false)

  function handleReverseGeocode() {
    if (address) return
    setAddressLoading(true)
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ar`)
      .then(r => r.json())
      .then(d => {
        setAddress(d.display_name || 'تعذر استخراج العنوان')
      })
      .catch(() => {
        setAddress('تعذر استخراج العنوان')
      })
      .finally(() => setAddressLoading(false))
  }

  return (
    <div>
      <div className="grid grid-cols-4 gap-2 mt-3">
        <a href={url} target="_blank" rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-xs text-[#DC2626] bg-[#FEF2F2] hover:bg-[#FEE2E2] px-3 py-2.5 rounded-lg transition-colors font-medium h-[36px]">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          فتح الموقع
        </a>
        <button onClick={handleCopy}
          className="flex items-center justify-center gap-1.5 text-xs text-[#2563EB] bg-[#EFF6FF] hover:bg-[#DBEAFE] px-3 py-2.5 rounded-lg transition-colors font-medium h-[36px]">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
          نسخ الرابط
        </button>
        <button onClick={handleShare}
          className="flex items-center justify-center gap-1.5 text-xs text-[#059669] bg-[#ECFDF5] hover:bg-[#D1FAE5] px-3 py-2.5 rounded-lg transition-colors font-medium h-[36px]">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
          مشاركة
        </button>
        <button onClick={handleReverseGeocode} disabled={addressLoading}
          className="flex items-center justify-center gap-1.5 text-xs text-[#D97706] bg-[#FFFBEB] hover:bg-[#FEF3C7] px-3 py-2.5 rounded-lg transition-colors font-medium disabled:opacity-40 h-[36px]">
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          {addressLoading ? 'جاري...' : 'العنوان'}
        </button>
      </div>
      {address && (
        <p className="text-xs text-[#6B7280] mt-2 leading-relaxed bg-[#F9FAFB] rounded-lg p-2 border border-[#E5E7EB]">{address}</p>
      )}
    </div>
  )
}

function StatsCard({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4 flex flex-col items-center justify-center min-h-[80px]">
      <p className="text-[11px] text-[#9CA3AF] mb-1 font-medium">{label}</p>
      <p className={`text-[15px] font-bold ${highlight ? 'text-[#059669]' : 'text-[#111827]'}`}>{value}</p>
    </div>
  )
}

export function OrderCustomerSection({ customer, order, lastVisit }: OrderCustomerSectionProps) {
  const navigate = useNavigate()
  const displayName = customer?.company_name || order.snapshot_customer_name || 'غير متوفر'
  const displayPhone = customer?.phone || order.snapshot_customer_phone || 'غير متوفر'
  const ownerName = order.customer_owner_name || 'غير متوفر'
  const fullAddress = useMemo(() => customer?.display_address || getFullAddress(customer, order), [customer, order])
  const hasAddressCoords = customer?.address_latitude != null && customer?.address_longitude != null
  const customerMapsUrl = hasAddressCoords
    ? `https://www.google.com/maps?q=${customer!.address_latitude},${customer!.address_longitude}`
    : null

  const [lastVisitAddress, setLastVisitAddress] = useState<string | null>(null)
  const [lastVisitAddressLoading, setLastVisitAddressLoading] = useState(false)

  function handleLastVisitGeocode() {
    if (lastVisitAddress || !lastVisit) return
    setLastVisitAddressLoading(true)
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lastVisit.start_latitude}&lon=${lastVisit.start_longitude}&accept-language=ar`)
      .then(r => r.json())
      .then(d => {
        setLastVisitAddress(d.display_name || 'تعذر استخراج العنوان')
      })
      .catch(() => {
        setLastVisitAddress('تعذر استخراج العنوان')
      })
      .finally(() => setLastVisitAddressLoading(false))
  }

  const hasPreviousOrders = customer?.previous_order_count != null && customer.previous_order_count > 0

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-7 bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xl">🏢</span>
                <span className="text-xl font-bold text-primary cursor-pointer hover:text-primary/70 underline decoration-transparent hover:decoration-primary/30 transition-all" onClick={() => customer?.id && navigate(`/customers/${customer.id}`)}>
                  {displayName}
                </span>
                {customer?.code && <span className="text-[11px] text-[#6B7280] font-mono bg-[#F9FAFB] px-2 py-0.5 rounded" dir="ltr">{customer.code}</span>}
              </div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base">👤</span>
                <span className="text-base font-semibold text-accent">{ownerName}</span>
                <span className="text-[11px] text-[#9CA3AF]">الموظف المسؤول</span>
              </div>
              <p className="text-[13px] text-[#6B7280] font-mono" dir="ltr">{displayPhone}</p>
              {fullAddress && (
                <p className="text-[13px] text-[#6B7280] mt-1 leading-relaxed">{fullAddress}</p>
              )}
            </div>
            {displayPhone !== 'غير متوفر' && displayPhone && (
              <div className="flex gap-2 shrink-0 mr-3">
                <a href={`tel:${displayPhone}`} className="flex items-center gap-1 text-xs text-[#2563EB] bg-[#EFF6FF] hover:bg-[#DBEAFE] px-3 py-2 rounded-lg transition-colors font-medium">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                  اتصال
                </a>
                {displayPhone.replace(/[^0-9]/g, '') && (
                  <a href={`https://wa.me/${displayPhone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-[#059669] bg-[#ECFDF5] hover:bg-[#D1FAE5] px-3 py-2 rounded-lg transition-colors font-medium">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    واتساب
                  </a>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-[#E5E7EB]">
            <div>
              <p className="text-[11px] text-[#9CA3AF] font-medium">الكود</p>
              <p className="text-[13px] font-semibold text-[#111827] mt-0.5">{customer?.code || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] text-[#9CA3AF] font-medium">النوع</p>
              <p className="text-[13px] font-semibold text-[#111827] mt-0.5">{order.payment_method === 'credit' ? 'آجل' : 'نقدي'}</p>
            </div>
            <div>
              <p className="text-[11px] text-[#9CA3AF] font-medium">المندوب</p>
              <p className="text-[13px] font-semibold text-[#111827] mt-0.5">{order.customer_owner_name || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] text-[#9CA3AF] font-medium">الرصيد</p>
              <p className="text-[13px] font-semibold text-[#111827] mt-0.5">—</p>
            </div>
          </div>

          {hasAddressCoords && customerMapsUrl ? (
            <LocationActionButtons url={customerMapsUrl} lat={customer!.address_latitude!} lng={customer!.address_longitude!} />
          ) : (
            <div className="mt-3 bg-[#F9FAFB] rounded-lg border border-[#E5E7EB] p-3 flex items-center gap-2">
              <span className="text-base">📍</span>
              <span className="text-xs text-[#6B7280]">لم يتم رصد موقع العميل.</span>
            </div>
          )}
        </div>

        <div className="lg:col-span-5">
          {hasPreviousOrders ? (
            <div className="grid grid-rows-3 gap-3 h-full">
              <StatsCard label="الطلبات السابقة" value={customer!.previous_order_count} />
              <StatsCard label="المشتريات السابقة" value={formatCurrencyShort(Number(customer!.previous_orders_total))} />
              {customer?.previous_order_number ? (
                <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4 flex flex-col items-center justify-center min-h-[80px]">
                  <p className="text-[11px] text-[#9CA3AF] mb-1 font-medium">آخر طلب سابق</p>
                  <p className="text-[13px] font-bold text-[#111827] font-mono">{customer.previous_order_number}</p>
                  <div className="flex items-center gap-3 mt-0.5 text-[11px] text-[#6B7280]">
                    <span>{customer.previous_order_date ? formatDate(new Date(customer.previous_order_date)) : '—'}</span>
                    <span className="font-bold text-[#111827]">{customer.previous_order_total != null ? formatCurrencyShort(Number(customer.previous_order_total)) : '—'}</span>
                  </div>
                </div>
              ) : (
                <StatsCard label="آخر طلب سابق" value="—" />
              )}
            </div>
          ) : customer?.previous_order_count != null ? (
            <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5 flex items-center justify-center h-full">
              <p className="text-xs text-[#6B7280]">هذا أول طلب للعميل</p>
            </div>
          ) : null}
        </div>
      </div>

      {lastVisit && lastVisit.start_latitude != null && lastVisit.start_longitude != null ? (
        <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5 mt-3">
          <p className="text-[14px] font-bold text-[#111827] mb-3">آخر زيارة للعميل</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
            <div>
              <p className="text-[11px] text-[#9CA3AF] font-medium">المسؤول</p>
              <p className="text-[13px] font-semibold text-[#111827] mt-0.5">{lastVisit.employee_name || 'غير متوفر'}</p>
            </div>
            <div>
              <p className="text-[11px] text-[#9CA3AF] font-medium">بداية الزيارة</p>
              <p className="text-[13px] font-semibold text-[#111827] mt-0.5">{formatDate(new Date(lastVisit.started_at))}</p>
            </div>
            {lastVisit.completed_at && (
              <div>
                <p className="text-[11px] text-[#9CA3AF] font-medium">نهاية الزيارة</p>
                <p className="text-[13px] font-semibold text-[#111827] mt-0.5">{formatDate(new Date(lastVisit.completed_at))}</p>
              </div>
            )}
            <div>
              <p className="text-[11px] text-[#9CA3AF] font-medium">حالة الزيارة</p>
              <p className="text-[13px] font-semibold text-[#111827] mt-0.5">{lastVisit.status}</p>
            </div>
          </div>
          <LocationActionButtons url={lastVisit.maps_url} lat={lastVisit.start_latitude} lng={lastVisit.start_longitude} />
        </div>
      ) : lastVisit ? (
        <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5 mt-3">
          <p className="text-[14px] font-bold text-[#111827] mb-2">آخر زيارة للعميل</p>
          <div className="bg-[#F9FAFB] rounded-lg border border-[#E5E7EB] p-3 flex items-center gap-2">
            <span className="text-base">🚫</span>
            <span className="text-xs text-[#6B7280]">لم تتم أي زيارة لهذا العميل حتى الآن.</span>
          </div>
        </div>
      ) : null}

      <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5 mt-3">
        <p className="text-[13px] font-bold text-[#111827] mb-2">التابع لـ:</p>
        <p className="text-[14px] font-semibold text-[#2563EB] cursor-pointer hover:opacity-70 transition-opacity" onClick={() => order.customer_owner_id && navigate(`/employees/${order.customer_owner_id}`)}>
          {order.customer_owner_name || 'غير متوفر'}
        </p>
        {order.customer_owner_role && (
          <p className="text-[12px] text-[#9CA3AF] mt-0.5">{order.customer_owner_role}</p>
        )}
      </div>
    </div>
  )
}