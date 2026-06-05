import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { dailyDealService } from '../../services/dailyDeals'
import { formatCurrencyShort } from '../../utils/format'
import type { DailyDealRecord } from '../../types/storefront'

export function DailyDealsPage() {
  const navigate = useNavigate()
  const [deals, setDeals] = useState<DailyDealRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await dailyDealService.getActive()
        setDeals(data)
      } catch (err: any) {
        if (err?.code === 'PGRST116' || err?.message?.includes('relation') || err?.message?.includes('does not exist')) {
          setDeals([])
        } else {
          setError(err.message || 'فشل تحميل العروض')
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) return <div className="text-center text-text-secondary text-sm py-8">جاري التحميل...</div>

  if (error) return (
    <div className="bg-danger/10 border border-danger/30 rounded-lg p-3">
      <p className="text-sm text-danger">{error}</p>
    </div>
  )

  if (deals.length === 0) return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">صفقة اليوم</h1>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
        <p className="text-sm text-amber-700 font-semibold mb-1">قريباً</p>
        <p className="text-xs text-amber-600">سيتم تفعيل العروض قريباً. تابعنا لتصلك أحدث العروض.</p>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">صفقة اليوم</h1>
      </div>

      <div className="space-y-3">
        {deals.map((deal) => {
          const isExpired = deal.status === 'expired' || (deal.endsAt && new Date(deal.endsAt) <= new Date())
          const isSoldOut = deal.status === 'sold_out' || deal.availableQuantity <= 0
          const isUnavailable = isExpired || isSoldOut || deal.status === 'cancelled'

          return (
            <div
              key={deal.id}
              className={`bg-white rounded-xl border overflow-hidden ${
                isUnavailable ? 'border-gray-200 opacity-70' : 'border-amber-200'
              }`}
            >
              {deal.imageUrl && (
                <img
                  src={deal.imageUrl}
                  alt={deal.title}
                  className="w-full h-48 object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <h2 className="text-base font-bold text-text">{deal.title}</h2>
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
                  <p className="text-sm text-text-secondary">{deal.description}</p>
                )}

                {deal.items.length > 0 && (
                  <div className="bg-surface rounded-lg p-2.5 text-xs text-text-secondary space-y-1">
                    {deal.items.map((item) => (
                      <div key={item.id} className="flex justify-between">
                        <span>{item.productName}</span>
                        <span className="text-text">x{item.quantity}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="text-lg font-bold text-danger">{formatCurrencyShort(deal.fixedPrice)}</div>
                  <div className="text-xs text-text-secondary">
                    {deal.availableQuantity > 0
                      ? `المتبقي: ${deal.availableQuantity}`
                      : ''}
                  </div>
                </div>

                {deal.endsAt && (
                  <div className="text-[10px] text-text-secondary">
                    ينتهي: {new Date(deal.endsAt).toLocaleDateString('ar-EG')}
                  </div>
                )}

                <button
                  disabled={isUnavailable}
                  onClick={() => {
                    navigate(`/daily-deals/${deal.id}`, { state: { deal } })
                  }}
                  className={`w-full text-sm py-2.5 rounded-lg transition-colors ${
                    isUnavailable
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-amber-500 text-white active:bg-amber-600'
                  }`}
                >
                  {isExpired ? 'انتهى العرض' : isSoldOut ? 'نفدت الكمية' : 'أضف إلى السلة'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
