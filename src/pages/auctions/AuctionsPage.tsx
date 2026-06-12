import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Gavel, Users, TrendingUp, Clock } from 'lucide-react'
import { formatCurrencyShort } from '../../utils/format'
import { auctionService } from '../../services/auctions'
import type { AuctionRecordV2 } from '../../types/storefront'

const statusLabels: Record<string, string> = {
  pending: 'قادم', live: 'نشط', ended: 'منتهي', awarded: 'منتهي', cancelled: 'ملغي',
}

const statusColors: Record<string, string> = {
  pending: 'text-amber-600 bg-amber-50', live: 'text-emerald-600 bg-emerald-50',
  ended: 'text-gray-500 bg-gray-100', awarded: 'text-blue-600 bg-blue-50', cancelled: 'text-red-600 bg-red-50',
}

function LiveCountdown({ endTime }: { endTime: string }) {
  const [remaining, setRemaining] = useState('')
  useEffect(() => {
    function tick() {
      const diff = new Date(endTime).getTime() - Date.now()
      if (diff <= 0) return setRemaining('انتهى')
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setRemaining(`${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const int = setInterval(tick, 1000)
    return () => clearInterval(int)
  }, [endTime])
  return <span className="text-xs font-mono tabular-nums text-emerald-600">{remaining}</span>
}

export function AuctionsPage() {
  const navigate = useNavigate()
  const [auctions, setAuctions] = useState<AuctionRecordV2[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try { setAuctions(await auctionService.getAll()) }
      catch { setAuctions([]) }
      finally { setLoading(false) }
    })()
  }, [])

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-b from-[#071A3A] to-[#0F2B5B] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#C9A227] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const liveAuctions = auctions.filter(a => a.status === 'live')
  const otherAuctions = auctions.filter(a => a.status !== 'live')

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-b from-[#071A3A] to-[#0F2B5B] px-4 pt-12 pb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-[#C9A227]/20 rounded-full flex items-center justify-center">
            <Gavel className="w-5 h-5 text-[#C9A227]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">المزادات</h1>
            <p className="text-xs text-white/60">مزادات مباشرة للمنتجات</p>
          </div>
        </div>
        {liveAuctions.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {liveAuctions.map(a => (
              <div
                key={a.id}
                onClick={() => navigate(`/auctions/${a.id}`)}
                className="flex-shrink-0 w-64 bg-white/10 backdrop-blur-sm rounded-xl p-3 border border-white/20 cursor-pointer active:scale-[0.98] transition-transform"
              >
                {a.image_url && (
                  <img src={a.image_url} alt={a.title} className="w-full h-24 object-cover rounded-lg mb-2" />
                )}
                <h3 className="text-sm font-bold text-white mb-1">{a.title}</h3>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded">مباشر</span>
                  <LiveCountdown endTime={a.end_time} />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#C9A227] font-bold">{formatCurrencyShort(a.current_price)}</span>
                  <span className="text-white/60">{a.participant_count} مشارك</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 -mt-4">
        {auctions.length === 0 && !loading && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
            <p className="text-sm text-amber-700 font-semibold mb-1">لا توجد مزادات حالياً</p>
            <p className="text-xs text-amber-600">سيتم إضافة المزادات قريباً</p>
          </div>
        )}
        {otherAuctions.map(a => (
          <div
            key={a.id}
            onClick={() => navigate(`/auctions/${a.id}`)}
            className="bg-white rounded-xl border border-gray-200 p-3 mb-3 cursor-pointer active:bg-gray-50 transition-colors shadow-sm"
          >
            <div className="flex items-start gap-3">
              {a.image_url && (
                <img src={a.image_url} alt={a.title} className="w-16 h-16 rounded-lg object-cover flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <h3 className="text-sm font-bold text-gray-900 truncate">{a.title}</h3>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${statusColors[a.status]}`}>{statusLabels[a.status]}</span>
                </div>
                <p className="text-[10px] text-gray-500 mb-1.5">{a.bid_count} مزايدة · {a.participant_count} مشارك</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#C9A227]">{formatCurrencyShort(a.current_price)}</span>
                  {a.status === 'pending' && (
                    <span className="text-[10px] text-gray-400">
                      {new Date(a.start_time).toLocaleDateString('ar-EG-u-nu-latn')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
