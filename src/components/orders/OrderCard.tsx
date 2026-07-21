import { memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { StatusBadge } from '../shared/StatusBadge'
import { OrderOwnershipInfo } from './OrderOwnershipInfo'

interface OrderCardProps {
  order: {
    id: string
    order_number: string
    customer_name?: string
    customer_phone?: string
    owner_name?: string
    owner_phone?: string
    creator_name?: string
    created_by_name?: string
    created_by_id?: string | null
    creator_phone?: string
    customer_owner_name?: string
    customer_owner_role?: string
    owner_id?: string | null
    total_amount: number | string
    status: string
    created_at: string
    updated_at?: string
    delivery_mode?: string
    order_type?: string
    revision_number?: number
    governorate?: string
    customer_display_address?: string | null
    previous_order_count?: number | null
    previous_orders_total?: number | null
    previous_order_number?: string | null
    previous_order_date?: string | null
    previous_order_total?: number | null
    collection_badge?: { label: string; className: string }
  }
  onClick?: () => void
  orderId?: string
}

const cardAccent: Record<string, string> = {
  draft: 'border-r-gray-200',
  submitted: 'border-r-blue-300',
  reviewing: 'border-r-blue-400',
  returned_for_revision: 'border-r-blue-300',
  approved: 'border-r-emerald-300',
  preparing: 'border-r-emerald-400',
  prepared: 'border-r-emerald-400',
  ready_for_dispatch: 'border-r-emerald-300',
  sent_to_delivery: 'border-r-emerald-400',
  dispatched: 'border-r-emerald-500',
  deferred: 'border-r-gray-300',
  cancelled: 'border-r-red-300',
  delivered: 'border-r-emerald-500',
}



export const OrderCard = memo(function OrderCard({ order, onClick, orderId }: OrderCardProps) {
  const navigate = useNavigate()
  const handleClick = onClick || (orderId ? () => navigate(`/orders/${orderId}`) : undefined)
  const dt = order.created_at ? new Date(order.created_at) : null
  const dateStr = dt ? formatDate(dt) : ''
  const timeStr = dt ? dt.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''
  const isSubmitted = order.status === 'submitted'
  const accent = isSubmitted
    ? 'border-r-[#2563EB] shadow-[0_2px_8px_-2px_rgba(37,99,235,0.12),0_0_0_1px_rgba(37,99,235,0.06)] bg-[rgba(37,99,235,0.04)]'
    : (cardAccent[order.status] || 'border-r-gray-300')

  return (
    <div
      onClick={handleClick}
      className={'h-full rounded-xl border border-border border-r-4 bg-white p-3.5 cursor-pointer active:scale-[0.98] transition-all flex flex-col ' + accent}
    >
      <p className="text-base font-bold text-text mb-1 leading-snug">
        {order.customer_name || 'غير متوفر'}
      </p>

      {order.customer_display_address && (
        <p className="text-[11px] text-text-secondary mb-2 leading-snug">
          {order.customer_display_address}
        </p>
      )}

      <div className="flex items-center justify-between mb-1.5">
        <StatusBadge status={order.status} size={isSubmitted ? 'lg' : 'md'} />
        <div className="flex items-center gap-1">
          <p className="text-xs font-bold text-text font-mono tracking-tight">{order.order_number}</p>
          {order.revision_number !== undefined && order.revision_number > 0 && (
            <span className="text-[9px] text-text-secondary bg-surface px-1 py-0.5 rounded">مراجعة #{order.revision_number}</span>
          )}
        </div>
      </div>

      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-[11px] text-text-muted">قيمة الطلب:</span>
        <span className="text-lg font-bold text-text">{formatCurrencyShort(Number(order.total_amount) || 0)}</span>
      </div>

      {order.created_by_name ? (
        <OrderOwnershipInfo
          creatorName={order.created_by_name}
          creatorId={order.created_by_id}
          ownerId={order.owner_id}
          currentOwnerName={order.owner_name}
          label="المسؤول:"
          compact
        />
      ) : order.customer_owner_name ? (
        <p className="text-[11px] text-text-secondary mb-0.5">
          <span className="text-text-muted">المسؤول: </span>
          <span className="text-text font-medium">{order.customer_owner_name}</span>
        </p>
      ) : null}

      {order.previous_order_count != null && order.previous_order_count > 0 ? (
        <>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            <span className="text-[10px] text-text-secondary">
              <span className="text-text-muted">🧾 الطلبات السابقة: </span>
              <span className="font-medium">{order.previous_order_count}</span>
            </span>
            {order.previous_orders_total != null && (
              <span className="text-[10px] text-text-secondary">
                <span className="text-text-muted">💰 المشتريات السابقة: </span>
                <span className="font-medium">{formatCurrencyShort(Number(order.previous_orders_total))}</span>
              </span>
            )}
          </div>
          {order.previous_order_number != null && (
            <div className="mt-2 pt-1.5 border-t border-dashed border-border/50">
              <p className="text-[9px] font-bold text-text-secondary uppercase mb-1">📦 آخر طلب سابق</p>
              <div className="space-y-0.5">
                <p className="text-[11px] text-text-secondary">
                  <span className="text-text-muted">🧾 رقم الطلب: </span>
                  <span className="font-medium font-mono text-text">{order.previous_order_number}</span>
                </p>
                {order.previous_order_date && (
                  <p className="text-[11px] text-text-secondary">
                    <span className="text-text-muted">📅 تاريخ الطلب: </span>
                    <span className="font-medium">{formatDate(new Date(order.previous_order_date))}</span>
                  </p>
                )}
                {order.previous_order_total != null && (
                  <p className="text-[11px] text-text-secondary">
                    <span className="text-text-muted">💰 قيمة الطلب: </span>
                    <span className="font-medium">{formatCurrencyShort(Number(order.previous_order_total))}</span>
                  </p>
                )}
              </div>
            </div>
          )}
        </>
      ) : order.previous_order_count != null && (
        <p className="text-[10px] text-text-secondary mt-2 pt-1.5 border-t border-dashed border-border/50">
          هذا أول طلب للعميل
        </p>
      )}

      <div className="flex-1" />

      <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-border/50 flex-wrap">
        {order.order_type && (
          <span className={'text-[10px] px-1.5 py-0.5 rounded font-medium ' + (order.order_type === 'credit' ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700')}>
            {order.order_type === 'credit' ? 'آجل' : 'نقدي'}
          </span>
        )}
        {order.delivery_mode && (
          <span className={'text-[10px] px-1.5 py-0.5 rounded ' + (order.delivery_mode === 'external' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700')}>
            {order.delivery_mode === 'external' ? 'شركة شحن' : 'توصيل داخلي'}
          </span>
        )}
        {order.governorate && !order.customer_display_address && (
          <span className="text-[10px] text-text-secondary bg-surface px-1.5 py-0.5 rounded">{order.governorate}</span>
        )}
        {order.collection_badge && (
          <span className={'text-[10px] px-1.5 py-0.5 rounded ' + order.collection_badge.className}>
            {order.collection_badge.label}
          </span>
        )}
      </div>

      <p className="text-[11px] text-text-secondary mt-1">{dateStr} {timeStr}</p>
    </div>
  )
})
