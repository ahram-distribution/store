import { useState } from 'react'
import { followUpWorkspaceService, CONTACT_METHODS, CONTACT_RESULTS, NEXT_ACTIONS, type ContactMethod } from '../../services/followUpWorkspaceService'
import toast from 'react-hot-toast'

interface Props {
  customerId: string
  customerName?: string
  onDone?: () => void
  onCreateFollowUp?: (at: string | null) => void
  compact?: boolean
}

const DEFAULT_NEXT_FOLLOW_UP_DAYS = 14

export function FollowUpContactForm({ customerId, customerName, onDone, onCreateFollowUp, compact }: Props) {
  const [method, setMethod] = useState<ContactMethod>('call')
  const [reason, setReason] = useState('')
  const [result, setResult] = useState('')
  const [notes, setNotes] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [nextFollowUpAt, setNextFollowUpAt] = useState('')
  const [orderCreated, setOrderCreated] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const advanceDays = (days: number) => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    setNextFollowUpAt(d.toISOString().slice(0, 10))
  }

  const submit = async () => {
    if (saving) return
    setSaving(true); setError(null)
    try {
      await followUpWorkspaceService.logContact({
        customerId,
        method,
        reason: reason || null,
        result: result || null,
        notes: notes || null,
        nextAction: nextAction || null,
        nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : null,
        orderCreated,
      })
      toast.success('تم تسجيل التواصل بنجاح')
      if (result === 'تم إنشاء طلب' || orderCreated) {
        onCreateFollowUp?.(null)
      } else if (nextFollowUpAt) {
        onCreateFollowUp?.(new Date(nextFollowUpAt).toISOString())
      }
      if (!compact) {
        setMethod('call'); setReason(''); setResult(''); setNotes(''); setNextAction(''); setNextFollowUpAt(''); setOrderCreated(false)
      }
      onDone?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'حدث خطأ'
      if (msg === 'FEATURE_UNAVAILABLE') setError('تسجيل التواصل التفصيلي غير متاح بعد — يُطبّق مع تحديث قاعدة البيانات 0023')
      else setError(msg === 'INVALID_SESSION' ? 'انتهت الجلسة' : msg)
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setMethod('call'); setReason(''); setResult(''); setNotes(''); setNextAction(''); setNextFollowUpAt(''); setOrderCreated(false)
  }

  return (
    <div className="space-y-3">
      {customerName && <h3 className="text-sm font-bold text-text">تسجيل تواصل مع {customerName}</h3>}

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] text-text-secondary">وطريقة التواصل</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as ContactMethod)} className="mt-0.5 w-full bg-surface rounded-lg px-2 py-2 text-xs border border-border">
            {CONTACT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] text-text-secondary">سبب التواصل</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: متابعة طلب سابق" className="mt-0.5 w-full bg-surface rounded-lg px-2 py-2 text-xs border border-border" />
        </label>
      </div>

      <label className="block">
        <span className="text-[10px] text-text-secondary">النتيجة</span>
        <select value={result} onChange={(e) => setResult(e.target.value)} className="mt-0.5 w-full bg-surface rounded-lg px-2 py-2 text-xs border border-border">
          <option value="">— اختر النتيجة —</option>
          {CONTACT_RESULTS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="text-[10px] text-text-secondary">ملاحظات</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={compact ? 2 : 3} placeholder="تفاصيل التواصل..." className="mt-0.5 w-full bg-surface rounded-lg px-2 py-2 text-xs border border-border" />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] text-text-secondary">الإجراء التالي</span>
          <select value={nextAction} onChange={(e) => setNextAction(e.target.value)} className="mt-0.5 w-full bg-surface rounded-lg px-2 py-2 text-xs border border-border">
            <option value="">— اختر الإجراء —</option>
            {NEXT_ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] text-text-secondary">موعد المتابعة التالية</span>
          <input type="date" value={nextFollowUpAt} onChange={(e) => setNextFollowUpAt(e.target.value)} className="mt-0.5 w-full bg-surface rounded-lg px-2 py-2 text-xs border border-border" />
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => advanceDays(7)} className="bg-surface text-[10px] px-2 py-1 rounded-lg text-text-secondary">بعد أسبوع</button>
        <button type="button" onClick={() => advanceDays(14)} className="bg-surface text-[10px] px-2 py-1 rounded-lg text-text-secondary">بعد أسبوعين</button>
        <button type="button" onClick={() => advanceDays(30)} className="bg-surface text-[10px] px-2 py-1 rounded-lg text-text-secondary">بعد شهر</button>
      </div>

      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input type="checkbox" checked={orderCreated} onChange={(e) => setOrderCreated(e.target.checked)} className="accent-primary" />
        تم إنشاء طلب من هذا التواصل
      </label>

      {error && <div className="text-[11px] text-danger bg-danger/5 rounded-lg p-2">{error}</div>}

      <div className="flex gap-2">
        <button onClick={submit} disabled={saving} className="flex-1 bg-primary text-white text-xs py-2 rounded-lg font-semibold disabled:opacity-50">
          {saving ? 'جاري الحفظ...' : 'حفظ التواصل'}
        </button>
        <button onClick={reset} className="px-4 border border-border rounded-lg text-xs text-text-secondary">تفريغ</button>
      </div>
    </div>
  )
}