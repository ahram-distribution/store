import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { flashOfferService } from '../../services/flashOffers'
import { useCartStore } from '../../store/cart'
import { formatCurrencyShort } from '../../utils/format'
import type { FlashOfferRecord } from '../../types/storefront'

function getCairoNow(): number {
  const now = new Date()
  const cairo = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (t: string) => parseInt(cairo.find(p => p.type === t)?.value ?? '0', 10)
  return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')).getTime()
}

function getCairoEnd(endAt: string): number {
  const d = new Date(endAt)
  const cairo = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parseInt(cairo.find(p => p.type === t)?.value ?? '0', 10)
  return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')).getTime()
}

function Countdown({ targetDate }: { targetDate: string }) {
  const [display, setDisplay] = useState('-- : -- : --')

  useEffect(() => {
    const tick = () => {
      const nowCairo = getCairoNow()
      const endCairo = getCairoEnd(targetDate)
      const diff = Math.max(0, Math.floor((endCairo - nowCairo) / 1000))
      if (diff <= 0) { setDisplay('00 : 00 : 00'); return }
      const h = String(Math.floor(diff / 3600)).padStart(2, '0')
      const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0')
      const s = String(diff % 60).padStart(2, '0')
      setDisplay(`${h} : ${m} : ${s}`)
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [targetDate])

  return <span className="font-mono tracking-widest" dir="ltr">{display}</span>
}

function MiniCountdown({ targetDate }: { targetDate: string }) {
  const [display, setDisplay] = useState('--:--:--')

  useEffect(() => {
    const tick = () => {
      const nowCairo = getCairoNow()
      const endCairo = getCairoEnd(targetDate)
      const diff = Math.max(0, Math.floor((endCairo - nowCairo) / 1000))
      if (diff <= 0) { setDisplay('00:00:00'); return }
      const h = String(Math.floor(diff / 3600)).padStart(2, '0')
      const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0')
      const s = String(diff % 60).padStart(2, '0')
      setDisplay(`${h}:${m}:${s}`)
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [targetDate])

  return <span className="font-mono text-xs" dir="ltr">{display}</span>
}

export function FlashOffersPage() {
  const navigate = useNavigate()
  const [offers, setOffers] = useState<FlashOfferRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { addFlashOffer } = useCartStore()

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await flashOfferService.getActive()
        setOffers(data)
      } catch (err: any) {
        if (err?.code === 'PGRST116' || err?.message?.includes('relation') || err?.message?.includes('does not exist')) {
          setOffers([])
        } else {
          setError(err.message || 'فشل تحميل عروض الساعة')
        }
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const activeOffers = offers.filter(o => o.status === 'active' && o.isPurchasable && o.availableQuantity > 0)
  const heroOffer = activeOffers.length > 0
    ? activeOffers.reduce((a, b) => (a.endsAt && b.endsAt && new Date(a.endsAt).getTime() < new Date(b.endsAt).getTime() ? a : b))
    : null
  const otherOffers = activeOffers.filter(o => o.id !== heroOffer?.id)
  const expiredOrSoldOut = offers.filter(o => o.status !== 'active' || !o.isPurchasable || o.availableQuantity <= 0)

  const isOfferExpired = (o: FlashOfferRecord) => o.status === 'expired' || (o.endsAt && new Date(o.endsAt) <= new Date())
  const isOfferSoldOut = (o: FlashOfferRecord) => o.status === 'sold_out' || o.availableQuantity <= 0
  const isOfferUnavailable = (o: FlashOfferRecord) => isOfferExpired(o) || isOfferSoldOut(o) || o.status === 'cancelled'

  if (loading) return <div className="text-center text-text-secondary text-sm py-8">جاري التحميل...</div>

  if (error) return (
    <div className="bg-danger/10 border border-danger/30 rounded-lg p-3">
      <p className="text-sm text-danger">{error}</p>
    </div>
  )

  if (offers.length === 0) return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">عرض الساعة</h1>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
        <p className="text-sm text-amber-700 font-semibold mb-1">قريباً</p>
        <p className="text-xs text-amber-600">سيتم تفعيل العروض قريباً. تابعنا لتصلك أحدث العروض.</p>
      </div>
    </div>
  )

  return (
    <div>
      {heroOffer && (
        <div
          className="relative min-h-[70vh] flex flex-col items-center justify-center px-4 py-12 text-center overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #071A3A 0%, #0F2B5B 100%)' }}
        >
          <div className="absolute inset-0 opacity-10" style={{
            backgroundImage: 'radial-gradient(circle at 25% 25%, #C9A227 1px, transparent 1px), radial-gradient(circle at 75% 75%, #C9A227 1px, transparent 1px)',
            backgroundSize: '60px 60px'
          }} />
          <div className="relative z-10 flex flex-col items-center gap-4 w-full max-w-sm">
            <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="#C9A227" stroke="#E0B84D" strokeWidth="1.5" />
            </svg>
            <h1 className="text-2xl font-bold text-[#C9A227]">عرض الساعة</h1>
            <p className="text-sm text-[#E0B84D]/80">متبقي على انتهاء العرض</p>
            <div className="text-4xl font-bold text-white" style={{ textShadow: '0 0 20px rgba(201,162,39,0.5)' }}>
              <Countdown targetDate={heroOffer.endsAt!} />
            </div>
            <div className="mt-4 w-full bg-[#0F2B5B]/80 rounded-2xl border border-[#C9A227]/30 overflow-hidden">
              {heroOffer.imageUrl && (
                <img src={heroOffer.imageUrl} alt={heroOffer.title} className="w-full h-48 object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              )}
              <div className="p-4 space-y-3 text-right">
                <h2 className="text-lg font-bold text-white">{heroOffer.title}</h2>
                {heroOffer.description && (
                  <p className="text-sm text-[#E0B84D]/70">{heroOffer.description}</p>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-[#C9A227]">{formatCurrencyShort(heroOffer.fixedPrice)}</span>
                  <span className="text-xs text-[#E0B84D]/60">المتبقي: {heroOffer.availableQuantity}</span>
                </div>
                <button
                  onClick={() => {
                    addFlashOffer(heroOffer)
                    navigate('/cart')
                  }}
                  className="w-full bg-[#C9A227] text-[#071A3A] text-sm font-bold py-3 rounded-xl active:bg-[#E0B84D] transition-colors"
                >
                  أضف إلى السلة
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {otherOffers.length > 0 && (
        <div className="p-4 space-y-4">
          <h2 className="text-lg font-bold text-text">العروض النشطة الآن</h2>
          <div className="space-y-3">
            {otherOffers.map((offer) => (
              <div key={offer.id} className="bg-white rounded-xl border border-amber-200 overflow-hidden">
                {offer.imageUrl && (
                  <img src={offer.imageUrl} alt={offer.title} className="w-full h-40 object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                )}
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <h3 className="text-base font-bold text-text">{offer.title}</h3>
                    <MiniCountdown targetDate={offer.endsAt!} />
                  </div>
                  {offer.description && (
                    <p className="text-sm text-text-secondary">{offer.description}</p>
                  )}
                  {offer.items.length > 0 && (
                    <div className="bg-surface rounded-lg p-2.5 text-xs text-text-secondary space-y-1">
                      {offer.items.map((item) => (
                        <div key={item.id} className="flex justify-between">
                          <span>{item.productName}</span>
                          <span className="text-text">x{item.quantity}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <div className="text-lg font-bold text-danger">{formatCurrencyShort(offer.fixedPrice)}</div>
                    <div className="text-xs text-text-secondary">
                      {offer.availableQuantity > 0 ? `المتبقي: ${offer.availableQuantity}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      addFlashOffer(offer)
                      navigate('/cart')
                    }}
                    className="w-full text-sm py-2.5 rounded-lg bg-amber-500 text-white active:bg-amber-600 transition-colors"
                  >
                    أضف إلى السلة
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {expiredOrSoldOut.length > 0 && (
        <div className="p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text-secondary">العروض السابقة</h3>
          <div className="space-y-2">
            {expiredOrSoldOut.map((offer) => {
              const expired = isOfferExpired(offer)
              const soldOut = isOfferSoldOut(offer)
              return (
                <div key={offer.id} className="bg-white rounded-xl border border-gray-200 opacity-70 p-4 space-y-2">
                  <div className="flex items-start justify-between">
                    <h4 className="text-sm font-bold text-text">{offer.title}</h4>
                    {expired && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">انتهى العرض</span>}
                    {soldOut && !expired && <span className="text-xs bg-red-50 text-red-500 px-2 py-0.5 rounded-full">نفدت الكمية</span>}
                  </div>
                  <div className="text-lg font-bold text-gray-400">{formatCurrencyShort(offer.fixedPrice)}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
