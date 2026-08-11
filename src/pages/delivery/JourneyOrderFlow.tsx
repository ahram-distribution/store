import {
  JOURNEY_ORDER_STEP_ORDER, DELIVERY_STEP_LABELS, deliveryStepIndex,
  nextJourneyOrderAction, fmtTime, formatDistanceHuman,
} from './shared'
import type { JourneySegment } from './shared'

export interface JourneyAction {
  action: string
  employee_name?: string
  amount?: string | number | null
  captured_at?: string | null
  created_at?: string | null
}

interface JourneyOrderFlowProps {
  step: string | null
  collectionRequired: boolean | null
  customerNotFound: boolean
  actions?: JourneyAction[]
  segments?: JourneySegment[]
  totalMeters?: number
  manage?: boolean
  busy?: string | null
  amount?: string
  onAmountChange?: (v: string) => void
  onAction?: (action: string, opts?: { withoutCollection?: boolean }) => void
}

const STAGE_ICONS: Record<string, string> = {
  moving_to_customer: '🚚',
  arrived_at_customer: '📍',
  collected: '💰',
}

function stageAction(actionName: string, actions: JourneyAction[] | undefined): JourneyAction | undefined {
  if (actionName === 'arrived_at_customer') {
    return (actions || []).find((a) => a.action === 'arrived_at_customer' || a.action === 'customer_not_found')
  }
  return (actions || []).find((a) => a.action === actionName)
}

/**
 * Per-order step flow inside a journey. The journey owns استلام الشحنة and
 * الرجوع لمقر الشركة; this component manages only تحرك -> وصول -> نتيجة ->
 * تحصيل for a single order.
 */
