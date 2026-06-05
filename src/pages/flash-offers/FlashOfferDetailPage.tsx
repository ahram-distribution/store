import { useLocation, useNavigate } from 'react-router-dom'
import { useCartStore } from '../../store/cart'
import { formatCurrencyShort } from '../../utils/format'
import type { FlashOfferRecord } from '../../types/storefront'

export function FlashOfferDetailPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const offer = location.state?.offer as FlashOfferRecord | undefined
  const { addFlashOffer, flashOfferItems } = useCartStore()

  if (!offer) {
    return (
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/flash-offers')} className="text-text-secondary text-lg">&larr;</button>
          <h1 className="text-lg font-bold text-text">عرض الساعة</h1>
        </div>
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 text-center">
          <p className="text-sm text-danger">العرض غير متوفر</p>
        </div>
      </div>
    )
  }

  const isExpired = offer.status === 'expired' || (offer.endsAt && new Date(offer.endsAt) <= new Date())
  const isSoldOut = offer.status === 'sold_out' || offer.availableQuantity <= 0
  const isUnavailable = isExpired || isSoldOut || offer.status === 'cancelled'
  const alreadyInCart = flashOfferItems.some((d) => d.dealId === offer.id)

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/flash-offers')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تفاصيل العرض</h1>
      </div>

      <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
        {offer.imageUrl && (
          <img
            src={offer.imageUrl}
            alt={offer.title}
            className="w-full h-56 object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}

        <div className="p-4 space-y-4">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-bold text-text">{offer.title}</h2>
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

          {offer.description && (
            <p className="text-sm text-text-secondary leading-relaxed">{offer.description}</p>
          )}

          {offer.items.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text mb-2">مكونات العرض</h3>
              <div className="bg-surface rounded-lg divide-y divide-border">
                {offer.items.map((item) => (
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
              <span className="text-xl font-bold text-danger">{formatCurrencyShort(offer.fixedPrice)}</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>الكمية المتبقية: {offer.availableQuantity}</span>
            {offer.endsAt && (
              <span>ينتهي: {new Date(offer.endsAt).toLocaleDateString('ar-EG')}</span>
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
              addFlashOffer(offer)
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
