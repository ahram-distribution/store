import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ORDER_STATUS_LABELS, EXECUTION_GROUP, USER_FACING_STATUS_ORDER } from '../../types/order-display'
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

/**
 * The canonical 8 user-facing order statuses in the authoritative display order.
 * Reuses the single source of truth (USER_FACING_STATUS_ORDER) so the status
 * action buttons always match the status filters and every other status
 * sequence: طلب شراء → تم القيد بالسيستم → معتمد → قيد التجهيز → تم التجهيز →
 * تم التسليم → معاد للتعديل → ملغى. draft is internal-only and never offered.
 */
const CANONICAL_STATUSES: readonly string[] = USER_FACING_STATUS_ORDER

/** Capsule colors — same hue language as StatusBadge (soft = target, active = strong outline). */
const STATUS_CAPSULE_STYLE: Record<string, { soft: string; ring: string; glow: string }> = {
  submitted: { soft: 'bg-blue-50 text-blue-700 border-blue-200', ring: 'ring-blue-600', glow: 'shadow-[0_0_8px_2px_rgba(37,99,235,0.28)]' },
  approved: { soft: 'bg-emerald-50 text-emerald-700 border-emerald-200', ring: 'ring-emerald-600', glow: 'shadow-[0_0_8px_2px_rgba(5,150,105,0.28)]' },
  reviewing: { soft: 'bg-blue-50 text-blue-700 border-blue-200', ring: 'ring-blue-600', glow: 'shadow-[0_0_8px_2px_rgba(37,99,235,0.28)]' },
  preparing: { soft: 'bg-emerald-50 text-emerald-700 border-emerald-200', ring: 'ring-emerald-600', glow: 'shadow-[0_0_8px_2px_rgba(5,150,105,0.28)]' },
  prepared: { soft: 'bg-emerald-50 text-emerald-700 border-emerald-200', ring: 'ring-emerald-600', glow: 'shadow-[0_0_8px_2px_rgba(5,150,105,0.28)]' },
  delivered: { soft: 'bg-emerald-50 text-emerald-700 border-emerald-200', ring: 'ring-emerald-600', glow: 'shadow-[0_0_8px_2px_rgba(5,150,105,0.28)]' },
  returned_for_revision: { soft: 'bg-amber-50 text-amber-700 border-amber-200', ring: 'ring-amber-500', glow: 'shadow-[0_0_8px_2px_rgba(245,158,11,0.28)]' },
  cancelled: { soft: 'bg-red-50 text-red-700 border-red-200', ring: 'ring-red-500', glow: 'shadow-[0_0_8px_2px_rgba(239,68,68,0.28)]' },
}

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
  hideRevisionButton?: boolean
  onSuccess?: (newStatus: string) => void
  onError?: (error: string) => void
  onShortage?: (shortages: ShortageEntry[], details?: string) => void
}

/**
 * The statuses the current user may actually move the order to — mirrors the
 * authorization matrix enforced by governed_change_order_status and
 * governed_approve_order on the backend:
 *   - orders.manage → any canonical status (except the current one)
 *   - orders.approve → submitted→(approved|returned_for_revision|cancelled),
 *     returned_for_revision→cancelled, cancelled→returned_for_revision,
 *     reviewing→approved (via governed_approve_order)
 *   - orders.review → submitted→reviewing, approved→reviewing
 *   - warehouse.complete_preparation → preparing→prepared
 *   - transportation.send_to_delivery → prepared→delivered
 * An empty result means the caller has NO status-mutation authority and the
 * manager renders nothing at all.
 */
function getAllowedTargets(currentStatus: string, canReview: boolean, canApprove: boolean, canCompletePreparation: boolean, canSendToDelivery: boolean, canManage: boolean): string[] {
  if (canManage) {
    return CANONICAL_STATUSES.filter((s) => s !== currentStatus)
  }
  const targets = new Set<string>()
  if (canApprove) {
    if (currentStatus === 'submitted') {
      targets.add('approved')
      targets.add('returned_for_revision')
      targets.add('cancelled')
    }
    if (currentStatus === 'returned_for_revision') targets.add('cancelled')
    if (currentStatus === 'cancelled') targets.add('returned_for_revision')
    if (currentStatus === 'reviewing') targets.add('approved')
  }
  if (canReview) {
    if (currentStatus === 'submitted') targets.add('reviewing')
    if (currentStatus === 'approved') targets.add('reviewing')
  }
  if (canCompletePreparation) {
    if (currentStatus === 'preparing') targets.add('prepared')
  }
  if (canSendToDelivery) {
    if (currentStatus === 'prepared') targets.add('delivered')
  }
  return CANONICAL_STATUSES.filter((s) => targets.has(s))
}

