import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ORDER_STATUS_LABELS, EXECUTION_GROUP, USER_FACING_STATUS_ORDER, UPPER_MANAGEMENT_STATUS_ORDER } from '../../types/order-display'
import { useUpperManagement } from '../../hooks/useUpperManagement'
import { formatMixedQuantity } from '../../utils/quantity-format'
import type { UnitType } from '../../types/storefront'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const ERROR_MAP: Record<string, string> = {
  'INVALID_SESSION': 'انتهت صلاحية الجلسة، الرجاء تسجيل الدخول مرة أخرى',
  'INVALID_STATE': 'لا يمكن تنفيذ هذا الإجراء في الحالة الحالية للطلب',
  'ORDER_NOT_FOUND': 'الطلب غير موجود',
  'NOT_FOUND': 'الطلب غير موجود',
  'FORBIDDEN': 'ليس لديك صلاحية لتنفيذ هذا الإجراء',
  'MISSING_CAPABILITY': 'ليس لديك صلاحية لتنفيذ هذا الإجراء',
  'INSUFFICIENT_STOCK': 'الكمية المطلوبة تتجاوز الكمية المتاحة — برجاء تعديل كميات الطلب',
}

function toUserError(msg: string): string {
  if (!msg) return 'حدث خطأ غير متوقع'
  for (const [code, arabic] of Object.entries(ERROR_MAP)) {
    if (msg.includes(code) || msg.includes(code.toLowerCase())) return arabic
  }
  if (/PGRST|Could not find|schema cache|syntax error|relation .* does not exist/i.test(msg)) {
    console.error('[Technical Error]', msg)
    return 'حدث خطأ في النظام، الرجاء المحاولة مرة أخرى'
  }
  return msg
}

/** Smart Quantity Formatter for adjustment messages (BR-AUD-01). */
function adjustmentQuantityLabel(pieces: number, cartonQuantity: number, units: AdjustmentUnit[]): string {
  const t = units && units.length > 0 ? units[0].unit_type : 'piece'
  const pref: UnitType = t === 'carton' || t === 'dozen' || t === 'piece' ? t : 'piece'
  return formatMixedQuantity(pieces, cartonQuantity, pref)
}

const ALL_STATUSES = ['draft','submitted','sales_manager_approved','reviewing','returned_for_revision','approved','preparing','prepared','ready_for_dispatch','sent_to_delivery','dispatched','deferred','cancelled','delivered','stock_review'] as const

type OrderStatus = typeof ALL_STATUSES[number]

const WORKFLOW_ORDER = ['draft','submitted','sales_manager_approved','reviewing','returned_for_revision','approved','preparing','prepared','ready_for_dispatch','sent_to_delivery','dispatched','deferred','cancelled','delivered','stock_review']

interface ShortageEntry {
  product_id: string
  requested_quantity: number
  available_quantity: number
}

interface AdjustmentUnit {
  unit_type: string
  unit_quantity: number
  unit_price?: number
  total_price?: number
}

interface AdjustmentEntry {
  product_id: string
  product_name: string
  requested_pieces: number
  available_pieces: number
  executable_pieces: number
  action: 'reduce' | 'remove'
  carton_quantity: number
  requested_units: AdjustmentUnit[]
  executable_units: AdjustmentUnit[]
}

interface PendingAdjustment {
  target: string
  reasonText: string | null
  referenceNumber?: string
  adjustments: AdjustmentEntry[]
}

interface OrderStatusManagerProps {
  orderId: string
  currentStatus: string
  canReview: boolean
  canApprove?: boolean
  canCompletePreparation: boolean
  canSendToDelivery: boolean
  canManage: boolean
  referenceNumber?: string | null
  onSuccess?: (newStatus: string) => void
  onError?: (error: string) => void
  onShortage?: (shortages: ShortageEntry[], details?: string) => void
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
  // Stock Review → Submitted is the normal resubmission path (not exceptional)
  if (from === 'stock_review' && to === 'submitted') return false
  if (from === 'stock_review') return true
  if (!isForward(from, to)) return true
  if (!isAdjacent(from, to)) return true
  return false
}

