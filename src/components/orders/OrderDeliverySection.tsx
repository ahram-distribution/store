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
    <div className="bg-white rounded-xl border border-border p-4">
      <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">التوصيل</p>

      {delivery_mode === 'internal' ? (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-text-secondary shrink-0">نوع التوصيل</span>
            <span className="font-medium text-text">داخلى</span>
          </div>
          {current_delivery && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-text-secondary shrink-0">المندوب</span>
                <span className="font-medium text-text">{current_delivery.assigned_to_name || 'غير محدد'}</span>
              </div>
              {current_delivery.assigned_to_phone && (
                <div className="flex items-center gap-2">
                  <span className="text-text-secondary shrink-0">الهاتف</span>
                  <span className="font-medium text-text" dir="ltr">{current_delivery.assigned_to_phone}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-text-secondary shrink-0">الحالة</span>
                <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  current_delivery.status === 'delivered' ? 'bg-emerald-100 text-emerald-700' :
                  current_delivery.status === 'out_for_delivery' ? 'bg-amber-100 text-amber-700' :
                  current_delivery.status === 'assigned' ? 'bg-blue-100 text-blue-700' :
                  current_delivery.status === 'failed' ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {current_delivery.status === 'assigned' ? 'تم الإسناد' :
                   current_delivery.status === 'out_for_delivery' ? 'خرج للتوصيل' :
                   current_delivery.status === 'delivered' ? 'تم التسليم' :
                   current_delivery.status === 'failed' ? 'فشل التوصيل' : current_delivery.status}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-text-secondary shrink-0">آخر تحديث</span>
                <span className="font-medium text-text">{formatDateTime(current_delivery.updated_at || current_delivery.started_at || current_delivery.assigned_at || '')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-text-secondary shrink-0">المحاولة</span>
                <span className="font-medium text-text">#{current_delivery.attempt_number}</span>
              </div>
              {hasAddressCoords && (
                <div className="mt-2">
                  <MapButton latitude={customer!.address_latitude!} longitude={customer!.address_longitude!} size="sm" />
                </div>
              )}
            </>
          )}
          {!current_delivery && (
            <p className="text-xs text-text-secondary">بانتظار إسناد التوصيل</p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-text-secondary shrink-0">نوع التوصيل</span>
            <span className="font-medium text-text">شركة شحن</span>
          </div>
          {current_delivery?.external_carrier_name && (
            <div className="flex items-center gap-2">
              <span className="text-text-secondary shrink-0">شركة الشحن</span>
              <span className="font-medium text-text">{current_delivery.external_carrier_name}</span>
            </div>
          )}
          {current_delivery?.waybill_number && (
            <div className="flex items-center gap-2">
              <span className="text-text-secondary shrink-0">رقم البوليصة</span>
              <span className="font-medium text-text font-mono" dir="ltr">{current_delivery.waybill_number}</span>
            </div>
          )}
          {current_delivery?.tracking_url && (
            <div className="mt-1">
              <a href={current_delivery.tracking_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 px-2 py-1 rounded-lg hover:bg-blue-100 transition-colors">
                🔗 تتبع الشحنة
              </a>
            </div>
          )}
          {current_delivery && (
            <div className="flex items-center gap-2">
              <span className="text-text-secondary shrink-0">الحالة</span>
              <span className="font-medium text-text">{current_delivery.status === 'assigned' ? 'تم الإسناد' : current_delivery.status}</span>
            </div>
          )}
          {!current_delivery && (
            <p className="text-xs text-text-secondary">لم يتم إرسال الطلب للتوصيل بعد</p>
          )}
        </div>
      )}
    </div>
  )
}