export function OrderStatusManager({ orderId, currentStatus, canReview, canApprove, canCompletePreparation, canSendToDelivery, canManage, referenceNumber, hideRevisionButton, onSuccess, onError, onShortage }: OrderStatusManagerProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [showReturnModal, setShowReturnModal] = useState(false)
  const [returnReason, setReturnReason] = useState('')
  const [showRefModal, setShowRefModal] = useState(false)
  const [refNumber, setRefNumber] = useState('')
  const [pendingRefNumber, setPendingRefNumber] = useState('')
  const [pendingAdjustments, setPendingAdjustments] = useState<PendingAdjustment | null>(null)

  const targets = getAllowedTargets(currentStatus, canReview, canApprove ?? false, canCompletePreparation, canSendToDelivery, canManage)
  if (targets.length === 0) return null

  function hasExistingReferenceNumber(): boolean {
    return typeof referenceNumber === 'string' && referenceNumber.trim().length > 0
  }

  /**
   * All canonical 8 statuses are offered as transition targets (minus the
   * current status). The backend RPC enforces authorization/capability rules.
   * There is NO exceptional-change concept: no adjacency restriction, no
   * reason requirement for status changes.
   */
  async function handleStatusChange(target: string) {
    if (target === currentStatus) return
    const token = getToken()
    if (!token) return

    // Reference-number dialog: ONLY when target is reviewing (تم القيد بالسيستم)
    // and the order does not already have a reference number.
    if (target === 'reviewing' && !hasExistingReferenceNumber()) {
      setShowRefModal(true)
      return
    }

    await executeChange(target, null)
  }

  async function handleRefConfirm() {
    if (!refNumber.trim()) return
    const ref = refNumber.trim()
    setShowRefModal(false)
    setRefNumber('')
    await executeChange('reviewing', null, ref)
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

    // Preserve the approval-specific business logic (reservation release,
    // deduction eligibility, execution adjustments) for the normal
    // submitted/reviewing → approved path. All other canonical transitions go
    // through governed_change_order_status.
    if (target === 'approved' && (currentStatus === 'submitted' || currentStatus === 'reviewing')) {
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

  /** Dedicated revision flow: governed_return_order_for_revision increments
   *  revision_number, restores inventory, re-activates deals/offers and
   *  returns the order to internal draft for full editing. This is a distinct
   *  business action (not an exceptional status change) and keeps its reason. */
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

  function renderCapsule(t: string) {
    const style = STATUS_CAPSULE_STYLE[t] || { soft: 'bg-gray-100 text-gray-600 border-gray-200', ring: 'ring-gray-500', glow: 'shadow-md' }
    if (t === currentStatus) {
      return (
        <span key={t} className={`${style.soft} ${style.ring} ${style.glow} rounded-lg border px-3 py-2.5 text-xs font-bold inline-flex items-center cursor-default ring-2 ring-offset-1`}>
          {ORDER_STATUS_LABELS[t] || t}
        </span>
      )
    }
    return (
      <button key={t} onClick={() => handleStatusChange(t)} disabled={loading !== null}
        className={`${style.soft} rounded-lg border px-3 py-2.5 text-xs font-semibold inline-flex items-center whitespace-nowrap shadow-sm transition-colors hover:brightness-95 active:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed`}>
        {loading === t ? 'جاري...' : ORDER_STATUS_LABELS[t] || t}
      </button>
    )
  }

  return (
    <>
      <div className="flex flex-nowrap items-center gap-1.5 max-w-full overflow-x-auto bg-white border border-border/60 rounded-xl px-2.5 py-2 shadow-sm">
        {targets.map(renderCapsule)}
        {!hideRevisionButton && currentStatus !== 'returned_for_revision' && currentStatus !== 'cancelled' && (
          <button onClick={() => setShowReturnModal(true)} disabled={loading !== null}
            className="bg-amber-500 text-white text-xs px-3 py-2.5 rounded-lg active:opacity-90 disabled:opacity-40 inline-flex items-center justify-center gap-1 whitespace-nowrap font-semibold shrink-0">
            {loading === 'returned_for_revision' ? 'جاري...' : 'إعادة الطلب للتعديل'}
          </button>
        )}
      </div>

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