export function OrderStatusManager({ orderId, currentStatus, canReview, canApprove, canCompletePreparation, canSendToDelivery, canManage, referenceNumber, onSuccess, onError, onShortage }: OrderStatusManagerProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [showReasonModal, setShowReasonModal] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [showRefModal, setShowRefModal] = useState(false)
  const [refNumber, setRefNumber] = useState('')
  const [pendingRefNumber, setPendingRefNumber] = useState('')
  const [pendingAdjustments, setPendingAdjustments] = useState<PendingAdjustment | null>(null)
  const isUpperManagement = useUpperManagement()

  function hasExistingReferenceNumber(): boolean {
    return typeof referenceNumber === 'string' && referenceNumber.trim().length > 0
  }

  function getAllowedTargets(): OrderStatus[] {
    if (canManage) return ALL_STATUSES.filter(s => s !== currentStatus)
    const targets: OrderStatus[] = []
    if (canReview && currentStatus === 'sales_manager_approved') targets.push('reviewing')
    if (canApprove && (currentStatus === 'submitted' || currentStatus === 'sales_manager_approved')) {
      for (const t of ['sales_manager_approved', 'returned_for_revision', 'cancelled'] as OrderStatus[]) {
        if (t !== currentStatus) targets.push(t)
      }
    }
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

    if (target === 'reviewing' && !hasExistingReferenceNumber()) {
      setShowRefModal(true)
      return
    }

    if (isExceptional(currentStatus, target)) {
      setShowReasonModal(target)
      return
    }

    await executeChange(target, null)
  }

  async function handleRefConfirm() {
    if (!refNumber.trim()) return
    const ref = refNumber.trim()
    setShowRefModal(false)
    setRefNumber('')
    if (isExceptional(currentStatus, 'reviewing')) {
      setPendingRefNumber(ref)
      setShowReasonModal('reviewing')
      return
    }
    await executeChange('reviewing', null, ref)
  }

  async function handleReasonConfirm() {
    if (!showReasonModal || !reason.trim()) return
    const ref = pendingRefNumber
    await executeChange(showReasonModal, reason.trim(), ref ? ref : undefined)
    setShowReasonModal(null)
    setReason('')
    setPendingRefNumber('')
  }

  async function executeChange(target: string, reasonText: string | null, referenceNumber?: string) {
    const token = getToken()
    if (!token) return
    setLoading(target)

    // Execution Group Entry Finalization: معاينة تعديل الكميات قبل دخول مجموعة التنفيذ.
    if (EXECUTION_GROUP.has(target) && !EXECUTION_GROUP.has(currentStatus)) {
      const { data: preview, error: pErr } = await supabase.rpc('governed_preview_execution_entry', {
        p_token: token,
        p_order_id: orderId,
      })
      if (pErr) {
        onError?.(toUserError(pErr.message))
        setLoading(null)
        return
      }
      const adjustments = preview && typeof preview === 'object'
        ? (preview as { adjustments?: AdjustmentEntry[] }).adjustments
        : undefined
      if (Array.isArray(adjustments) && adjustments.length > 0) {
        setPendingAdjustments({ target, reasonText, referenceNumber, adjustments })
        setLoading(null)
        return
      }
    }

    await callTransition(target, reasonText, referenceNumber, false)
  }

  async function callTransition(target: string, reasonText: string | null, referenceNumber: string | undefined, confirmAdjustments: boolean) {
    const token = getToken()
    if (!token) return
    setLoading(target)

    if (target === 'approved') {
      const { data, error } = await supabase.rpc('governed_approve_order', {
        p_token: token,
        p_id: orderId,
        p_reason: reasonText,
        p_confirm_adjustments: confirmAdjustments,
      })
      if (error) {
        onError?.(toUserError(error.message))
        setLoading(null)
        return
      }
      if (data && typeof data === 'object' && 'error' in data && data.error) {
        if ('adjustments' in data && Array.isArray(data.adjustments) && data.adjustments.length > 0) {
          setPendingAdjustments({ target, reasonText, referenceNumber, adjustments: data.adjustments as AdjustmentEntry[] })
          setLoading(null)
          return
        }
        if ('shortages' in data && Array.isArray(data.shortages) && data.shortages.length > 0) {
          onShortage?.(data.shortages as ShortageEntry[], String(data.details || data.error))
        } else {
          onError?.(toUserError(String(data.error)))
        }
        setLoading(null)
        return
      }
      onSuccess?.(target)
      setLoading(null)
      return
    }

    const { data, error } = await supabase.rpc('governed_change_order_status', {
      p_token: token,
      p_order_id: orderId,
      p_new_status: target,
      p_reason: reasonText,
      p_reference_number: referenceNumber || null,
      p_confirm_adjustments: confirmAdjustments,
    })
    if (error) {
      onError?.(toUserError(error.message))
      setLoading(null)
      return
    }
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      if ('adjustments' in data && Array.isArray(data.adjustments) && data.adjustments.length > 0) {
        setPendingAdjustments({ target, reasonText, referenceNumber, adjustments: data.adjustments as AdjustmentEntry[] })
        setLoading(null)
        return
      }
      if ('shortages' in data && Array.isArray(data.shortages) && data.shortages.length > 0) {
        onShortage?.(data.shortages as ShortageEntry[], String(data.details || data.error))
      } else {
        onError?.(toUserError(String(data.error)))
      }
      setLoading(null)
      return
    }
    onSuccess?.(target)
    setLoading(null)
  }

  async function handleAdjustmentConfirm() {
    if (!pendingAdjustments) return
    const { target, reasonText, referenceNumber } = pendingAdjustments
    setPendingAdjustments(null)
    await callTransition(target, reasonText, referenceNumber, true)
  }

  function handleAdjustmentCancel() {
    setPendingAdjustments(null)
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
      onError?.(toUserError(error.message))
      setLoading(null)
      setShowReturnModal(false)
      return
    }
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      onError?.(toUserError(String(data.error)))
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

  // "تغيير الحالة" control: the exact role order (7 user-facing first; Upper
  // Management additionally gets the remaining operational statuses after
  // "ملغى"). draft is never shown. Permission-driven transition buttons below
  // keep their existing behavior untouched.
  const statusOrder = (isUpperManagement || canManage) ? UPPER_MANAGEMENT_STATUS_ORDER : USER_FACING_STATUS_ORDER
  const orderedTargets = targets
    .filter((t) => statusOrder.includes(t as string))
    .sort((a, b) => statusOrder.indexOf(a as string) - statusOrder.indexOf(b as string))

  const standardTransitions = targets.filter(t => !isExceptional(currentStatus, t))
  const exceptionalTransitions = targets.filter(t => isExceptional(currentStatus, t))

  return (
    <>
      {canManage && orderedTargets.length > 1 && (
        <>
          <button onClick={() => setShowDropdown(true)} disabled={loading !== null}
            className="bg-purple-600 text-white text-xs px-3 py-2.5 rounded-lg active:opacity-90 disabled:opacity-40 inline-flex items-center justify-center gap-1 whitespace-nowrap">
            {loading ? 'جاري...' : 'تغيير الحالة'}
          </button>
          {currentStatus !== 'returned_for_revision' && currentStatus !== 'draft' && currentStatus !== 'cancelled' && (
            <button onClick={() => setShowReturnModal(true)} disabled={loading !== null}
              className="bg-amber-500 text-white text-xs px-3 py-2.5 rounded-lg active:opacity-90 disabled:opacity-40 inline-flex items-center justify-center gap-1 whitespace-nowrap">
              {loading === 'returned_for_revision' ? 'جاري...' : 'إعادة الطلب للتعديل'}
            </button>
          )}
          {showDropdown && (
            <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={() => setShowDropdown(false)}>
              <div className="bg-white rounded-t-2xl max-h-[calc(100dvh-6rem)] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-border">
                  <span className="text-sm font-bold text-text">تغيير الحالة</span>
                  <button onClick={() => setShowDropdown(false)} className="text-text-secondary text-lg leading-none">&times;</button>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0 p-3 pb-16 space-y-0.5">
                  {orderedTargets.map(t => (
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
              className="bg-primary text-white text-xs px-3 py-2.5 rounded-lg active:opacity-90 disabled:opacity-40 whitespace-nowrap">
              {loading === t ? 'جاري...' : ORDER_STATUS_LABELS[t] || t}
            </button>
          ))}
          {exceptionalTransitions.map(t => (
            <button key={t} onClick={() => handleStatusChange(t)} disabled={loading !== null}
              className="bg-amber-500 text-white text-xs px-3 py-2.5 rounded-lg active:opacity-90 disabled:opacity-40 whitespace-nowrap">
              {loading === t ? 'جاري...' : ORDER_STATUS_LABELS[t] || t}
            </button>
          ))}
        </div>
      )}

      {showRefModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-4">
            <h3 className="text-sm font-bold text-text">إدخال الرقم المرجعى</h3>
            <input
              type="text"
              value={refNumber}
              onChange={(e) => setRefNumber(e.target.value)}
              placeholder="الرقم المرجعى..."
              autoFocus
              className="w-full border border-border rounded-lg px-3 py-2 text-xs bg-white"
            />
            {!refNumber.trim() && refNumber.length > 0 && (
              <p className="text-[10px] text-danger">الرجاء إدخال الرقم المرجعى</p>
            )}
            <div className="flex gap-2">
              <button onClick={() => { setShowRefModal(false); setRefNumber('') }}
                className="flex-1 bg-surface text-text text-xs py-2.5 rounded-lg active:opacity-80 transition-opacity">إلغاء</button>
              <button onClick={handleRefConfirm} disabled={!refNumber.trim() || loading !== null}
                className="flex-1 bg-primary text-white text-xs py-2.5 rounded-lg active:opacity-90 disabled:opacity-40">تأكيد</button>
            </div>
          </div>
        </div>
      )}

      {showReasonModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-4">
            <h3 className="text-sm font-bold text-text">تغيير استثنائي</h3>
            <p className="text-xs text-text-secondary">
              من <span className="font-semibold text-amber-600">{ORDER_STATUS_LABELS[currentStatus]}</span> إلى <span className="font-semibold text-amber-600">{ORDER_STATUS_LABELS[showReasonModal]}</span>
            </p>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="الرجاء كتابة سبب التغيير..."
              className="w-full border border-border rounded-lg px-3 py-2 text-xs bg-white resize-none" />
            <div className="flex gap-2">
              <button onClick={() => { setShowReasonModal(null); setReason(''); setPendingRefNumber('') }}
                className="flex-1 bg-surface text-text text-xs py-2.5 rounded-lg active:opacity-80 transition-opacity">إلغاء</button>
              <button onClick={handleReasonConfirm} disabled={!reason.trim() || loading !== null}
                className="flex-1 bg-purple-600 text-white text-xs py-2.5 rounded-lg active:opacity-90 disabled:opacity-40">تأكيد</button>
            </div>
          </div>
        </div>
      )}

      {showReturnModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-5 space-y-4">
            <h3 className="text-sm font-bold text-text">إعادة الطلب للتعديل</h3>
            <p className="text-xs text-text-secondary">
              إعادة الطلب من <span className="font-semibold text-amber-600">{ORDER_STATUS_LABELS[currentStatus]}</span> إلى <span className="font-semibold text-amber-600">معاد للتعديل</span>
            </p>
            <p className="text-[10px] text-danger/70">هذا الإجراء سيعيد الكميات إلى الكمية المتاحة ويعكس الفواتير الائتمانية إن وجدت</p>
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

      {pendingAdjustments && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4 py-6 overflow-y-auto">
          <div className="bg-white rounded-xl w-full max-w-lg p-5 space-y-4 my-auto">
            <h3 className="text-sm font-bold text-text">تنبيه: مراجعة مخزون الأصناف</h3>
            <p className="text-[11px] text-text-secondary">
              يرجى مراجعة مخزون الأصناف التالية قبل الاعتماد:
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {pendingAdjustments.adjustments.map(a => (
                <div key={a.product_id} className="border border-border rounded-lg p-3 bg-surface/50">
                  <p className="text-xs font-bold text-text">{a.product_name}</p>
                  <p className="text-[11px] text-danger mt-1">
                    يرجى مراجعة مخزون هذا الصنف — الكمية المطلوبة: <span className="font-semibold">{adjustmentQuantityLabel(a.requested_pieces, a.carton_quantity, a.requested_units)}</span>، المتاح: <span className="font-semibold">{adjustmentQuantityLabel(a.available_pieces, a.carton_quantity, [])}</span>
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-danger/70">النظام لن يعدل الكميات تلقائيًا. يرجى تعديل كميات الأصناف يدويًا.</p>
            <div className="flex gap-2">
              <button onClick={handleAdjustmentCancel} disabled={loading !== null}
                className="flex-1 bg-surface text-text text-xs py-2.5 rounded-lg active:opacity-80 transition-opacity">إلغاء</button>
              <button onClick={handleAdjustmentConfirm} disabled={loading !== null}
                className="flex-1 bg-primary text-white text-xs py-2.5 rounded-lg active:opacity-90 disabled:opacity-40">متابعة</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
