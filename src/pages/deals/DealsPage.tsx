import { useEffect, useState } from 'react'
import { formatCurrencyShort } from '../../utils/format'
import { dealService } from '../../services/deals'
import type { PackageDealRecord } from '../../services/deals'

export function DealsPage() {
  const [deals, setDeals] = useState<PackageDealRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await dealService.getActive()
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
      <h1 className="text-lg font-bold text-text">العروض</h1>
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
        <p className="text-sm text-amber-700 font-semibold mb-1">قريباً</p>
        <p className="text-xs text-amber-600">سيتم تفعيل العروض والباقات قريباً. تابعنا لتصلك أحدث العروض.</p>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-text">العروض</h1>
      <div className="space-y-3">
        {deals.map((deal) => (
          <div key={deal.id} className="bg-white rounded-lg border border-border overflow-hidden">
            <div className="p-3 pb-2">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-text">{deal.name}</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded ${deal.status === 'active' ? 'bg-success/10 text-success' : 'bg-surface text-text-secondary'}`}>
                  {deal.status === 'active' ? 'نشط' : deal.status}
                </span>
              </div>
              {deal.description && <p className="text-xs text-text-secondary mb-2">{deal.description}</p>}
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-danger">{formatCurrencyShort(deal.price)}</span>
              </div>
            </div>
            <div className="bg-surface px-3 py-2 flex items-center justify-between text-xs text-text-secondary">
              <span>{deal.packageType === 'daily_deal' ? 'عرض يومي' : 'عرض محدود'}</span>
              <span>المتبقي: {deal.availableQuantity}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
