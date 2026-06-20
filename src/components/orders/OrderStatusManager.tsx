import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ORDER_STATUS_LABELS } from '../../types/order-display'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const ALL_STATUSES = ['draft','submitted','reviewing','returned_for_revision','approved','preparing','prepared','ready_for_dispatch','sent_to_delivery','dispatched','deferred','cancelled','delivered'] as const

type OrderStatus = typeof ALL_STATUSES[number]

const WORKFLOW_ORDER = ['draft','submitted','reviewing','returned_for_revision','approved','preparing','prepared','ready_for_dispatch','sent_to_delivery','dispatched','deferred','cancelled','delivered']

interface OrderStatusManagerProps {
  orderId: string
  currentStatus: string
  canReview: boolean
  canCompletePreparation: boolean
  canSendToDelivery: boolean
  canManage: boolean
  onSuccess?: (newStatus: string) => void
  onError?: (error: string) => void
}

function isForward(from: string, to: string): boolean {
  return WORKFLOW_ORDER.indexOf(to) > WORKFLOW_ORDER.indexOf(from)
}

function isAdjacent(from: string, to: string): boolean {
  return Math.abs(WORKFLOW_ORDER.indexOf(to) - WORKFLOW_ORDER.indexOf(from)) === 1
}

function isExceptional(from: string, to: string): boolean {
  if (from === to) return false
  if (from === 'cancelled' || to === 'cancelled') return true
  if (from === 'deferred' || to === 'deferred') return true
  if (!isForward(from, to)) return true
  if (!isAdjacent(from, to)) return true
  return false
}

