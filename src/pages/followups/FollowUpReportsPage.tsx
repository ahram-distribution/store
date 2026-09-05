import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { followUpWorkspaceService, type ReportRow } from '../../services/followUpWorkspaceService'
import { exportToExcel } from '../../services/excelExporter'
import { exportToWord } from '../../services/wordExporter'

const STATUS_LABELS: Record<string, string> = {
  open: 'مفتوحة', in_progress: 'جارية', completed: 'مكتملة', cancelled: 'ملغية',
}

const TODAY = new Date()
const MONTH_AGO = new Date()
MONTH_AGO.setDate(MONTH_AGO.getDate() - 30)

const TABS = [
  { key: 'followups', label: 'المتابعات' },
  { key: 'contacts', label: 'التواصل' },
  { key: 'updates', label: 'تحديثات البيانات' },
] as const
type TabKey = typeof TABS[number]['key']

function fmtDate(v: unknown): string {
  if (!v) return '—'
  try { return new Date(String(v)).toLocaleDateString('ar-EG-u-nu-latn') } catch { return '—' }
}

export function FollowUpReportsPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabKey>('followups')
  const [rows, setRows] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(true)
  const [status, setStatus] = useState('')
  const [result, setResult] = useState('')
  const [dateFrom, setDateFrom] = useState(MONTH_AGO.toISOString().slice(0, 10))
  const [dateTo, setDateTo] = useState(TODAY.toISOString().slice(0, 10))

  const clearFilters = () => { setStatus(''); setResult(''); setDateFrom(''); setDateTo('') }

  const load = useCallback(async (t: TabKey) => {
    setLoading(true)
    try {
      const base = { dateFrom: dateFrom || null, dateTo: dateTo || null, limit: 1000 }
      if (t === 'followups') {
        const r = await followUpWorkspaceService.getFollowUpReport({ ...base, status: status || null })
        if (r.available) { setRows(r.data); setReady(true) } else { setRows([]); setReady(false) }
      } else if (t === 'contacts') {
        const r = await followUpWorkspaceService.getContactsReport({ ...base, result: result || null })
        if (r.available) { setRows(r.data); setReady(true) } else { setRows([]); setReady(false) }
      } else {
        const r = await followUpWorkspaceService.getCustomerUpdatesReport(base)
        if (r.available) { setRows(r.data); setReady(true) } else { setRows([]); setReady(false) }
      }
    } catch {
      setRows([]); setReady(false)
    }
    setLoading(false)
  }, [status, result, dateFrom, dateTo])

  useEffect(() => { load(tab) }, [tab, load])

  const switchTab = (t: TabKey) => {
    clearFilters(); setTab(t)
  }

  const cols: Array<{ key: string; label: string }> = tab === 'followups'
    ? [
        { key: 'customer', label: 'العميل' },
        { key: 'phone', label: 'الهاتف' },
        { key: 'title', label: 'المتابعة' },
        { key: 'priority', label: 'الأولوية' },
        { key: 'statusLabel', label: 'الحالة' },
        { key: 'assignee', label: 'المسؤول' },
        { key: 'dueLabel', label: 'الموعد' },
        { key: 'result', label: 'النتيجة' },
        { key: 'createdLabel', label: 'تاريخ الإنشاء' },
      ]
    : tab === 'contacts'
      ? [
          { key: 'customer', label: 'العميل' },
          { key: 'phone', label: 'الهاتف' },
          { key: 'methodLabel', label: 'الطريقة' },
          { key: 'reason', label: 'السبب' },
          { key: 'result', label: 'النتيجة' },
          { key: 'next_action', label: 'الإجراء التالي' },
          { key: 'next_follow_up_date', label: 'المتابعة القادمة' },
          { key: 'order_created_label', label: 'تم إنشاء طلب' },
          { key: 'employee', label: 'الموظف' },
          { key: 'dateLabel', label: 'تاريخ التواصل' },
          { key: 'notes', label: 'الملاحظات' },
        ]
      : [
          { key: 'customer', label: 'العميل' },
          { key: 'action_type', label: 'الإجراء' },
          { key: 'field', label: 'الحقل' },
          { key: 'old_value', label: 'قبل' },
          { key: 'new_value', label: 'بعد' },
          { key: 'employee', label: 'بواسطة' },
          { key: 'createdLabel', label: 'التاريخ' },
        ]

  const METHOD_LABELS: Record<string, string> = {
    call: 'اتصال', visit: 'زيارة', meeting: 'اجتماع', email: 'بريد', sms: 'رسالة', live_chat: 'محادثة', other: 'أخرى',
  }

  const reportData = (raw: ReportRow[]) => raw.map((r) => {
    const b = { ...r }
    if (tab === 'followups') {
      b.statusLabel = STATUS_LABELS[String(r.status || '')] || String(r.status || '—')
      b.dueLabel = fmtDate(r.due_at)
      b.createdLabel = fmtDate(r.created_at)
    } else if (tab === 'contacts') {
      b.methodLabel = METHOD_LABELS[String(r.method || '')] || String(r.method || '—')
      b.next_follow_up_date = fmtDate(r.next_follow_up_at)
      b.order_created_label = r.order_created ? 'نعم' : 'لا'
      b.dateLabel = fmtDate(r.contact_at)
    } else {
      b.createdLabel = fmtDate(r.created_at)
    }
    return b
  })

  const handleExcel = () => {
    if (!rows.length) return
    const data = reportData(rows)
    exportToExcel({
      title: tab === 'followups' ? 'تقرير متابعة العملاء' : tab === 'contacts' ? 'تقرير التواصل مع العملاء' : 'تقرير تحديثات بيانات العملاء',
      subtitle: 'مرجع المتابعة التشغيلي — نظام الأهرام',
      columns: cols,
      data,
      fileName: tab === 'followups' ? 'تقرير_المتابعات' : tab === 'contacts' ? 'تقرير_التواصل' : 'تقرير_تحديثات_البيانات',
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      presentation: { rtl: true, landscape: true, fitToWidth: true },
    })
  }

  const handleWord = () => {
    if (!rows.length) return
    const data = reportData(rows)
    const wcols = cols.map((c) => ({ key: c.key, label: c.label }))
    exportToWord({
      title: tab === 'followups' ? 'تقرير متابعة العملاء' : tab === 'contacts' ? 'تقرير التواصل مع العملاء' : 'تقرير تحديثات بيانات العملاء',
      subtitle: 'مرجع المتابعة التشغيلي — نظام الأهرام',
      columns: wcols,
      rows: data,
      fileName: tab === 'followups' ? 'تقرير_المتابعات_Word' : tab === 'contacts' ? 'تقرير_التواصل_Word' : 'تقرير_تحديثات_البيانات_Word',
      summary: [
        { label: 'عدد السجلات', value: String(data.length) },
        { label: 'الفترة', value: dateFrom && dateTo ? `${dateFrom} — ${dateTo}` : 'كل الفترات' },
      ],
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/followups')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">تقارير متابعة العملاء</h1>
      </div>

      {!ready && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-[11px] text-amber-700 leading-relaxed">
          التقارير التفصيلية غير متاحة حالياً — تُطبّق مع تحديث قاعدة البيانات 0023 (صلاحية تقارير المتابعة وتصدير Excel/Word).
        </div>
      )}

      <div className="flex gap-1 bg-white rounded-lg border border-border p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            className={`flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ${
              tab === t.key ? 'bg-primary text-white' : 'text-text-secondary hover:bg-neutral-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-border p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tab !== 'updates' && (
          <label className="block">
            <span className="text-[10px] text-text-secondary">{tab === 'followups' ? 'الحالة' : 'النتيجة'}</span>
            <select value={tab === 'followups' ? status : result} onChange={(e) => tab === 'followups' ? setStatus(e.target.value) : setResult(e.target.value)} className="mt-0.5 w-full bg-surface rounded-lg px-2 py-2 text-[11px] border border-border">
              <option value="">الكل</option>
              {tab === 'followups'
                ? Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)
                : ['تم التواصل', 'مهتم', 'تم إنشاء طلب', 'متابعة لاحقة', 'لا يحتاج حاليًا', 'رفض', 'لا يرد', 'رقم غير صحيح', 'طلب تحديث بيانات', 'طلب زيارة', 'مشكلة تحتاج تصعيد'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-[10px] text-text-secondary">من تاريخ</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-0.5 w-full bg-surface rounded-lg px-2 py-2 text-[11px] border border-border" />
        </label>
        <label className="block">
          <span className="text-[10px] text-text-secondary">إلى تاريخ</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-0.5 w-full bg-surface rounded-lg px-2 py-2 text-[11px] border border-border" />
        </label>
        <div className="flex items-end gap-1">
          <button onClick={() => load(tab)} className="flex-1 bg-primary text-white text-[11px] py-2 rounded-lg font-semibold">عرض</button>
          <button onClick={clearFilters} className="px-2 py-2 border border-border rounded-lg text-[11px] text-text-secondary">مسح</button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد بيانات في هذه الفترة</div>
      ) : (
        <>
          <div className="flex gap-1.5">
            <button onClick={handleExcel} className="bg-white border border-border rounded-lg text-[11px] px-2.5 py-1.5 font-semibold text-text hover:bg-neutral-50">📊 تصدير Excel</button>
            <button onClick={handleWord} className="bg-white border border-border rounded-lg text-[11px] px-2.5 py-1.5 font-semibold text-text hover:bg-neutral-50">📄 تصدير Word</button>
            <span className="text-[11px] text-text-muted self-center mr-auto">{rows.length} سجل — نسخة تصدير مجانية بدون صلاحية export عند الحاجة</span>
          </div>

          <div className="bg-white rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface text-text text-[10px]">
                  {cols.map((c) => <th key={c.key} className="px-2 py-2 text-right whitespace-nowrap font-bold">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {reportData(rows).map((r, i) => (
                  <tr key={i} className={i % 2 ? 'bg-surface/40' : ''}>
                    {cols.map((c) => (
                      <td key={c.key} className="px-2 py-1.5 text-[11px] text-text-secondary whitespace-nowrap max-w-[200px] truncate">
                        {c.key === 'phone' ? <span dir="ltr">{String(r[c.key] || '—')}</span>
                          : r[c.key] === null || r[c.key] === undefined || r[c.key] === '' ? '—' : String(r[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}