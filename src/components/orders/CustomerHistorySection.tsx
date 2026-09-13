import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { OrderCard } from './OrderCard'
import { formatCurrencyShort, formatDate, formatDateTime } from '../../utils/format'
import { copyToClipboard } from '../../utils/safeClipboard'
import type { UnifiedOrder } from '../../types/unified-order'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

type Panel =
  | { kind: 'orders'; title: string; highlightLatest: boolean }
  | { kind: 'visits' }

interface CustomerHistorySectionProps {
  customer: UnifiedOrder['customer']
  lastVisit: UnifiedOrder['last_visit']
  currentOrderId: string
}

/**
 * CUSTOMER HISTORY SUMMARY — positioned immediately below Order Creator,
 * before Products. Values are the EXISTING persisted customer fields
 * (previous_order_count / previous_orders_total / previous_order_number /
 * previous_order_date / previous_order_total) — never recalculated here.
 *
 * Every metric is interactive: clicking opens a panel with the ACTUAL records
 * fetched through the EXISTING RPCs (get_unified_orders with p_customer_id,
 * get_customer_visits), excluding the current order — the same scope the
 * server uses for the persisted metrics. Order records reuse OrderCard, so
 * clicking navigates to the canonical Order Details route.
 */
export function CustomerHistorySection({ customer, lastVisit, currentOrderId }: CustomerHistorySectionProps) {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [records, setRecords] = useState<any[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const prevCount = customer?.previous_order_count
  const hasHistory = prevCount != null && prevCount > 0

  async function openOrders(title: string, highlightLatest: boolean) {
    if (!customer?.id) return
    setPanel({ kind: 'orders', title, highlightLatest })
    setRecords(null)
    setError(null)
    setLoading(true)
    try {
      const token = getToken()
      if (!token) throw new Error('no-session')
      const { data, error: rpcError } = await supabase.rpc('get_unified_orders', {
        p_token: token,
        p_customer_id: customer.id,
      })
      if (rpcError) throw rpcError
      const rows = (Array.isArray(data) ? data : [])
        .filter((o: any) => String(o.id) !== String(currentOrderId))
        .sort((a: any, b: any) => String(b.created_at || '') > String(a.created_at || '') ? 1 : -1)
      setRecords(rows)
    } catch {
      setError('تعذر تحميل السجل. حاول مرة أخرى.')
    } finally {
      setLoading(false)
    }
  }

  async function openVisits() {
    if (!customer?.id) return
    setPanel({ kind: 'visits' })
    setRecords(null)
    setError(null)
    setLoading(true)
    try {
      const token = getToken()
      if (!token) throw new Error('no-session')
      const { data, error: rpcError } = await supabase.rpc('get_customer_visits', {
        p_token: token,
        p_customer_id: customer.id,
        p_limit: 50,
      })
      if (rpcError) throw rpcError
      const rows = Array.isArray(data) ? data : []
      setRecords(rows)
    } catch {
      setError('تعذر تحميل السجل. حاول مرة أخرى.')
    } finally {
      setLoading(false)
    }
  }

  function close() {
    setPanel(null)
    setRecords(null)
    setError(null)
  }

  // Escape closes the panel (same pattern as the expanded product modal).
  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel])

  const shownTotal = panel?.kind === 'orders' && records
    ? records.reduce((s, o) => s + (Number(o.total_amount) || 0), 0)
    : 0

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div>
          {lastVisit && lastVisit.start_latitude != null && lastVisit.start_longitude != null ? (
            <button
              type="button"
              onClick={openVisits}
              className="w-full text-right bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-4 h-full cursor-pointer active:scale-[0.99] transition-all hover:border-[#BFDBFE]"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-[14px] font-bold text-[#111827]">آخر زيارة للعميل</p>
                <span className="text-[#9CA3AF] text-sm leading-none">‹</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
                <div><p className="text-[#9CA3AF] text-[11px]">المسؤول</p><p className="font-semibold text-[#111827] break-words">{lastVisit.employee_name || 'غير متوفر'}</p></div>
                <div><p className="text-[#9CA3AF] text-[11px]">بداية الزيارة</p><p className="font-semibold text-[#111827]">{formatDateTime(lastVisit.started_at)}</p></div>
                {lastVisit.completed_at && <div><p className="text-[#9CA3AF] text-[11px]">نهاية الزيارة</p><p className="font-semibold text-[#111827]">{formatDateTime(lastVisit.completed_at)}</p></div>}
                <div><p className="text-[#9CA3AF] text-[11px]">حالة الزيارة</p><p className="font-semibold text-[#111827] break-words">{lastVisit.status}</p></div>
              </div>
              <div className="grid grid-cols-4 gap-2 mt-2">
                <a href={lastVisit.maps_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                  className="flex items-center justify-center gap-1 text-xs text-[#DC2626] bg-[#FEF2F2] hover:bg-[#FEE2E2] px-2 py-1.5 rounded-lg transition-colors font-medium h-[30px]">
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                  فتح
                </a>
                <button onClick={(e) => { e.stopPropagation(); copyToClipboard(lastVisit.maps_url).then((ok) => { if (ok) window.alert('تم نسخ الرابط') }) }}
                  className="flex items-center justify-center gap-1 text-xs text-[#2563EB] bg-[#EFF6FF] hover:bg-[#DBEAFE] px-2 py-1.5 rounded-lg transition-colors font-medium h-[30px]">
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                  نسخ
                </button>
                <button onClick={(e) => { e.stopPropagation(); if (navigator.share) navigator.share({ title: 'الموقع', text: '', url: lastVisit.maps_url }) }}
                  className="flex items-center justify-center gap-1 text-xs text-[#059669] bg-[#ECFDF5] hover:bg-[#D1FAE5] px-2 py-1.5 rounded-lg transition-colors font-medium h-[30px]">
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
                  مشاركة
                </button>
                <button onClick={(e) => { e.stopPropagation(); fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lastVisit.start_latitude}&lon=${lastVisit.start_longitude}&accept-language=ar`).then(r => r.json()).then(d => window.alert(d.display_name || 'تعذر استخراج العنوان')).catch(() => window.alert('تعذر استخراج العنوان')) }}
                  className="flex items-center justify-center gap-1 text-xs text-[#D97706] bg-[#FFFBEB] hover:bg-[#FEF3C7] px-2 py-1.5 rounded-lg transition-colors font-medium h-[30px]">
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
                  عنوان
                </button>
              </div>
            </button>
          ) : (
            <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5 flex flex-col items-center justify-center gap-1.5 h-full min-h-[100px]">
              <span className="text-2xl">📍</span>
              <p className="text-xs text-[#6B7280] text-center">لم تتم أي زيارة لهذا العميل حتى الآن.</p>
            </div>
          )}
        </div>
        <div>
          {hasHistory ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => openOrders('الطلبات السابقة', false)}
                className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-3 flex flex-col items-center justify-center cursor-pointer active:scale-[0.98] transition-all hover:border-[#BFDBFE] min-h-[76px]"
              >
                <p className="text-[10px] text-[#9CA3AF] font-medium text-center">الطلبات السابقة</p>
                <p className="text-[15px] font-bold text-[#111827] mt-0.5">{customer!.previous_order_count}</p>
                <span className="text-[#9CA3AF] text-xs leading-none mt-1">‹</span>
              </button>
              <button
                type="button"
                onClick={() => openOrders('المشتريات السابقة', false)}
                className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-3 flex flex-col items-center justify-center cursor-pointer active:scale-[0.98] transition-all hover:border-[#BFDBFE] min-h-[76px]"
              >
                <p className="text-[10px] text-[#9CA3AF] font-medium text-center">المشتريات السابقة</p>
                <p className="text-[15px] font-bold text-[#059669] mt-0.5">{formatCurrencyShort(Number(customer!.previous_orders_total))}</p>
                <span className="text-[#9CA3AF] text-xs leading-none mt-1">‹</span>
              </button>
              <button
                type="button"
                onClick={() => openOrders('آخر طلب سابق', true)}
                className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-3 flex flex-col items-center justify-center cursor-pointer active:scale-[0.98] transition-all hover:border-[#BFDBFE] min-h-[76px] col-span-2"
              >
                <p className="text-[10px] text-[#9CA3AF] font-medium text-center">آخر طلب سابق</p>
                <p className="text-[12px] font-bold text-[#111827] font-mono mt-0.5 break-all text-center">{customer!.previous_order_number || '—'}</p>
                <span className="text-[#9CA3AF] text-xs leading-none mt-1">‹</span>
              </button>
              <button
                type="button"
                onClick={() => openOrders('قيمة آخر طلب', true)}
                className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-3 flex flex-col items-center justify-center cursor-pointer active:scale-[0.98] transition-all hover:border-[#BFDBFE] min-h-[76px] col-span-2"
              >
                <p className="text-[10px] text-[#9CA3AF] font-medium text-center">قيمة آخر طلب</p>
                {customer!.previous_order_total != null && <p className="text-[13px] font-bold text-[#111827] mt-0.5">{formatCurrencyShort(Number(customer!.previous_order_total))}</p>}
                {customer!.previous_order_date && <p className="text-[10px] text-[#6B7280] mt-0.5">{new Date(customer!.previous_order_date).toLocaleDateString('ar-EG-u-nu-latn')}</p>}
                <span className="text-[#9CA3AF] text-xs leading-none mt-1">‹</span>
              </button>
            </div>
          ) : customer?.previous_order_count != null ? (
            <div className="bg-white rounded-lg border border-[#E5E7EB] shadow-sm p-5 flex flex-col items-center justify-center h-full min-h-[100px]">
              <p className="text-xs text-[#6B7280]">هذا أول طلب للعميل</p>
            </div>
          ) : null}
        </div>
      </div>

      {panel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 py-6" onClick={close}>
          <div
            className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB] shrink-0">
              <h3 className="text-sm font-bold text-[#111827]">
                {panel.kind === 'orders' ? panel.title : 'زيارات العميل'}
                {panel.kind === 'orders' && records && (
                  <span className="text-[11px] font-semibold text-[#6B7280] mr-2">({records.length})</span>
                )}
                {panel.kind === 'visits' && records && (
                  <span className="text-[11px] font-semibold text-[#6B7280] mr-2">({records.length})</span>
                )}
              </h3>
              <button onClick={close} aria-label="إغلاق"
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-surface text-text-secondary text-base active:opacity-70 shrink-0">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {loading && (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-[#6B7280]">جاري تحميل السجل...</p>
                </div>
              )}
              {!loading && error && (
                <div className="text-center py-10 space-y-3">
                  <p className="text-sm text-danger font-semibold">{error}</p>
                  <button
                    onClick={() => (panel.kind === 'orders' ? openOrders(panel.title, panel.highlightLatest) : openVisits())}
                    className="text-xs font-semibold text-white bg-primary px-4 py-2 rounded-lg active:opacity-90"
                  >
                    إعادة المحاولة
                  </button>
                </div>
              )}
              {!loading && !error && records && records.length === 0 && (
                <div className="text-center py-10">
                  <p className="text-sm text-[#6B7280] font-semibold">لا توجد سجلات مطابقة.</p>
                </div>
              )}
              {!loading && !error && records && records.length > 0 && panel.kind === 'orders' && (
                <>
                  {records.map((o: any, idx: number) => (
                    <div key={String(o.id || idx)} className={panel.highlightLatest && idx === 0 ? 'rounded-xl ring-2 ring-emerald-300' : ''}>
                      {panel.highlightLatest && idx === 0 && (
                        <p className="text-[10px] font-bold text-[#059669] mb-1">الأحدث</p>
                      )}
                      <OrderCard order={o} orderId={String(o.id)} />
                    </div>
                  ))}
                  <div className="flex items-center justify-between bg-surface rounded-xl px-3 py-2.5">
                    <span className="text-[11px] text-[#6B7280] font-semibold">إجمالي المعروض ({records.length}):</span>
                    <span className="text-[13px] font-extrabold text-[#111827]" dir="ltr">{formatCurrencyShort(shownTotal)} </span>
                  </div>
                </>
              )}
              {!loading && !error && records && records.length > 0 && panel.kind === 'visits' && (
                <>
                  {records.map((v: any, idx: number) => (
                    <div key={String(v.id || idx)} className="bg-white rounded-xl border border-[#E5E7EB] p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-bold text-[#111827] font-mono break-all">{v.code || 'زيارة'}</span>
                        <span className="text-[10px] font-semibold text-[#059669] bg-[#ECFDF5] px-2 py-0.5 rounded-full shrink-0">{v.status || ''}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[#6B7280] flex-wrap">
                        <span>التاريخ: {v.check_in_at ? formatDate(new Date(v.check_in_at)) : '—'}</span>
                        {v.employee_name && <span>المسؤول: {v.employee_name}</span>}
                      </div>
                      {v.visit_result && <p className="text-[11px] text-[#6B7280] break-words">النتيجة: {v.visit_result}</p>}
                      {v.notes && <p className="text-[11px] text-[#6B7280] break-words leading-relaxed">{v.notes}</p>}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
