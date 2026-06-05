import { useLocation, useNavigate } from 'react-router-dom'
import { useCartStore } from '../../store/cart'
import { formatCurrencyShort } from '../../utils/format'
import type { DailyDealRecord } from '../../types/storefront'

export function DailyDealDetailPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const deal = location.state?.deal as DailyDealRecord | undefined
  const { addDeal, dealItems } = useCartStore()

  if (!deal) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/daily-deals')} className="text-text-secondary text-lg">&larr;</button>
          <h1 className="text-lg font-bold text-text">صفقة اليوم</h1>
        </div>
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-center">
          <p className="text-sm text-danger">العرض غير متوفر</p>
        </div>
      </div>
    )
  }

  const isExpired = deal.status === 'expired' || (deal.endsAt && new Date(deal.endsAt) <= new Date())
  const isSoldOut = deal.status === 'sold_out' || deal.availableQuantity <= 0
  const isUnavailable = isExpired || isSoldOut || deal.status === 'cancelled'
  const alreadyInCart = dealItems.some((d) => d.dealId === deal.id)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/daily-deals')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تفاصيل العرض</h1>
      </div>

      <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
        {deal.imageUrl && (
          <img
            src={deal.imageUrl}
            alt={deal.title}
            className="w-full h-56 object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}

        <div className="p-4 space-y-4">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-bold text-text">{deal.title}</h2>
            {isExpired && (
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">انتهى العرض</span>
            )}
            {isSoldOut && !isExpired && (
              <span className="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full">نفدت الكمية</span>
            )}
            {!isUnavailable && (
              <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full">متاح</span>
            )}
          </div>

          {deal.description && (
            <p className="text-sm text-text-secondary leading-relaxed">{deal.description}</p>
          )}

          {deal.items.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text mb-2">مكونات العرض</h3>
              <div className="bg-surface rounded-lg divide-y divide-border">
                {deal.items.map((item) => (
                  <div key={item.id} className="flex justify-between px-3 py-2 text-sm">
                    <span className="text-text-secondary">{item.productName}</span>
                    <span className="text-text font-medium">x{item.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-amber-50 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-secondary">السعر النهائي</span>
              <span className="text-xl font-bold text-danger">{formatCurrencyShort(deal.fixedPrice)}</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>الكمية المتبقية: {deal.availableQuantity}</span>
            {deal.endsAt && (
              <span>ينتهي: {new Date(deal.endsAt).toLocaleDateString('ar-EG')}</span>
            )}
          </div>

          {alreadyInCart && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700 text-center">
              هذا العرض مضاف بالفعل إلى السلة
            </div>
          )}

          <button
            disabled={isUnavailable || alreadyInCart}
            onClick={() => {
              addDeal(deal)
              navigate('/cart')
            }}
            className={`w-full text-sm py-3 rounded-lg transition-colors ${
              isUnavailable || alreadyInCart
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-amber-500 text-white active:bg-amber-600'
            }`}
          >
            {isExpired ? 'انتهى العرض' : isSoldOut ? 'نفدت الكمية' : alreadyInCart ? 'مضاف بالفعل' : 'أضف إلى السلة'}
          </button>
        </div>
      </div>
    </div>
  )
}
