import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useCapability } from '../../hooks/useCapability'
import {
  followUpService,
  type FollowUp,
  type CustomerFollowUpHistory,
  type ContactType,
} from '../../services/followUpService'
import {
  FOLLOW_UP_PRIORITY_LABELS,
  FOLLOW_UP_STATUS_LABELS,
  FOLLOW_UP_PRIORITY_COLORS,
} from '../../components/followups/FollowUpCard'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const CONTACT_TYPES: Array<{ key: ContactType; label: string; icon: string }> = [
  { key: 'call', label: 'اتصال', icon: '📞' },
  { key: 'visit', label: 'زيارة', icon: '📍' },
  { key: 'meeting', label: 'اجتماع', icon: '🤝' },
  { key: 'email', label: 'بريد', icon: '📧' },
  { key: 'sms', label: 'رسالة', icon: '💬' },
  { key: 'other', label: 'أخرى', icon: '📝' },
]

export function FollowUpDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const token = getToken()
  const canComplete = useCapability('followups.complete')
  const canManage = useCapability('followups.manage')

  const [item, setItem] = useState<FollowUp | null>(null)
  const [history, setHistory] = useState<CustomerFollowUpHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string>('open')
  const [resultDraft, setResultDraft] = useState('')
  const [contactType, setContactType] = useState<ContactType>('call')
  const [contactNotes, setContactNotes] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token || !id) { setLoading(false); return }
    const load = async () => {
      setLoading(true)
      try {
        const all = await followUpService.getMyFollowUps()
        const found = all.find((f) => f.id === id) || null
        setItem(found)
        setStatus(found?.status ?? 'open')
        if (found?.customer_id) setHistory(await followUpService.getHistory(found.customer_id))
      } catch {
        setItem(null)
      }
      setLoading(false)
    }
    load()
  }, [token, id])

  if (loading) {
    return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-surface p-4">
        <button onClick={() => navigate('/followups')} className="text-text-secondary text-lg">&larr;</button>
        <div className="text-center py-12 text-text-secondary text-sm">لم يتم العثور على المتابعة</div>
      </div>
    )
  }

  const priorityColor = FOLLOW_UP_PRIORITY_COLORS[item.priority] || '#2563EB'
  const due = item.due_at ? new Date(item.due_at).toLocaleString('ar-EG-u-nu-latn') : 'بدون موعد'
  const isDone = item.status === 'completed' || item.status === 'cancelled'

  const handleStatusChange = async () => {
    if (!token) return
    setBusy(true)
    setError('')
    try {
      if (status === 'completed') {
        await followUpService.completeFollowUp(item.id, resultDraft || null)
      } else {
        await followUpService.updateFollowUp({ id: item.id, status: status as any })
      }
      const all = await followUpService.getMyFollowUps()
      const found = all.find((f) => f.id === id) || null
      setItem(found)
      setStatus(found?.status ?? 'open')
      if (found?.customer_id) setHistory(await followUpService.getHistory(found.customer_id))
    } catch (e: any) {
      setError(e?.message || 'حدث خطأ')
    }
    setBusy(false)
  }

  const handleLogContact = async () => {
    if (!token || !item.customer_id) return
    setBusy(true)
    setError('')
    try {
      await followUpService.addContact(item.customer_id, contactType, contactNotes || null)
      setContactNotes('')
      setHistory(await followUpService.getHistory(item.customer_id))
    } catch (e: any) {
      setError(e?.message || 'حدث خطأ')
    }
    setBusy(false)
  }

  const handleDelete = async () => {
    if (!token) return
    if (!window.confirm('هل تريد حذف هذه المتابعة؟')) return
    setBusy(true)
    try {
      await followUpService.deleteFollowUp(item.id)
      navigate('/followups')
    } catch (e: any) {
      setError(e?.message || 'حدث خطأ')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface p-4 space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/followups')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تفاصيل المتابعة</h1>
      </div>

      {error && <div className="bg-red-50 text-red-600 text-xs border border-red-100 rounded-lg p-2.5">{error}</div>}

      {/* Main card */}
      <div className="bg-white rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: priorityColor }} />
              <h2 className="text-base font-bold text-text">{item.title}</h2>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-lg font-semibold mt-1 inline-block" style={{ background: `${priorityColor}18`, color: priorityColor }}>
              الأولوية: {FOLLOW_UP_PRIORITY_LABELS[item.priority] || item.priority}
            </span>
          </div>
          <span className="text-xs font-semibold text-text-secondary">{FOLLOW_UP_STATUS_LABELS[item.status] || item.status}</span>
        </div>

        <div className="grid grid-cols-1 gap-2 text-xs text-text-secondary">
          {item.customer_name && (
            <button onClick={() => navigate(`/customers/${item.customer_id}`)} className="text-left hover:text-primary">
              👥 {item.customer_name}{item.customer_phone ? ` · ${item.customer_phone}` : ''}
            </button>
          )}
          <div>⏰ الموعد: {due}</div>
          {item.assignee_name && <div>👤 المسؤول: {item.assignee_name}</div>}
          {item.description && <div className="bg-neutral-50 rounded-lg p-2.5 text-text">📝 {item.description}</div>}
          {item.completed_at && <div className="text-emerald-600">✅ اكتملت في: {new Date(item.completed_at).toLocaleString('ar-EG-u-nu-latn')}</div>}
          {item.result && <div className="bg-emerald-50 rounded-lg p-2.5 text-emerald-700">النتيجة: {item.result}</div>}
        </div>

        {/* Actions */}
        {!isDone && (
          <div className="border-t border-border pt-3 space-y-3">
            {status === 'completed' && (
              <div className="space-y-2">
                <div>
                  <label className="text-[11px] text-text-muted block mb-1">النتيجة</label>
                  <textarea
                    value={resultDraft}
                    onChange={(e) => setResultDraft(e.target.value)}
                    className="w-full border border-border rounded-lg p-2 text-sm bg-white"
                    rows={2}
                    placeholder="اكتب نتيجة المتابعة..."
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white flex-1"
              >
                <option value="open">مفتوحة</option>
                <option value="in_progress">جارية</option>
                <option value="completed">مكتملة</option>
                {canManage && <option value="cancelled">ملغية</option>}
              </select>
              {canComplete && (
                <button onClick={handleStatusChange} disabled={busy} className="bg-primary text-white text-xs px-4 py-1.5 rounded-lg font-semibold disabled:opacity-50">
                  {busy ? '...' : 'حفظ'}
                </button>
              )}
            </div>

            {canManage && (
              <button onClick={handleDelete} disabled={busy} className="text-danger text-xs font-semibold">
                حذف المتابعة
              </button>
            )}
          </div>
        )}
      </div>

      {/* Log contact */}
      {item.customer_id && !isDone && (
        <div className="bg-white rounded-lg border border-border p-4 space-y-2">
          <h3 className="text-sm font-bold text-text">تسجيل تواصل</h3>
          <div className="flex gap-1.5 flex-wrap">
            {CONTACT_TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => setContactType(t.key)}
                className={`text-[10px] px-2 py-1 rounded-lg font-semibold border ${
                  contactType === t.key ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <textarea
            value={contactNotes}
            onChange={(e) => setContactNotes(e.target.value)}
            className="w-full border border-border rounded-lg p-2 text-sm bg-white"
            rows={2}
            placeholder="ملاحظات التواصل..."
          />
          <button onClick={handleLogContact} disabled={busy} className="bg-emerald-600 text-white text-xs px-4 py-1.5 rounded-lg font-semibold disabled:opacity-50">
            تسجيل التواصل
          </button>
        </div>
      )}

      {/* History */}
      {history && (
        <div className="bg-white rounded-lg border border-border p-4 space-y-3">
          <h3 className="text-sm font-bold text-text">سجل العميل</h3>

          {history.contacts.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold text-text-muted mb-1.5">التواصل</h4>
              <div className="space-y-1.5">
                {history.contacts.map((c) => (
                  <div key={c.id} className="bg-neutral-50 rounded-lg p-2 text-xs">
                    <div className="flex justify-between text-text-secondary">
                      <span>{c.employee_name || 'موظف'}</span>
                      <span>{new Date(c.contact_at).toLocaleString('ar-EG-u-nu-latn')}</span>
                    </div>
                    {c.notes && <div className="text-text mt-0.5">{c.notes}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {history.followups.length > 0 && (
            <div>
              <h4 className="text-[11px] font-semibold text-text-muted mb-1.5">المتابعات السابقة</h4>
              <div className="space-y-1.5">
                {history.followups.map((f) => (
                  <div key={f.id} className="bg-neutral-50 rounded-lg p-2 text-xs">
                    <div className="flex justify-between">
                      <span className="font-semibold text-text">{f.title}</span>
                      <span className="text-text-muted">{FOLLOW_UP_STATUS_LABELS[f.status] || f.status}</span>
                    </div>
                    {f.result && <div className="text-emerald-700 mt-0.5">النتيجة: {f.result}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}