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
    <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm overflow-hidden">
      <div className="grid grid-cols-3 gap-0">
        <div className="p-4 text-center border-l border-[#E5E7EB]">
          <p className="text-xs font-medium mb-1.5" style={{color:'#9CA3AF'}}>الطلب</p>
          <StatusBadge status={order.status} size="sm" />
        </div>
        <div className="p-4 text-center border-l border-[#E5E7EB]">
          <p className="text-xs font-medium mb-1.5" style={{color:'#9CA3AF'}}>التوصيل</p>
          {current_delivery ? (
            <span className={`inline-block px-3 py-1 rounded-full font-semibold ${
              current_delivery.status === 'delivered' ? 'bg-[#ECFDF5] text-[#059669]' :
              current_delivery.status === 'out_for_delivery' ? 'bg-[#FFFBEB] text-[#D97706]' :
              current_delivery.status === 'assigned' ? 'bg-[#EFF6FF] text-[#2563EB]' :
              current_delivery.status === 'failed' ? 'bg-[#FEF2F2] text-[#DC2626]' :
              'bg-[#F3F4F6] text-gray-500'
            }`}>
              {current_delivery.status === 'assigned' ? 'تم الإسناد' :
               current_delivery.status === 'out_for_delivery' ? 'خرج للتوصيل' :
               current_delivery.status === 'delivered' ? 'تم التسليم' :
               current_delivery.status === 'failed' ? 'فشل التوصيل' : current_delivery.status}
            </span>
          ) : (
            <span className="inline-block px-3 py-1 rounded-full bg-[#F3F4F6] font-medium" style={{color:'#6B7280'}}>
              بانتظار التوصيل
            </span>
          )}
        </div>
        <div className="p-4 text-center">
          <p className="text-xs font-medium mb-1.5" style={{color:'#9CA3AF'}}>التحصيل</p>
          <span className={`inline-block px-3 py-1 rounded-full font-semibold ${
            collectionStatus === 'محصل بالكامل' ? 'bg-[#ECFDF5] text-[#059669]' :
            collectionStatus === 'محصل جزئى' ? 'bg-[#FFFBEB] text-[#D97706]' :
            'bg-[#F3F4F6] text-gray-500'
          }`}>
            {collectionStatus}
          </span>
        </div>
      </div>
      <div className="border-t border-[#E5E7EB] px-5 py-3 bg-[#F9FAFB] grid grid-cols-3 gap-4" style={{fontSize:'12px'}}>
        <div className="flex items-center justify-between">
          <span style={{color:'#9CA3AF'}}>نوع التوصيل</span>
          <span className="font-semibold" style={{color:'#111827'}}>{order.delivery_mode === 'internal' ? 'داخلى' : 'شركة شحن'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{color:'#9CA3AF'}}>محاولات التوصيل</span>
          <span className="font-semibold" style={{color:'#111827'}}>{deliveryAttempts}</span>
        </div>
        <div className="flex items-center justify-between">
          <span style={{color:'#9CA3AF'}}>المسؤول الحالى</span>
          <span className="font-semibold" style={{color:'#111827'}}>{currentOwner}</span>
        </div>
      </div>
    </div>
  )
}