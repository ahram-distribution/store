import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, Gavel, Users, TrendingUp, Clock, Send, CheckCircle, AlertTriangle, UserCheck, UserPlus, Activity, List, Package } from 'lucide-react'
import { formatCurrencyShort } from '../../utils/format'
import { auctionService } from '../../services/auctions'
import { useAuthStore } from '../../store/auth'
import type { AuctionDetailRecordV2, AuctionBidRecord, AuctionActivityRecord } from '../../types/storefront'

function LiveCountdown({ endTime }: { endTime: string }) {
  const [display, setDisplay] = useState('')
  useEffect(() => {
    function tick() {
      const diff = new Date(endTime).getTime() - Date.now()
      if (diff <= 0) return setDisplay('00:00:00')
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setDisplay(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const int = setInterval(tick, 1000)
    return () => clearInterval(int)
  }, [endTime])
  return <span className="font-mono tabular-nums text-lg font-bold text-white">{display}</span>
}

export function AuctionDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const token = useAuthStore(s => s.token)
  const user = useAuthStore(s => s.user)

  const [auction, setAuction] = useState<AuctionDetailRecordV2 | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [bidAmount, setBidAmount] = useState('')
  const [placing, setPlacing] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [bidError, setBidError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'activity' | 'bids' | 'items'>('activity')

  const [activityLog, setActivityLog] = useState<AuctionActivityRecord[]>([])
  const [bidLog, setBidLog] = useState<AuctionBidRecord[]>([])
  const [participantCount, setParticipantCount] = useState(0)

  const fetchAuction = useCallback(async () => {
    if (!id) return
    try {
      const data = await auctionService.getById(id)
      setAuction(data)
      if (data) {
        setActivityLog(data.activity)
        setBidLog(data.bids)
        setParticipantCount(data.participant_count)
        if (!bidAmount && data.current_price) {
          setBidAmount(String(data.current_price + data.bid_increment))
        }
      }
    } catch (err: any) {
      setError(err.message || 'فشل التحميل')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchAuction() }, [fetchAuction])

  useEffect(() => {
    if (!id || !auction || auction.status !== 'live') return
    const uns1 = auctionService.subscribeBids(id, (bid) => {
      setBidLog(prev => [bid, ...prev].slice(0, 100))
      setAuction(prev => prev ? { ...prev, current_price: bid.amount, bid_count: prev.bid_count + 1 } : prev)
      setBidAmount(String(bid.amount + (auction?.bid_increment ?? 500)))
    })
    const uns2 = auctionService.subscribeActivity(id, (act) => {
      setActivityLog(prev => [act, ...prev].slice(0, 50))
    })
    const uns3 = auctionService.subscribeParticipants(id, (count) => {
      setParticipantCount(count)
      setAuction(prev => prev ? { ...prev, participant_count: count } : prev)
    })
    return () => { uns1(); uns2(); uns3() }
  }, [id, auction?.status])

  async function handleRequestParticipation() {
    if (!id) return
    setRequesting(true)
    const result = await auctionService.requestParticipation(id)
    setRequesting(false)
    if (result.success) {
      await fetchAuction()
    } else {
      setBidError(result.error === 'ALREADY_REGISTERED' ? '你已经提交了申请' : result.error || 'فشل إرسال الطلب')
    }
  }

  async function handlePlaceBid() {
    if (!id) return
    const amount = Number(bidAmount)
    if (isNaN(amount) || amount <= 0) { setBidError('请输入有效金额'); return }
    setPlacing(true)
    setBidError(null)
    const result = await auctionService.placeBid(id, amount)
    setPlacing(false)
    if (!result.success) {
      if (result.error === 'BID_TOO_LOW') {
        setBidError(`最低出价为 ${formatCurrencyShort(result.minimum_acceptable!)}`)
        setBidAmount(String(result.minimum_acceptable!))
      } else {
        setBidError(result.error || '出价失败')
      }
    } else {
      setBidAmount(String(amount + (auction?.bid_increment ?? 500)))
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-[#071A3A] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#C9A227] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (error || !auction) return (
    <div className="min-h-screen bg-gray-50 p-4">
      <button onClick={() => navigate('/auctions')} className="flex items-center gap-1 text-gray-500 mb-4"><ArrowRight className="w-4 h-4" />العودة</button>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
        <p className="text-sm text-amber-700 font-semibold">{error || 'المزاد غير متاح'}</p>
      </div>
    </div>
  )

  const isLive = auction.status === 'live'
  const isEnded = auction.status === 'ended' || auction.status === 'awarded'
  const ps = auction.participant_status
  const isApproved = ps.status === 'approved'
  const canBid = isLive && isApproved
  const isEmployee = user?.identity_type === 'employee'
  const isCustomer = user?.identity_type === 'customer'

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Sticky Top Bar */}
      <div className="sticky top-0 z-20 bg-gradient-to-r from-[#071A3A] to-[#0F2B5B] px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/auctions')} className="text-white/80"><ArrowRight className="w-5 h-5" /></button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white truncate">{auction.title}</h1>
        </div>
        {isLive && <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">مباشر</span>}
      </div>

      {/* Hero Image */}
      {auction.image_url && (
        <div className="relative">
          <img src={auction.image_url} alt={auction.title} className="w-full aspect-video object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#071A3A]/80 to-transparent" />
        </div>
      )}

      {/* Live Status Card */}
      <div className={`${auction.image_url ? '-mt-16' : 'mt-4'} relative z-10 mx-4 mb-3`}>
        <div className="bg-gradient-to-br from-[#071A3A] to-[#0F2B5B] rounded-2xl p-4 border border-[#C9A227]/30 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] text-white/60">أعلى عرض</p>
              <p className="text-2xl font-bold text-[#C9A227]">{formatCurrencyShort(auction.current_price)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-white/60">المتبقي</p>
              <LiveCountdown endTime={auction.end_time} />
            </div>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-white/60">
            <span>الزيادة: {formatCurrencyShort(auction.bid_increment)}</span>
            {auction.deposit_amount != null && <span>التأمين: {formatCurrencyShort(auction.deposit_amount)}</span>}
            <span>البدء: {formatCurrencyShort(auction.starting_price)}</span>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 px-4 pb-36 space-y-3 overflow-y-auto">
        {/* Current Leader */}
        {auction.current_leader_name && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
            <span className="text-xs text-emerald-800">
              المتصدر: <strong>{auction.current_leader_name}</strong> بـ {formatCurrencyShort(auction.current_leader_bid!)}
            </span>
          </div>
        )}

        {/* Participation Status */}
        {(() => {
          if (!token) return (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span className="text-xs text-amber-700">سجل الدخول للمشاركة في المزاد</span>
            </div>
          )
          if (ps.status === 'registered' && ps.can_request) return (
            <button
              onClick={handleRequestParticipation}
              disabled={requesting}
              className="w-full bg-[#C9A227] text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 active:bg-[#B8921F] disabled:opacity-50 transition-colors"
            >
              {requesting ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <UserCheck className="w-4 h-4" />}
              طلب المشاركة في المزاد
            </button>
          )
          if (ps.status === 'pending') return (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span className="text-xs text-amber-700">طلبك قيد المراجعة. انتظر موافقة الإدارة.</span>
            </div>
          )
          if (ps.status === 'approved' && !isLive && !isEnded) return (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <span className="text-xs text-blue-700">أنت مشارك معتمد. المزاد لم يبدأ بعد.</span>
            </div>
          )
          return null
        })()}

        {/* Metrics Grid */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center shadow-sm">
            <Users className="w-4 h-4 text-gray-400 mx-auto mb-1" />
            <p className="text-lg font-bold text-gray-900">{participantCount}</p>
            <p className="text-[10px] text-gray-500">مشارك</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center shadow-sm">
            <Gavel className="w-4 h-4 text-gray-400 mx-auto mb-1" />
            <p className="text-lg font-bold text-gray-900">{auction.bid_count}</p>
            <p className="text-[10px] text-gray-500">مزايدة</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center shadow-sm">
            <Package className="w-4 h-4 text-gray-400 mx-auto mb-1" />
            <p className="text-lg font-bold text-gray-900">{auction.items.length}</p>
            <p className="text-[10px] text-gray-500">منتج</p>
          </div>
        </div>

        {/* Bidding Panel (only when approved + live) */}
        {canBid && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-xs font-bold text-gray-900 mb-2">أدخل مزايدتك</p>
            <div className="flex gap-2">
              <input
                type="number"
                value={bidAmount}
                onChange={e => setBidAmount(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-left font-mono"
                placeholder="المبلغ"
                min={auction.current_price + auction.bid_increment}
                step={auction.bid_increment}
              />
              <button
                onClick={handlePlaceBid}
                disabled={placing}
                className="bg-[#C9A227] text-white rounded-lg px-5 py-2.5 text-sm font-bold flex items-center gap-1.5 active:bg-[#B8921F] disabled:opacity-50 transition-colors"
              >
                {placing ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
                مزايدة
              </button>
            </div>
            {bidError && <p className="text-[10px] text-red-500 mt-1.5">{bidError}</p>}
            <p className="text-[10px] text-gray-400 mt-1.5">الحد الأدنى: {formatCurrencyShort(auction.current_price + auction.bid_increment)}</p>
          </div>
        )}

        {/* Tab System */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex border-b border-gray-200">
            {([
              { key: 'activity', label: 'النشاط', icon: Activity },
              { key: 'bids', label: 'المزايدات', icon: Gavel },
              { key: 'items', label: 'المحتويات', icon: List },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-2.5 text-[11px] font-medium flex items-center justify-center gap-1 transition-colors ${
                  activeTab === tab.key ? 'text-[#C9A227] border-b-2 border-[#C9A227]' : 'text-gray-400'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>
          <div className="p-3 max-h-64 overflow-y-auto">
            {activeTab === 'activity' && (
              activityLog.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">لا يوجد نشاط بعد</p>
              ) : (
                <div className="space-y-2">
                  {activityLog.map(a => (
                    <div key={a.id} className="flex items-start gap-2 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#C9A227] mt-1.5 flex-shrink-0" />
                      <div>
                        <p className="text-gray-700">{a.message}</p>
                        <p className="text-[10px] text-gray-400">{new Date(a.created_at).toLocaleTimeString('ar-EG-u-nu-latn')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
            {activeTab === 'bids' && (
              bidLog.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">لا توجد مزايدات بعد</p>
              ) : (
                <div className="space-y-1.5">
                  {bidLog.map(b => (
                    <div key={b.id} className={`flex items-center justify-between py-1.5 px-2 rounded-lg ${
                      b.is_winning ? 'bg-emerald-50 border border-emerald-200' : ''
                    }`}>
                      <div>
                        <p className="text-xs font-medium text-gray-900">{b.participant_name}</p>
                        <p className="text-[10px] text-gray-400">{new Date(b.placed_at).toLocaleTimeString('ar-EG-u-nu-latn')}</p>
                      </div>
                      <div className="text-left">
                        <p className={`text-xs font-bold ${b.is_winning ? 'text-emerald-600' : 'text-[#C9A227]'}`}>
                          {formatCurrencyShort(b.amount)}
                        </p>
                        {b.is_winning && <p className="text-[9px] text-emerald-500">متصدر</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
            {activeTab === 'items' && (
              auction.items.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4">لا توجد منتجات</p>
              ) : (
                <div className="space-y-2">
                  {auction.items.map(item => (
                    <div key={item.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                      <span className="text-xs text-gray-700">{item.product_name}</span>
                      <span className="text-xs font-bold text-gray-900">{item.quantity}</span>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>

        {/* Ended state */}
        {isEnded && (
          <div className="bg-gray-100 rounded-xl p-4 text-center">
            <p className="text-sm font-bold text-gray-600 mb-1">انتهى المزاد</p>
            {auction.winner_amount != null && (
              <p className="text-xs text-gray-500">السعر النهائي: {formatCurrencyShort(auction.winner_amount)}</p>
            )}
            {auction.current_leader_name && (
              <p className="text-xs text-gray-500">الفائز: {auction.current_leader_name}</p>
            )}
          </div>
        )}
      </div>

      {/* Bottom Sticky Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-gray-200 px-4 py-3 shadow-lg">
        {(() => {
          if (!token) return (
            <button onClick={() => navigate('/login')} className="w-full bg-[#C9A227] text-white rounded-xl py-3 text-sm font-bold">
              سجل الدخول للمشاركة
            </button>
          )
          if (ps.status === 'registered' && ps.can_request && isLive) return (
            <button onClick={handleRequestParticipation} disabled={requesting} className="w-full bg-[#C9A227] text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {requesting ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <UserPlus className="w-4 h-4" />}
              طلب المشاركة
            </button>
          )
          if (canBid) return (
            <button onClick={handlePlaceBid} disabled={placing} className="w-full bg-[#C9A227] text-white rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {placing ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
              مزايدة {formatCurrencyShort(Number(bidAmount) || auction.current_price + auction.bid_increment)}
            </button>
          )
          if (ps.status === 'pending') return (
            <div className="text-center text-xs text-amber-600 py-2">في انتظار الموافقة على مشاركتك</div>
          )
          if (isLive) return (
            <div className="text-center text-xs text-gray-500 py-2">غير مسموح بالمشاركة</div>
          )
          return (
            <div className="text-center text-xs text-gray-500 py-2">المزاد غير نشط</div>
          )
        })()}
      </div>
    </div>
  )
}
