import { MapButton } from '../shared/MapButton'
import { formatDateTime } from '../../utils/format'
import type { UnifiedDeliveryTracking, UnifiedCustomerSummary } from '../../types/unified-order'

interface OrderDeliverySectionProps {
  current_delivery: UnifiedDeliveryTracking | null
  delivery_mode: string
  customer: UnifiedCustomerSummary | null
}

export function OrderDeliverySection({ current_delivery, delivery_mode, customer }: OrderDeliverySectionProps) {
  const hasAddressCoords = customer?.address_latitude != null && customer?.address_longitude != null

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5">
      <p className="text-[14px] font-bold text-[#111827] mb-3">التوصيل</p>

      {delivery_mode === 'internal' ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-[13px]">
          <div>
            <p className="text-[#9CA3AF] text-[11px] font-medium">نوع التوصيل</p>
            <p className="font-semibold text-[#111827] mt-0.5">داخلى</p>
          </div>
          {current_delivery && (
            <>
              <div>
                <p className="text-[#9CA3AF] text-[11px] font-medium">المندوب</p>
                <p className="font-semibold text-[#111827] mt-0.5">{current_delivery.assigned_to_name || 'غير محدد'}</p>
              </div>
              {current_delivery.assigned_to_phone && (
                <div>
                  <p className="text-[#9CA3AF] text-[11px] font-medium">الهاتف</p>
                  <p className="font-semibold text-[#111827] mt-0.5 font-mono" dir="ltr">{current_delivery.assigned_to_phone}</p>
                </div>
              )}
              <div>
                <p className="text-[#9CA3AF] text-[11px] font-medium">الحالة</p>
                <span className={`inline-block text-[11px] px-2 py-0.5 rounded-full font-medium mt-0.5 ${
                  current_delivery.status === 'delivered' ? 'bg-[#ECFDF5] text-[#059669]' :
                  current_delivery.status === 'out_for_delivery' ? 'bg-[#FFFBEB] text-[#D97706]' :
                  current_delivery.status === 'assigned' ? 'bg-[#EFF6FF] text-[#2563EB]' :
                  current_delivery.status === 'failed' ? 'bg-[#FEF2F2] text-[#DC2626]' :
                  'bg-[#F3F4F6] text-[#6B7280]'
                }`}>
                  {current_delivery.status === 'assigned' ? 'تم الإسناد' :
                   current_delivery.status === 'out_for_delivery' ? 'خرج للتوصيل' :
                   current_delivery.status === 'delivered' ? 'تم التسليم' :
                   current_delivery.status === 'failed' ? 'فشل التوصيل' : current_delivery.status}
                </span>
              </div>
              <div>
                <p className="text-[#9CA3AF] text-[11px] font-medium">آخر تحديث</p>
                <p className="font-semibold text-[#111827] mt-0.5">{formatDateTime(current_delivery.updated_at || current_delivery.started_at || current_delivery.assigned_at || '')}</p>
              </div>
              <div>
                <p className="text-[#9CA3AF] text-[11px] font-medium">المحاولة</p>
                <p className="font-semibold text-[#111827] mt-0.5">#{current_delivery.attempt_number}</p>
              </div>
              {hasAddressCoords && (
                <div className="mt-1">
                  <MapButton latitude={customer!.address_latitude!} longitude={customer!.address_longitude!} size="sm" />
                </div>
              )}
            </>
          )}
          {!current_delivery && (
            <div className="col-span-4">
              <p className="text-[13px] text-[#6B7280]">بانتظار إسناد التوصيل</p>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-[13px]">
          <div>
            <p className="text-[#9CA3AF] text-[11px] font-medium">نوع التوصيل</p>
            <p className="font-semibold text-[#111827] mt-0.5">شركة شحن</p>
          </div>
          {current_delivery?.external_carrier_name && (
            <div>
              <p className="text-[#9CA3AF] text-[11px] font-medium">شركة الشحن</p>
              <p className="font-semibold text-[#111827] mt-0.5">{current_delivery.external_carrier_name}</p>
            </div>
          )}
          {current_delivery?.waybill_number && (
            <div>
              <p className="text-[#9CA3AF] text-[11px] font-medium">رقم البوليصة</p>
              <p className="font-semibold text-[#111827] mt-0.5 font-mono" dir="ltr">{current_delivery.waybill_number}</p>
            </div>
          )}
          {current_delivery?.tracking_url && (
            <div>
              <a href={current_delivery.tracking_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[#2563EB] bg-[#EFF6FF] px-2 py-1 rounded-lg hover:bg-[#DBEAFE] transition-colors mt-1">
                تتبع الشحنة
              </a>
            </div>
          )}
          {current_delivery && (
            <div>
              <p className="text-[#9CA3AF] text-[11px] font-medium">الحالة</p>
              <p className="font-semibold text-[#111827] mt-0.5">{current_delivery.status === 'assigned' ? 'تم الإسناد' : current_delivery.status}</p>
            </div>
          )}
          {!current_delivery && (
            <div className="col-span-4">
              <p className="text-[13px] text-[#6B7280]">لم يتم إرسال الطلب للتوصيل بعد</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}