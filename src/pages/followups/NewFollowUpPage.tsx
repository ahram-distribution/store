import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCapability } from '../../hooks/useCapability'
import { supabase } from '../../lib/supabase'
import {
  followUpService,
  type FollowUpPriority,
  type FollowUpAssignee,
} from '../../services/followUpService'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface CustomerOption {
  id: string
  company_name: string
  code: string | null
}

export function NewFollowUpPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = getToken()
  const canManage = useCapability('followups.manage')

  const [customerSearch, setCustomerSearch] = useState(searchParams.get('customerId') ? 'yes' : '')
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([])
  const [customerId, setCustomerId] = useState(searchParams.get('customerId') || '')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<FollowUpPriority>('normal')
  const [dueAt, setDueAt] = useState('')
  const [assignees, setAssignees] = useState<FollowUpAssignee[]>([])
  const [assigneeId, setAssigneeId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    followUpService.getAssignees().then(setAssignees).catch(() => setAssignees([]))
  }, [token])

  useEffect(() => {
    if (!token || customerSearch.length < 1) { setCustomerOptions([]); return }
    const debounce = setTimeout(async () => {
      const { data } = await supabase.rpc('get_governed_customers', { p_token: token, p_search: customerSearch || null })
      if (Array.isArray(data)) setCustomerOptions(data)
    }, 300)
    return () => clearTimeout(debounce)
  }, [customerSearch, token])

  const applyPreset = (kind: '1w' | '2w' | '1m' | '2m') => {
    const d = new Date()
    if (kind === '1w') d.setDate(d.getDate() + 7)
    else if (kind === '2w') d.setDate(d.getDate() + 14)
    else if (kind === '1m') d.setMonth(d.getMonth() + 1)
    else d.setMonth(d.getMonth() + 2)
    setDueAt(toLocalInputValue(d))
  }

  const handleCreate = async () => {
    if (!token) return
    if (!customerId || !title.trim()) {
      setError('اختر العميل واكتب عنوان المتابعة')
      return
    }
    setBusy(true)
    setError('')
    try {
      await followUpService.createFollowUp({
        customerId,
        title: title.trim(),
        description: description || undefined,
        priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        assigneeId: assigneeId || undefined,
      })
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
        <h1 className="text-lg font-bold text-text">متابعة جديدة</h1>
      </div>

      {error && <div className="bg-red-50 text-red-600 text-xs border border-red-100 rounded-lg p-2.5">{error}</div>}

      <div className="bg-white rounded-lg border border-border p-4 space-y-3">
        {/* Customer selector */}
        <div>
          <label className="text-[11px] text-text-muted block mb-1">العميل *</label>
          <input
            value={customerId ? (customerOptions.find((c) => c.id === customerId)?.company_name || '') : customerSearch}
            onChange={(e) => { setCustomerId(''); setCustomerSearch(e.target.value) }}
            className="w-full border border-border rounded-lg p-2 text-sm bg-white"
            placeholder="ابحث عن عميل..."
          />
          {customerId === '' && customerOptions.length > 0 && (
            <div className="mt-1 border border-border rounded-lg overflow-hidden">
              {customerOptions.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setCustomerId(c.id); setCustomerSearch(c.company_name) }}
                  className="w-full text-right px-3 py-2 hover:bg-neutral-50 text-xs text-text flex justify-between"
                >
                  <span>{c.company_name}</span>
                  {c.code && <span className="text-text-muted" dir="ltr">{c.code}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Title */}
        <div>
          <label className="text-[11px] text-text-muted block mb-1">عنوان المتابعة *</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border border-border rounded-lg p-2 text-sm bg-white"
            placeholder="مثال: متابعة عرض الأسعار..."
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-[11px] text-text-muted block mb-1">الوصف</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-border rounded-lg p-2 text-sm bg-white"
            rows={2}
            placeholder="تفاصيل المتابعة..."
          />
        </div>

        {/* Priority */}
        <div>
          <label className="text-[11px] text-text-muted block mb-1">الأولوية</label>
          <div className="flex gap-1.5">
            {(['low', 'normal', 'high', 'critical'] as FollowUpPriority[]).map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className={`text-[10px] px-3 py-1.5 rounded-lg font-semibold border ${
                  priority === p ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'
                }`}
              >
                {{ low: 'منخفضة', normal: 'متوسطة', high: 'عالية', critical: 'حرجة' }[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Due */}
        <div>
          <label className="text-[11px] text-text-muted block mb-1">الموعد</label>
          <div className="flex gap-1.5 mb-1.5 flex-wrap">
            {([['1w', 'أسبوع'], ['2w', 'أسبوعان'], ['1m', 'شهر'], ['2m', 'شهران']] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => applyPreset(k)}
                className="text-[10px] px-3 py-1.5 rounded-lg font-semibold border bg-white text-text-secondary border-border hover:bg-primary/10"
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-full border border-border rounded-lg p-2 text-sm bg-white"
          />
        </div>

        {/* Assignee */}
        {canManage && assignees.length > 0 && (
          <div>
            <label className="text-[11px] text-text-muted block mb-1">المسؤول</label>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="w-full border border-border rounded-lg p-2 text-sm bg-white"
            >
              <option value="">أنا</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>{a.full_name}</option>
              ))}
            </select>
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={busy}
          className="w-full bg-primary text-white text-sm py-2.5 rounded-lg font-semibold disabled:opacity-50"
        >
          {busy ? 'جاري الحفظ...' : 'إنشاء المتابعة'}
        </button>
      </div>
    </div>
  )
}