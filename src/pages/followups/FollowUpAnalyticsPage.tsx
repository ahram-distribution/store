import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { followUpService, type FollowUp } from '../../services/followUpService'
import { FollowUpCard } from '../../components/followups/FollowUpCard'
import { exportToExcel } from '../../services/excelExporter'
import { exportToWord } from '../../services/wordExporter'
import { supabase } from '../../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface Suggestion {
  kind: 'overdue' | 'due_soon' | 'no_contact'
  title: string
  detail: string
  followUp?: FollowUp
}

interface SmartSuggestion {
  kind: string
  title: string
  reason: string
  suggested_at: string | null
  suggested_interval_days: number | null
}

interface SmartCustomer {
  customer_id: string
  customer_name: string
  suggestions: SmartSuggestion[]
}

export function FollowUpAnalyticsPage() {
  const navigate = useNavigate()
  const token = getToken()
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [loading, setLoading] = useState(true)
  const [smart, setSmart] = useState<SmartCustomer[]>([])
  const [smartLoading, setSmartLoading] = useState(false)

  useEffect(() => {
    if (!token) { setLoading(false); return }
    const load = async () => {
      setLoading(true)
      try {
        setFollowUps(await followUpService.getQueue())
      } catch { setFollowUps([]) }
      setLoading(false)
    }
    load()
  }, [token])

  useEffect(() => {
    if (!token || loading || followUps.length === 0) { setSmart([]); return }
    const nameById = new Map<string, string>()
    followUps.forEach((f) => {
      if (f.customer_id && !nameById.has(f.customer_id) && f.customer_name) nameById.set(f.customer_id, f.customer_name)
    })
    const ids = Array.from(nameById.keys()).slice(0, 12)
    if (ids.length === 0) { setSmart([]); return }
    let cancelled = false
    setSmartLoading(true)
    Promise.all(ids.map((id) =>
      supabase
        .rpc('get_smart_follow_up_suggestions', { p_token: token, p_customer_id: id })
        .then(({ data }) => {
          if (data && data.customer_id && Array.isArray(data.suggestions)) {
            return { customer_id: data.customer_id, customer_name: nameById.get(id) || '', suggestions: data.suggestions as SmartSuggestion[] }
          }
          return null
        })
    )).then((rows) => {
      if (cancelled) return
      setSmart(rows.filter((r): r is SmartCustomer => r !== null))
      setSmartLoading(false)
    }).catch(() => {
      if (!cancelled) { setSmart([]); setSmartLoading(false) }
    })
    return () => { cancelled = true }
  }, [token, loading, followUps])

  const suggestions = useMemo<Suggestion[]>(() => {
    const now = new Date()
    const list: Suggestion[] = []

    const open = followUps.filter((f) => f.status === 'open' || f.status === 'in_progress')

    const overdue = open.filter((f) => f.due_at && new Date(f.due_at) < now)
    overdue.forEach((f) => list.push({
      kind: 'overdue',
      title: 'متابعة متأخرة',
      detail: `${f.customer_name || 'عميل'} — ${f.title}`,
      followUp: f,
    }))

    const soon = open.filter((f) => {
      if (!f.due_at) return false
      const diff = new Date(f.due_at).getTime() - now.getTime()
      return diff > 0 && diff <= 24 * 60 * 60 * 1000
    })
    soon.forEach((f) => list.push({
      kind: 'due_soon',
      title: 'متابعة قريبة خلال 24 ساعة',
      detail: `${f.customer_name || 'عميل'} — ${f.title}`,
      followUp: f,
    }))

    open.filter((f) => !f.due_at).forEach((f) => list.push({
      kind: 'no_contact',
      title: 'متابعة بدون موعد',
      detail: `${f.customer_name || 'عميل'} — ${f.title}`,
      followUp: f,
    }))

    return list
  }, [followUps])

  const stats = useMemo(() => ({
    open: followUps.filter((f) => f.status === 'open' || f.status === 'in_progress').length,
    completed: followUps.filter((f) => f.status === 'completed').length,
    overdue: suggestions.filter((s) => s.kind === 'overdue').length,
    total: followUps.length,
  }), [followUps, suggestions])

  const handleExportExcel = () => {
    if (!followUps.length) return
    const data = followUps.map((f) => ({
      customer: f.customer_name || '—',
      phone: f.customer_phone || '—',
      title: f.title,
      priority: f.priority,
      status: f.status,
      assignee: f.assignee_name || '—',
      due_at: f.due_at ? new Date(f.due_at).toLocaleString('ar-EG-u-nu-latn') : '—',
      result: f.result || '—',
      created_at: new Date(f.created_at).toLocaleString('ar-EG-u-nu-latn'),
    }))
    exportToExcel({
      title: 'تقرير متابعة العملاء',
      columns: [
        { key: 'customer', label: 'العميل' },
        { key: 'phone', label: 'الهاتف' },
        { key: 'title', label: 'المتابعة' },
        { key: 'priority', label: 'الأولوية' },
        { key: 'status', label: 'الحالة' },
        { key: 'assignee', label: 'المسؤول' },
        { key: 'due_at', label: 'الموعد' },
        { key: 'result', label: 'النتيجة' },
        { key: 'created_at', label: 'تاريخ الإنشاء' },
      ],
      data,
      fileName: 'تقرير_متابعة_العملاء',
      presentation: { rtl: true, landscape: true, fitToWidth: true },
    })
  }

  const handleExportWord = () => {
    if (!followUps.length) return
    const rows = followUps.map((f) => ({
      customer: f.customer_name || '—',
      title: f.title,
      priority: f.priority,
      status: f.status,
      assignee: f.assignee_name || '—',
      due: f.due_at ? new Date(f.due_at).toLocaleString('ar-EG-u-nu-latn') : '—',
    }))
    exportToWord({
      title: 'تقرير متابعة العملاء',
      subtitle: 'صادر عن نظام الأهرام',
      columns: [
        { key: 'customer', label: 'العميل' },
        { key: 'title', label: 'المتابعة' },
        { key: 'priority', label: 'الأولوية' },
        { key: 'status', label: 'الحالة' },
        { key: 'assignee', label: 'المسؤول' },
        { key: 'due', label: 'الموعد' },
      ],
      rows,
      fileName: 'تقرير_متابعة_العملاء_Word',
      summary: [
        { label: 'إجمالي المتابعات', value: String(stats.total) },
        { label: 'مفتوحة', value: String(stats.open) },
        { label: 'مكتملة', value: String(stats.completed) },
        { label: 'متأخرة', value: String(stats.overdue) },
      ],
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/followups')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تحليل العملاء والمقترحات</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-white rounded-lg border border-border p-3 text-center">
          <div className="text-2xl font-bold text-text" dir="ltr">{stats.open}</div>
          <div className="text-[11px] text-text-muted">مفتوحة</div>
        </div>
        <div className="bg-white rounded-lg border border-border p-3 text-center">
          <div className="text-2xl font-bold text-emerald-600" dir="ltr">{stats.completed}</div>
          <div className="text-[11px] text-text-muted">مكتملة</div>
        </div>
        <div className="bg-white rounded-lg border border-border p-3 text-center">
          <div className="text-2xl font-bold text-danger" dir="ltr">{stats.overdue}</div>
          <div className="text-[11px] text-text-muted">متأخرة</div>
        </div>
        <div className="bg-white rounded-lg border border-border p-3 text-center">
          <div className="text-2xl font-bold text-primary" dir="ltr">{stats.total}</div>
          <div className="text-[11px] text-text-muted">الإجمالي</div>
        </div>
      </div>

      {!loading && followUps.length > 0 && (
        <div className="flex gap-1.5">
          <button onClick={handleExportExcel} className="bg-white border border-border rounded-lg text-[11px] px-2.5 py-1.5 font-semibold text-text hover:bg-neutral-50">📊 Excel</button>
          <button onClick={handleExportWord} className="bg-white border border-border rounded-lg text-[11px] px-2.5 py-1.5 font-semibold text-text hover:bg-neutral-50">📄 Word</button>
        </div>
      )}

      <div className="bg-white rounded-lg border border-border p-3">
        <h2 className="text-sm font-bold text-text mb-2">المقترحات الذكية</h2>
        {loading ? (
          <div className="text-center py-6 text-text-secondary text-sm">جاري التحميل...</div>
        ) : suggestions.length === 0 ? (
          <div className="text-center py-6 text-text-secondary text-xs">لا توجد مقترحات حالياً</div>
        ) : (
          <div className="space-y-2">
            {suggestions.map((s, i) => {
              const color = s.kind === 'overdue' ? 'text-danger' : s.kind === 'due_soon' ? 'text-amber-600' : 'text-primary'
              const icon = s.kind === 'overdue' ? '⚠️' : s.kind === 'due_soon' ? '⏰' : '📌'
              return (
                <div key={i} className="flex items-center gap-2 bg-surface rounded-lg p-2.5 text-xs">
                  <span className={color}>{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`font-semibold ${color}`}>{s.title}</div>
                    <div className="text-text-secondary truncate">{s.detail}</div>
                  </div>
                  {s.followUp?.customer_id && (
                    <button onClick={() => navigate(`/customers/${s.followUp?.customer_id}`)} className="text-[10px] text-primary font-semibold shrink-0 bg-primary/10 px-2 py-1 rounded-lg">العميل</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {!loading && (
        <div className="bg-white rounded-lg border border-border p-3">
          <h2 className="text-sm font-bold text-text mb-2">اقتراحات مبنية على بيانات العميل</h2>
          {smartLoading ? (
            <div className="text-center py-6 text-text-secondary text-sm">جاري التحميل...</div>
          ) : smart.length === 0 ? (
            <div className="text-center py-6 text-text-secondary text-xs">لا توجد اقتراحات كافية حالياً</div>
          ) : (
            <div className="space-y-2">
              {smart.map((s) => (
                <div key={s.customer_id} className="bg-surface rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-bold text-text">{s.customer_name || 'عميل'}</div>
                    <button onClick={() => navigate(`/followups/new/${s.customer_id}`)} className="text-[10px] text-primary font-semibold shrink-0 bg-primary/10 px-2 py-1 rounded-lg">متابعة</button>
                  </div>
                  <div className="space-y-2">
                    {s.suggestions.map((sg, i) => (
                      <div key={i} className="text-[11px] text-text-secondary leading-relaxed">
                        <span className="font-semibold text-text">{sg.title}</span>
                        {sg.suggested_at && <span className="text-primary"> — 📅 {new Date(sg.suggested_at).toLocaleDateString('ar-EG-u-nu-latn')}</span>}
                        <div className="text-[10px] text-text-muted">{sg.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && followUps.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-text mb-2">كل المتابعات</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {followUps.map((f) => <FollowUpCard key={f.id} followUp={f} />)}
          </div>
        </div>
      )}
    </div>
  )
}