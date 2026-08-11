import { useState, useEffect, useMemo, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { getToken, fmtAmount } from './shared'

interface ShippingOrder {
  delivery_id: string
  order_id: string
  order_number: string
  order_status: string
  customer_name: string
  customer_phone: string
  total_amount: string | number
  payment_method: string
  invoice_number: string | null
  invoice_total: string | number | null
  delivery_step: string | null
  collection_required: boolean | null
  collection_amount: string | number | null
  journey_id: string | null
  journey_code: string | null
}

interface CrewEmp { id: string; code: string; full_name: string; role_names: string }

interface CollectionCfg { required: boolean; amount: string }

const normalizeText = (s: string) =>
  s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه')

export function JourneyBuildPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const preselectedIds = useMemo(() => {
    const ids = (location.state as { preselectedOrderIds?: string[] } | null)?.preselectedOrderIds
    return Array.isArray(ids) ? ids : []
  }, [location.state])
  const [orders, setOrders] = useState<ShippingOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselectedIds))
  const [emps, setEmps] = useState<CrewEmp[]>([])
  const [repId, setRepId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [busy, setBusy] = useState(false)
  const [collection, setCollection] = useState<Record<string, CollectionCfg>>({})

  const load = useCallback(async () => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('governed_get_shipping_orders', {
      p_token: token,
      p_filter: null,
      p_from: null,
      p_to: null,
    })
    if (error) toast.error(error.message)
    const all = Array.isArray(data) ? (data as ShippingOrder[]) : []
    setOrders(all.filter((o) => o.order_status === 'dispatched' && !o.journey_id))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const loadEmps = useCallback(async () => {
    const token = getToken()
    if (!token) return
    const { data } = await supabase.rpc('get_governed_employees', { p_token: token })
    if (Array.isArray(data)) {
      const crew = (data as Array<{ id: string; code: string; full_name: string; role_names?: string; is_active?: boolean }>)
        .filter((e) => e.is_active !== false)
        .filter((e) => {
          const names = (e.role_names || '')
          return names.includes('مندوب توصيل') || names.includes('سائق')
        })
        .map((e) => ({ id: e.id, code: e.code, full_name: e.full_name, role_names: e.role_names || '' }))
      setEmps(crew)
    }
  }, [])

  useEffect(() => { loadEmps() }, [loadEmps])

  const q = normalizeText(search.trim())
  const visible = useMemo(() => orders.filter((o) => {
    if (!q) return true
    const hay = normalizeText([o.customer_name, o.customer_phone, o.order_number].filter(Boolean).join(' '))
    return hay.includes(q)
  }), [orders, q])

  const repOptions = emps.filter((e) => e.role_names.includes('مندوب توصيل'))
  const driverOptions = emps.filter((e) => e.role_names.includes('سائق'))

  const toggle = (orderId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  const defaultAmount = (o: ShippingOrder): string => {
    const v = o.collection_amount ?? o.invoice_total ?? o.total_amount
    return v === null || v === undefined || v === '' ? '' : String(Number(v) || 0)
  }

  const ensureCfg = (o: ShippingOrder): CollectionCfg =>
    collection[o.order_id] || { required: o.collection_required !== false, amount: defaultAmount(o) }

  const setCfg = (orderId: string, cfg: CollectionCfg) =>
    setCollection((prev) => ({ ...prev, [orderId]: cfg }))

  const selectedOrders = orders.filter((o) => selected.has(o.order_id))
  const selectedTotal = selectedOrders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0)
  const selectedCollectionTotal = selectedOrders.reduce((s, o) => {
    const cfg = ensureCfg(o)
    return cfg.required ? s + (Number(cfg.amount) || 0) : s
  }, 0)

  const create = async () => {
    const token = getToken()
    if (!token) return
    if (selectedOrders.length === 0) { toast.error('اختر طلباً واحداً على الأقل'); return }
    if (!repId && !driverId) { toast.error('اختر مندوب توصيل أو سائقاً'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('governed_create_journey', {
      p_token: token,
      p_order_ids: selectedOrders.map((o) => o.order_id),
      p_rep_id: repId || null,
      p_driver_id: driverId || null,
      p_collection: selectedOrders.map((o) => {
        const cfg = ensureCfg(o)
        return {
          order_id: o.order_id,
          required: cfg.required,
          amount: cfg.required ? (Number(cfg.amount) || null) : null,
        }
      }),
    })
    setBusy(false)
    if (error) { toast.error(error.message); return }
    const res = data as { error?: string; journey_id?: string }
    if (res?.error) { toast.error(res.error); return }
    toast.success('تم إنشاء الرحلة')
    navigate(`/shipping/journeys/${res.journey_id}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/shipping/journeys')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">إنشاء رحلة توصيل</h1>
      </div>

      {/* فريق الرحلة */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        <p className="text-sm font-bold text-text">فريق الرحلة</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <p className="text-xs text-text-secondary">🚚 مندوب التوصيل</p>
            <select
              value={repId}
              onChange={(e) => setRepId(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-white text-text"
            >
              <option value="">بدون مندوب</option>
              {repOptions.map((e) => (
                <option key={e.id} value={e.id}>{e.full_name} ({e.code})</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-text-secondary">👤 السائق</p>
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-white text-text"
            >
              <option value="">بدون سائق</option>
              {driverOptions.map((e) => (
                <option key={e.id} value={e.id}>{e.full_name} ({e.code})</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* البحث */}
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="🔍 بحث: اسم العميل، الهاتف، أو رقم الطلب"
        className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-white text-text placeholder:text-text-secondary/60"
      />

      {!loading && visible.length === 0 ? (
        <div className="text-center text-text-secondary text-sm py-8">
          لا توجد طلبات مشحونة متاحة للرحلة (كل الطلبات في رحلات أو غير مشحونة)
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((o) => {
            const isSelected = selected.has(o.order_id)
            const cfg = ensureCfg(o)
            return (
              <div
                key={o.delivery_id}
                className={`bg-white rounded-xl border p-3 space-y-2 ${isSelected ? 'border-primary bg-blue-50/40' : 'border-border'}`}
              >
                <div className="flex items-center gap-3 w-full text-right cursor-pointer" onClick={() => toggle(o.order_id)}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(o.order_id)}
                    className="w-4 h-4 accent-[var(--primary,#2563eb)] shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-text truncate">📦 {o.customer_name}</span>
                      <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{o.order_number}</span>
                    </div>
                    <div className="text-[11px] text-text-secondary mt-1 space-y-0.5">
                      <p>قيمة الطلب: {fmtAmount(o.invoice_total ?? o.total_amount)}{o.invoice_number ? ` - فاتورة ${o.invoice_number}` : ''}</p>
                      <p>{o.collection_required === false ? '✓ بدون تحصيل' : '💰 مطلوب التحصيل'}</p>
                    </div>
                  </div>
                </div>

                {isSelected && (
                  <div className="space-y-2 pt-2 border-t border-border/60">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setCfg(o.order_id, { required: true, amount: ensureCfg(o).amount })}
                        className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold border ${cfg.required ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-border text-text-secondary'}`}
                      >
                        💰 مطلوب التحصيل
                      </button>
                      <button
                        type="button"
                        onClick={() => setCfg(o.order_id, { required: false, amount: '' })}
                        className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold border ${!cfg.required ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-border text-text-secondary'}`}
                      >
                        بدون تحصيل
                      </button>
                    </div>
                    {cfg.required && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-text-secondary shrink-0">مبلغ التحصيل:</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          value={cfg.amount}
                          onChange={(e) => setCfg(o.order_id, { required: true, amount: e.target.value })}
                          placeholder="0.00"
                          className="flex-1 border border-border rounded-lg px-2.5 py-1.5 text-sm bg-white text-text"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ملخص التحديد */}
      {selectedOrders.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4 space-y-1">
          <p className="text-sm font-bold text-text">الطلبات المختارة</p>
          <p className="text-xs text-text-secondary">
            {selectedOrders.length} طلب - إجمالي القيمة {fmtAmount(selectedTotal)}
            {selectedCollectionTotal > 0 ? ` - التحصيل المطلوب ${fmtAmount(selectedCollectionTotal)}` : ' - بدون تحصيل'}
          </p>
        </div>
      )}

      <button
        onClick={create}
        disabled={busy}
        className="w-full bg-primary text-white rounded-xl p-3 text-sm font-semibold disabled:opacity-50"
      >
        {busy ? 'جاري الإنشاء...' : 'إنشاء الرحلة'}
      </button>
    </div>
  )
}
