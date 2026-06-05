import { useEffect, useState } from 'react'
import { flashOfferService } from '../../services/flashOffers'
import { formatCurrencyShort } from '../../utils/format'
import type { FlashOfferRecord } from '../../types/storefront'

export function FlashOffersManagementPage() {
  const [offers, setOffers] = useState<FlashOfferRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchOffers = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await flashOfferService.getAll()
      setOffers(data)
    } catch (err: any) {
      setError(err.message || 'فشل تحميل عروض الساعة')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchOffers() }, [])

  const statusLabels: Record<string, string> = {
    draft: 'مسودة',
    scheduled: 'مجدول',
    active: 'نشط',
    sold_out: 'نفد',
    expired: 'منتهي',
    cancelled: 'ملغي',
  }

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    scheduled: 'bg-blue-100 text-blue-600',
    active: 'bg-success/10 text-success',
    sold_out: 'bg-red-100 text-red-600',
    expired: 'bg-gray-100 text-gray-500',
    cancelled: 'bg-danger/10 text-danger',
  }

  if (loading) return <div className="text-center text-text-secondary text-sm py-8">جاري التحميل...</div>

  if (error) return (
    <div className="bg-danger/10 border border-danger/30 rounded-lg p-3">
      <p className="text-sm text-danger">{error}</p>
    </div>
  )

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-text">إدارة عروض الساعة</h1>
        <span className="text-xs text-text-secondary">{offers.length} عرض</span>
      </div>

      {offers.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
          <p className="text-sm text-amber-700">لا توجد عروض ساعة بعد</p>
        </div>
      )}

      <div className="space-y-2">
        {offers.map((offer) => (
          <div key={offer.id} className="bg-white rounded-lg border border-border p-3">
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-text truncate">{offer.title}</h3>
                {offer.description && (
                  <p className="text-xs text-text-secondary truncate mt-0.5">{offer.description}</p>
                )}
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusColors[offer.status] || 'bg-gray-100 text-gray-600'}`}>
                {statusLabels[offer.status] || offer.status}
              </span>
            </div>

            <div className="flex items-center gap-3 text-xs text-text-secondary">
              <span>السعر: {formatCurrencyShort(offer.fixedPrice)}</span>
              <span>المتبقي: {offer.availableQuantity}/{offer.originalQuantity}</span>
              {offer.endsAt && (
                <span>ينتهي: {new Date(offer.endsAt).toLocaleDateString('ar-EG')}</span>
              )}
            </div>

            {offer.items.length > 0 && (
              <div className="mt-2 text-xs text-text-secondary">
                {offer.items.map((item) => (
                  <span key={item.id} className="ml-2">{item.productName} x{item.quantity}</span>
                ))}
              </div>
            )}

            <div className="flex gap-2 mt-2">
              {offer.status === 'draft' || offer.status === 'scheduled' ? (
                <button
                  onClick={async () => {
                    const res = await flashOfferService.activate(offer.id)
                    if (res.success) fetchOffers()
                  }}
                  className="text-xs bg-success text-white px-3 py-1 rounded-lg"
                >
                  تفعيل
                </button>
              ) : null}
              {offer.status === 'active' ? (
                <button
                  onClick={async () => {
                    const res = await flashOfferService.cancel(offer.id)
                    if (res.success) fetchOffers()
                  }}
                  className="text-xs bg-danger text-white px-3 py-1 rounded-lg"
                >
                  إلغاء
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
