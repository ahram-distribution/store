import { StatusBadge } from '../shared/StatusBadge'
import type { UnifiedOrder, UnifiedDeliveryTracking } from '../../types/unified-order'

interface OrderExecutiveStatusPanelProps {
  order: UnifiedOrder['order']
  current_delivery: UnifiedDeliveryTracking | null
  collectionStatus: string
  deliveryAttempts: number
  currentOwner: string
}

export function OrderExecutiveStatusPanel({
  order,
  current_delivery,
  collectionStatus,
  deliveryAttempts,
  currentOwner,
}: OrderExecutiveStatusPanelProps) {
  return (
    <div className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="grid grid-cols-3 divide-x divide-border">
        <div className="p-3 text-center">
          <p className="text-[9px] text-text-secondary font-bold uppercase mb-1">الطلب</p>
          <StatusBadge status={order.status} size="sm" />
        </div>
        <div className="p-3 text-center">
          <p className="text-[9px] text-text-secondary font-bold uppercase mb-1">التوصيل</p>
          {current_delivery ? (
            <span className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">
              {current_delivery.status === 'assigned' ? 'تم الإسناد' :
               current_delivery.status === 'out_for_delivery' ? 'خرج للتوصيل' :
               current_delivery.status === 'delivered' ? 'تم التسليم' :
               current_delivery.status === 'failed' ? 'فشل التوصيل' : current_delivery.status}
            </span>
          ) : (
            <span className="inline-block text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
              بانتصار التوصيل
            </span>
          )}
        </div>
        <div className="p-3 text-center">
          <p className="text-[9px] text-text-secondary font-bold uppercase mb-1">التحصيل</p>
          <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-medium ${
            collectionStatus === 'محصل بالكامل' ? 'bg-emerald-100 text-emerald-700' :
            collectionStatus === 'محصل جزئى' ? 'bg-amber-100 text-amber-700' :
            'bg-gray-100 text-gray-500'
          }`}>
            {collectionStatus}
          </span>
        </div>
      </div>
      <div className="border-t border-border px-3 py-2 bg-surface/30 text-[10px] space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-text-secondary">نوع التوصيل</span>
          <span className="font-medium text-text">{order.delivery_mode === 'internal' ? 'داخلى' : 'شركة شحن'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-secondary">عدد محاولات التوصيل</span>
          <span className="font-medium text-text">{deliveryAttempts}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-text-secondary">المسؤول الحالى</span>
          <span className="font-medium text-text">{currentOwner}</span>
        </div>
      </div>
    </div>
  )
}
