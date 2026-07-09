import { useNavigate } from 'react-router-dom'
import { Phone, MapPin, User, ShoppingCart, DollarSign, FileText, Calendar, Eye } from 'lucide-react'
import { formatCurrencyShort, formatDate, formatDateTime } from '../../utils/format'
import type { CustomerCardData } from '../../types/customers'

interface CustomerCardProps {
  customer: CustomerCardData
}

export function CustomerCard({ customer }: CustomerCardProps) {
  const navigate = useNavigate()
  const hasNoOrders = !customer.previous_order_count || customer.previous_order_count === 0

  return (
    <div
      onClick={() => navigate(`/customers/${customer.id}`)}
      className={`h-full rounded-xl border-2 bg-white p-3 cursor-pointer active:scale-[0.98] transition-all hover:shadow-md flex flex-col ${
        !customer.is_active
          ? 'border-red-200 bg-red-50/40'
          : hasNoOrders
            ? 'border-orange-300 bg-orange-50/40'
            : 'border-border'
      }`}
    >
      {/* 1. Customer Name */}
      <h3 className="text-sm font-bold text-text leading-tight line-clamp-1">{customer.company_name}</h3>

      {/* 2. Badge */}
      {hasNoOrders && (
        <div className="mt-1">
          <span className="inline-block text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium border border-orange-200 leading-none">
            🟧 عميل بدون طلبات
          </span>
        </div>
      )}

      {/* 3. Registered address */}
      {customer.registered_address && (
        <div className="flex items-start gap-1.5 mt-1.5 text-[11px] text-text-secondary">
          <MapPin className="w-3 h-3 shrink-0 text-text-muted mt-0.5" />
          <span className="truncate">{customer.registered_address}</span>
        </div>
      )}

      {/* 4. Location address */}
      {customer.location_address && (
        <div className="flex items-start gap-1.5 mt-1 text-[11px] text-text-secondary">
          <MapPin className="w-3 h-3 shrink-0 text-text-muted mt-0.5" />
          <span className="truncate">{customer.location_address}</span>
        </div>
      )}
      {!customer.location_address && !customer.registered_address && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-text-muted">
          <MapPin className="w-3 h-3 shrink-0" />
          <span>لا يوجد عنوان</span>
        </div>
      )}

      {/* 5. Phone */}
      {customer.phone && (
        <div className="flex items-center gap-1.5 mt-1 text-[11px] text-text-secondary">
          <Phone className="w-3 h-3 shrink-0 text-text-muted" />
          <span dir="ltr" className="text-left">{customer.phone}</span>
        </div>
      )}

      {/* 6. Owner */}
      {customer.owner_name && (
        <div className="flex items-center gap-1.5 mt-1 text-[11px] text-text-secondary">
          <User className="w-3 h-3 shrink-0 text-text-muted" />
          <span className="truncate">{customer.owner_name}</span>
        </div>
      )}

      {/* Divider */}
      <div className="mt-2 mb-2 border-t border-border/50" />

      {/* Stats */}
      <div className="space-y-1.5">
        {customer.previous_order_count !== null && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-muted">عدد الطلبات السابقة</span>
            <span className="font-semibold text-text" dir="ltr">{customer.previous_order_count}</span>
          </div>
        )}
        {customer.previous_orders_total !== null && customer.previous_orders_total > 0 && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-muted">إجمالي المشتريات</span>
            <span className="font-semibold text-text" dir="ltr">{formatCurrencyShort(customer.previous_orders_total)}</span>
          </div>
        )}
        {customer.last_order_number && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-muted">آخر طلب</span>
            <span className="font-semibold text-text truncate max-w-[55%]" dir="ltr">{customer.last_order_number}</span>
          </div>
        )}
        {customer.last_order_date && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-muted">تاريخ آخر طلب</span>
            <span className="font-semibold text-text">{formatDate(customer.last_order_date)}</span>
          </div>
        )}
        {customer.visit_count !== null && customer.visit_count > 0 && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-muted">عدد الزيارات</span>
            <span className="font-semibold text-text" dir="ltr">{customer.visit_count}</span>
          </div>
        )}
        {customer.last_visit_date && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-muted">آخر زيارة</span>
            <span className="font-semibold text-text">{formatDateTime(customer.last_visit_date)}</span>
          </div>
        )}
        {(!customer.visit_count || customer.visit_count === 0) && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-text-muted">الزيارات</span>
            <span className="text-text-secondary">🚫 لم تتم أي زيارة</span>
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1 min-h-[6px]" />

      {/* Actions */}
      <div className="flex gap-2 pt-2 border-t border-border/50 mt-2">
        <button
          onClick={(e) => { e.stopPropagation(); navigate(`/customers/${customer.id}`) }}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2.5 rounded-lg transition-colors font-medium h-[36px] bg-primary text-white hover:opacity-90"
        >
          <Eye className="w-3.5 h-3.5" />
          عرض التفاصيل
        </button>
      </div>
    </div>
  )
}