export function OrderStatusManager({ orderId, currentStatus, canReview, canCompletePreparation, canSendToDelivery, canManage, onSuccess, onError }: OrderStatusManagerProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [showReasonModal, setShowReasonModal] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [returnReason, setReturnReason] = useState('')

  function getAllowedTargets(): OrderStatus[] {
    if (canManage) return ALL_STATUSES.filter(s => s !== currentStatus)
    const targets: OrderStatus[] = []
    if (canReview && currentStatus === 'submitted') targets.push('reviewing')
    if (canCompletePreparation) {
      if (currentStatus === 'approved') targets.push('preparing')
      if (currentStatus === 'preparing') targets.push('prepared')
    }
    if (canSendToDelivery) {
      if (currentStatus === 'prepared') targets.push('sent_to_delivery')
      if (currentStatus === 'ready_for_dispatch') targets.push('sent_to_delivery')
    }
    return targets
  }

  async function handleStatusChange(target: string) {
    const token = getToken()
    if (!token) return

    if (isExceptional(currentStatus, target)) {
      setShowReasonModal(target)
      return
    }

    await executeChange(target, null)
  }

  async function handleReasonConfirm() {
    if (!showReasonModal || !reason.trim()) return
    await executeChange(showReasonModal, reason.trim())
    setShowReasonModal(null)
    setReason('')
  }

  async function executeChange(target: string, reasonText: string | null) {
    const token = getToken()
    if (!token) return
    const actionLabel = ORDER_STATUS_LABELS[target] || target
    setLoading(target)

    if (target === 'approved') {
      const { data, error } = await supabase.rpc('governed_approve_order', {
        p_token: token,
        p_id: orderId,
      })
      if (error) {
        onError?.(error.message)
        setLoading(null)
        return
      }
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        onError?.(String(data.error))
        setLoading(null)
        return
      }
      onSuccess?.(target)
      setLoading(null)
      return
    }

    const { error } = await supabase.rpc('governed_change_order_status', {
      p_token: token,
      p_order_id: orderId,
      p_new_status: target,
      p_reason: reasonText,
    })
    if (error) {
      onError?.(error.message)
      setLoading(null)
      return
    }
    onSuccess?.(target)
    setLoading(null)
  }

  async function handleReturnForRevision() {
    if (!returnReason.trim()) return
    setLoading('returned_for_revision')
    const token = getToken()
    if (!token) return

    const { data, error } = await supabase.rpc('governed_return_order_for_revision', {
      p_token: token,
      p_id: orderId,
      p_reason: returnReason.trim(),
    })
    if (error) {
      onError?.(error.message)
      setLoading(null)
      setShowReturnModal(false)
      return
    }
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      onError?.(String(data.error))
      setLoading(null)
      setShowReturnModal(false)
      return
    }
    setShowReturnModal(false)
    setReturnReason('')
    onSuccess?.('returned_for_revision')
    setLoading(null)
  }

  const targets = getAllowedTargets()
  if (targets.length === 0) { return null }

  const standardTransitions = targets.filter(t => !isExceptional(currentStatus, t))
  const exceptionalTransitions = targets.filter(t => isExceptional(currentStatus, t))

  return (
    <>
      {canManage && targets.length > 1 && (
        <>
          <button onClick={() => setShowDropdown(true)} disabled={loading !== null}
            className="w-full bg-purple-600 text-white text-xs py-2.5 rounded-lg active:opacity-90 disabled:opacity-40 flex items-center justify-center gap-1">
            {loading ? 'جاري...' : 'تغيير الحالة'}
          </button>
          {currentStatus !== 'returned_for_revision' && currentStatus !== 'draft' && currentStatus !== 'cancelled' && (
            <button onClick={() => setShowReturnModal(true)} disabled={loading !== null}
              className="w-full bg-amber-500 text-white text-xs py-2.5 rounded-lg active:opacity-90 disabled:opacity-40 flex items-center justify-center gap-1 mt-1">
              {loading === 'returned_for_revision' ? 'جاري...' : 'إعادة الطلب للتعديل'}
            </button>
          )}
          {showDropdown && (
            <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setShowDropdown(false)}>
              <div className="bg-white rounded-t-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-border">
                  <span className="text-sm font-bold text-text">تغيير الحالة</span>
                  <button onClick={() => setShowDropdown(false)} className="text-text-secondary text-lg leading-none">&times;</button>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0 p-3 pb-16 space-y-0.5">
                  {targets.map(t => (
                    <button key={t} onClick={() => { setShowDropdown(false); handleStatusChange(t) }} disabled={loading !== null}
                      className="w-full text-right px-4 py-2.5 text-xs rounded-xl hover:bg-surface active:bg-border transition-colors flex items-center justify-between">
                      <span>{ORDER_STATUS_LABELS[t] || t}</span>
                      {isExceptional(currentStatus, t) && <span className="text-[9px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">استثنائي</span>}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!canManage && (
        <div className="flex gap-2 flex-wrap">
          {standardTransitions.map(t => (
            <button key={t} onClick={() => handleStatusChange(t)} disabled={loading !== null}
              className="flex-1 min-w-[80px] bg-primary text-white text-xs py-2.5 rounded-lg active:opacity-90 disabled:opacity-40">
              {loading === t ? 'جاري...' : ORDER_STATUS_LABELS[t] || t}
            </button>
          ))}
          {exceptionalTransitions.map(t => (
            <button key={t} onClick={() => handleStatusChange(t)} disabled={loading !== null}
              className="flex-1 min-w-[80px] bg-amber-500 text-white text-xs py-2.5 rounded-lg active:opacity-90 disabled:opacity-40">
              {loading === t ? 'جاري...' : ORDER_STATUS_LABELS[t] || t}
            </button>
          ))}
        </div>
      )}

      {showReasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-4">
            <h3 className="text-sm font-bold text-text">تغيير استثنائي</h3>
            <p className="text-xs text-text-secondary">
              من <span className="font-semibold text-amber-600">{ORDER_STATUS_LABELS[currentStatus]}</span> إلى <span className="font-semibold text-amber-600">{ORDER_STATUS_LABELS[showReasonModal]}</span>
            </p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="الرجاء كتابة سبب التغيير..."
              className="w-full border border-border rounded-lg px-3 py-2 text-xs bg-white resize-none" />
            <div className="flex gap-2">
              <button onClick={() => { setShowReasonModal(null); setReason('') }}
                className="flex-1 bg-surface text-text text-xs py-2.5 rounded-lg active:opacity-80 transition-opacity">إلغاء</button>
              <button onClick={handleReasonConfirm} disabled={!reason.trim() || loading !== null}
                className="flex-1 bg-purple-600 text-white text-xs py-2.5 rounded-lg active:opacity-90 disabled:opacity-40">تأكيد</button>
            </div>
          </div>
        </div>
      )}

      {showReturnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-4">
            <h3 className="text-sm font-bold text-text">إعادة الطلب للتعديل</h3>
            <p className="text-xs text-text-secondary">
              إعادة الطلب من <span className="font-semibold text-amber-600">{ORDER_STATUS_LABELS[currentStatus]}</span> إلى <span className="font-semibold text-amber-600">معاد للتعديل</span>
            </p>
            <p className="text-[10px] text-danger/70">هذا الإجراء سيعيد المخزون ويعكس الفواتير الائتمانية إن وجدت</p>
            <textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} rows={3} placeholder="الرجاء كتابة سبب إعادة الطلب للتعديل (إجباري)..."
              className="w-full border border-border rounded-lg px-3 py-2 text-xs bg-white resize-none" />
            <div className="flex gap-2">
              <button onClick={() => { setShowReturnModal(false); setReturnReason('') }}
                className="flex-1 bg-surface text-text text-xs py-2.5 rounded-lg active:opacity-80 transition-opacity">إلغاء</button>
              <button onClick={handleReturnForRevision} disabled={!returnReason.trim() || loading !== null}
                className="flex-1 bg-amber-500 text-white text-xs py-2.5 rounded-lg active:opacity-90 disabled:opacity-40">تأكيد الإعادة للتعديل</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