export function JourneyOrderFlow({
  step, collectionRequired, customerNotFound, actions,
  segments, totalMeters, manage, busy, amount, onAmountChange, onAction,
}: JourneyOrderFlowProps) {
  const stepIdx = deliveryStepIndex(step)
  const doneCount = stepIdx === -1 ? 0 : Math.min(stepIdx + 1, 3)
  const next = nextJourneyOrderAction(step, collectionRequired)
  const currentIdx = next ? JOURNEY_ORDER_STEP_ORDER.indexOf(next as (typeof JOURNEY_ORDER_STEP_ORDER)[number]) : -1
  const isDone = next === null

  const run = (action: string, opts?: { withoutCollection?: boolean }) => {
    if (busy !== null && busy !== undefined) return
    onAction?.(action, opts)
  }

  const actionBtnClass = (variant: 'primary' | 'success' | 'danger' | 'muted') => {
    const base = 'w-full rounded-xl p-3 text-sm font-semibold transition-colors disabled:opacity-50'
    if (variant === 'primary') return `${base} bg-primary text-white`
    if (variant === 'success') return `${base} bg-emerald-600 text-white`
    if (variant === 'danger') return `${base} bg-white border border-red-300 text-red-600`
    return `${base} bg-white border border-border text-text-secondary`
  }

  const statusChip = (done: boolean, current: boolean, future: boolean) => {
    if (done) return <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">✓ مكتملة</span>
    if (current) return <span className="text-[11px] font-semibold text-primary bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">● الإجراء الحالي</span>
    if (future) return <span className="text-[11px] font-semibold text-gray-400 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full">○ لاحقاً</span>
    return null
  }

  return (
    <div>
      <div className="space-y-0">
        {JOURNEY_ORDER_STEP_ORDER.map((stage, i) => {
          const isCollected = stage === 'collected'
          const done = i < doneCount
          const current = i === currentIdx
          const future = !done && !current
          const act = stageAction(stage, actions)
          const actIndex = actions ? actions.findIndex((a) => a.action === act?.action) : -1
          const seg = actIndex >= 0 && segments ? segments[actIndex] : null

          const outcomeText = done
            ? stage === 'arrived_at_customer'
              ? (customerNotFound || step === 'customer_not_found' ? 'لم يتم العثور على العميل' : 'تم الوصول للعميل')
              : isCollected
                ? (collectionRequired === false ? 'التسليم بدون تحصيل' : (act && Number(act.amount) > 0 ? `تم التحصيل: ${Number(act.amount).toLocaleString('ar-EG-u-nu-latn')} ج.م` : 'بدون تحصيل'))
                : null
            : null

          return (
            <div key={stage} className="flex gap-3">
              <div className="flex flex-col items-center shrink-0">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0 transition-colors ${done ? 'bg-emerald-500' : current ? 'bg-primary ring-4 ring-blue-100' : 'bg-gray-200'}`}>
                  <span className={done || current ? '' : 'opacity-50 grayscale'}>{STAGE_ICONS[stage]}</span>
                </div>
                {i < JOURNEY_ORDER_STEP_ORDER.length - 1 && (
                  <div className={`w-0.5 flex-1 my-1 rounded ${done ? 'bg-emerald-400' : 'bg-gray-200'}`} />
                )}
              </div>

              <div className="flex-1 pb-4 min-w-0">
                <div className={`rounded-xl border p-3 ${current ? 'border-primary bg-blue-50/40 ring-1 ring-blue-200' : 'border-border bg-white'}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className={`text-sm font-bold ${done ? 'text-emerald-700' : current ? 'text-primary' : 'text-text-secondary'}`}>
                      {isCollected && collectionRequired === false ? 'بدون تحصيل' : DELIVERY_STEP_LABELS[stage]}
                    </p>
                    {statusChip(done, current, future)}
                  </div>

                  {done && outcomeText && (
                    <p className="text-xs text-text-secondary mt-1">{outcomeText}</p>
                  )}

                  {act && done && (
                    <div className="text-[11px] text-text-secondary mt-1.5 flex items-center gap-2 flex-wrap">
                      {act.captured_at || act.created_at ? <span>🕘 {fmtTime(act.captured_at || act.created_at)}</span> : null}
                      {act.employee_name ? <span>👤 {act.employee_name}</span> : null}
                      {seg && actIndex >= 0 ? (
                        <span>📍 {seg.isFirst ? 'البداية' : formatDistanceHuman(seg.distanceMeters)}</span>
                      ) : null}
                    </div>
                  )}

                  {current && manage && stage === 'moving_to_customer' && (
                    <div className="mt-2">
                      <button onClick={() => run('moving_to_customer')} disabled={busy !== null} className={actionBtnClass('primary')}>
                        {busy === 'moving_to_customer' ? 'جاري...' : 'بدء التحرك من الشركة'}
                      </button>
                    </div>
                  )}

                  {current && manage && stage === 'arrived_at_customer' && (
                    <div className="mt-2 grid grid-cols-1 gap-2">
                      <button onClick={() => run('arrived_at_customer')} disabled={busy !== null} className={actionBtnClass('success')}>
                        {busy === 'arrived_at_customer' ? 'جاري...' : '✓ تم الوصول للعميل'}
                      </button>
                      <button onClick={() => run('customer_not_found')} disabled={busy !== null} className={actionBtnClass('danger')}>
                        {busy === 'customer_not_found' ? 'جاري...' : '✕ لم يتم العثور على العميل'}
                      </button>
                    </div>
                  )}

                  {current && manage && stage === 'collected' && collectionRequired === false && (
                    <div className="mt-2">
                      <button onClick={() => run('collected', { withoutCollection: true })} disabled={busy !== null} className={actionBtnClass('success')}>
                        {busy === 'collected' ? 'جاري...' : '✓ بدون تحصيل'}
                      </button>
                    </div>
                  )}

                  {current && manage && stage === 'collected' && collectionRequired !== false && (
                    <div className="mt-2 space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          value={amount || ''}
                          onChange={(e) => onAmountChange?.(e.target.value)}
                          placeholder="المبلغ المستلم"
                          className="flex-1 min-w-0 border border-border rounded-xl px-3 py-2 text-sm text-left"
                        />
                        <button
                          onClick={() => run('collected')}
                          disabled={busy !== null || (!Number(amount) && Number(amount) !== 0)}
                          className="bg-primary text-white rounded-xl px-4 text-sm font-semibold disabled:opacity-50 whitespace-nowrap"
                        >
                          {busy === 'collected' ? 'جاري...' : 'تسجيل التحصيل'}
                        </button>
                      </div>
                      <button onClick={() => run('collected', { withoutCollection: true })} disabled={busy !== null} className={actionBtnClass('muted')}>
                        {busy === 'collected' ? 'جاري...' : 'بدون تحصيل'}
                      </button>
                    </div>
                  )}

                  {isDone && manage && (
                    <p className="text-xs text-emerald-700 font-semibold mt-1.5">✓ اكتمل هذا الطلب</p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {totalMeters && totalMeters > 0 ? (
        <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-xl p-3 mt-1">
          <span className="text-xs font-semibold text-text">إجمالي مسافة الرحلة</span>
          <span className="text-sm font-bold text-primary">{formatDistanceHuman(totalMeters)}</span>
        </div>
      ) : null}
    </div>
  )
}
