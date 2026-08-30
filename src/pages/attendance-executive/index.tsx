import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ATTENDANCE_OPTIONS, CONNECTION_OPTIONS, PERIOD_PRESETS, SHOWN_OPTIONS, SORT_OPTIONS, WORK_TYPE_OPTIONS,
  execPeriodRange, executiveService, exportExecutiveExcel, exportExecutivePdf,
} from '../../services/executiveFollowup'
import type {
  ExecAttendanceFilter, ExecConnectionFilter, ExecEmployeeRow,
  ExecFollowupResponse, ExecOverviewKpis, ExecPeriodPreset, ExecPolicy,
  ExecShownFilter, ExecWorkTypeFilter,
} from '../../types/executiveFollowup'
import { ExecutiveKpiBand } from './ExecutiveKpiBand'
import { ExecutiveEmployeeTable } from './ExecutiveEmployeeTable'
import { ExecutiveControlSettings } from './ExecutiveControlSettings'
import { cairoDateComponents } from '../../lib/dateRange'
import { fmtNum, fmtTime } from './executiveFormat'

const PRESET_LABEL: Record<ExecPeriodPreset, string> = {
  today: 'اليوم', yesterday: 'أمس', current_week: 'الأسبوع الحالي',
  prev_week: 'الأسبوع الماضي', current_month: 'الشهر الحالي', prev_month: 'الشهر الماضي', custom: 'مخصص',
}

export default function ExecutiveAttendancePage() {
  const navigate = useNavigate()
  const [preset, setPreset] = useState<ExecPeriodPreset>('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [includeInactive, setIncludeInactive] = useState(true)

  const [search, setSearch] = useState('')
  const [connection, setConnection] = useState<ExecConnectionFilter>('')
  const [attendance, setAttendance] = useState<ExecAttendanceFilter>('')
  const [workType, setWorkType] = useState<ExecWorkTypeFilter>('')
  const [shown, setShown] = useState<ExecShownFilter>('included')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)

  const range = useMemo(() => execPeriodRange(preset, customFrom || undefined, customTo || undefined), [preset, customFrom, customTo])
  const [cy, cm, cd] = cairoDateComponents(new Date())
  const todayStr = `${cy}-${String(cm).padStart(2, '0')}-${String(cd).padStart(2, '0')}`
  const liveMode = range.from <= todayStr && range.to >= todayStr

  const [data, setData] = useState<ExecFollowupResponse | null>(null)
  const [kpis, setKpis] = useState<ExecOverviewKpis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [showExports, setShowExports] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [policy, setPolicy] = useState<ExecPolicy | null>(null)
  const [showPolicy, setShowPolicy] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'policy' | 'control'>('policy')
  const [policyMinutes, setPolicyMinutes] = useState(60)
  const [policySaving, setPolicySaving] = useState(false)
  const [policyMsg, setPolicyMsg] = useState<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (silent = false) => {
    setError(null)
    if (!silent) setLoading(true)
    try {
      const [list, k] = await Promise.all([
        executiveService.getFollowupList({
          from: range.from, to: range.to, includeInactive,
          search: search || undefined, connection: connection || undefined,
          attendance: attendance || undefined, workType: workType || undefined,
          shown: shown || undefined, page, pageSize, sort,
        }),
        executiveService.getKpis(range.from, range.to, includeInactive),
      ])
      if (list.error) { setError(list.error); return }
      setData(list)
      setKpis(k)
      setLastUpdated(new Date())
      if (k.error === 'FORBIDDEN') setError('ليست لديك صلاحية الوصول لهذه الشاشة.')
    } catch (e: any) {
      if (String(e?.message || e).includes('FORBIDDEN')) setError('ليست لديك صلاحية الوصول لهذه الشاشة.')
      else setError(String(e?.message || e) || 'خطأ في تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to, includeInactive, search, connection, attendance, workType, shown, page, pageSize, sort])

  const debouncedSearch = useCallback(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setPage(0); void load(true) }, 350)
  }, [load, search])

  useEffect(() => {
    void load()
  }, [range.from, range.to, includeInactive, connection, attendance, workType, shown, pageSize, sort, page])

  useEffect(() => {
    debouncedSearch()
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [search])

  useEffect(() => {
    if (!liveMode) return
    const id = setInterval(() => { void load(true) }, 60000)
    return () => clearInterval(id)
  }, [liveMode, load])

  useEffect(() => {
    executiveService.getPolicy().then((p) => { setPolicy(p); setPolicyMinutes(p.inactivity_timeout_minutes) }).catch(() => undefined)
  }, [])

  const applyPreset = (p: ExecPeriodPreset) => {
    setPreset(p)
    setPage(0)
    if (p !== 'custom') { setCustomFrom(''); setCustomTo('') }
  }

  const toggleColFilter = (n: ExecConnectionFilter | ExecAttendanceFilter, type: 'connection' | 'attendance') => {
    setPage(0)
    if (type === 'connection') setConnection((c) => (c === n ? '' : n as ExecConnectionFilter))
    else setAttendance((a) => (a === n ? '' : n as ExecAttendanceFilter))
  }

  const savePolicy = async () => {
    setPolicySaving(true)
    setPolicyMsg(null)
    try {
      if (policyMinutes < 5 || policyMinutes > 1440) { setPolicyMsg('القيمة يجب أن تكون بين 5 و 1440 دقيقة.'); return }
      const res = await executiveService.setPolicy(policyMinutes)
      setPolicyMsg(`تم الحفظ: ${fmtNum(res.old_value)} ← ${fmtNum(res.new_value)} دقيقة (${new Date(res.changed_at).toLocaleString('ar-EG-u-nu-latn')}).`)
      setPolicy((p) => p ? { ...p, inactivity_timeout_minutes: res.new_value } : p)
      void load(true)
    } catch (e: any) {
      setPolicyMsg(String(e?.message || e))
    } finally {
      setPolicySaving(false)
    }
  }

  const doExport = async (type: 'excel' | 'pdf') => {
    setExporting(true)
    setShowExports(false)
    try {
      const rows = await executiveService.getAllForExport({
        from: range.from, to: range.to, includeInactive,
        search: search || undefined, connection: connection || undefined,
        attendance: attendance || undefined, sort,
      })
      const filters = [
        `الفترة: ${PRESET_LABEL[preset]} (${range.from} ← ${range.to})`,
        `بما فيهم غير النشطين: ${includeInactive ? 'نعم' : 'لا'}`,
        connection ? `حالة الاتصال: ${CONNECTION_OPTIONS.find((c) => c.key === connection)?.label}` : null,
        attendance ? `فئة الحضور: ${ATTENDANCE_OPTIONS.find((a) => a.key === attendance)?.label}` : null,
        workType ? `نوع العمل: ${WORK_TYPE_OPTIONS.find((w) => w.key === workType)?.label}` : null,
        shown ? `النطاق: ${SHOWN_OPTIONS.find((s) => s.key === shown)?.label}` : null,
        search ? `بحث: ${search}` : null,
      ].filter(Boolean) as string[]
      if (type === 'excel') {
        exportExecutiveExcel({ presetLabel: PRESET_LABEL[preset], from: range.from, to: range.to, filters, kpis, employees: rows, policy })
      } else {
        const byDate: Record<string, Array<{ date: string; name: string; net_minutes: number | null; status: string | null }>> = {}
        rows.forEach((r) => { const d = r.live && (range.from === range.to) ? range.from : undefined; if (d) { (byDate[d] = byDate[d] || []).push({ date: d, name: r.name, net_minutes: r.live?.net_minutes ?? null, status: r.live?.status ?? null }) } })
        exportExecutivePdf({ presetLabel: PRESET_LABEL[preset], from: range.from, to: range.to, filters, kpis, employees: rows, byDate })
      }
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-br from-blue-900 via-indigo-800 to-blue-950 rounded-2xl p-5 shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-extrabold text-white flex items-center gap-2">🛰️ الحضور والمتابعة</h1>
            <p className="text-[11px] text-blue-100 mt-1">نطاق: القوى العاملة التي تحددها الإدارة العليا. الإدارة العليا والرئيس التنفيذي خارج الحضور والمتابعة، والمشرف التنفيذي يُشمل فقط عند اختياره ضمن القوى العاملة.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {lastUpdated && <span className="text-[10px] text-blue-200 bg-white/10 rounded-lg px-2 py-1">آخر تحديث: {fmtTime(lastUpdated.toISOString())}</span>}
            <button onClick={() => void load()} disabled={loading} className="text-[11px] font-bold bg-white/15 hover:bg-white/25 text-white rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors">
              {loading ? 'جاري التحديث...' : 'تحديث ⟳'}
            </button>
            <div className="relative">
              <button onClick={() => setShowExports((v) => !v)} disabled={exporting} className="text-[11px] font-bold bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors">
                {exporting ? 'جارٍ التصدير...' : 'تصدير ⬇'}
              </button>
              {showExports && (
                <div className="absolute z-30 left-0 top-9 mt-1 bg-white border border-border rounded-xl shadow-xl overflow-hidden w-44">
                  <button onClick={() => void doExport('excel')} className="w-full text-right px-3 py-2.5 text-[11px] font-bold text-text hover:bg-surface border-b border-border">تصدير Excel (عدة أوراق)</button>
                  <button onClick={() => void doExport('pdf')} className="w-full text-right px-3 py-2.5 text-[11px] font-bold text-text hover:bg-surface">تصدير PDF</button>
                </div>
              )}
            </div>
            <button onClick={() => { setPolicyMsg(null); setSettingsTab('policy'); setShowPolicy(true) }} className="text-[11px] font-bold bg-white/10 hover:bg-white/20 text-blue-50 rounded-lg px-3 py-1.5 transition-colors">⚙️ السياسة والإعدادات</button>
          </div>
        </div>

        {/* Period control */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 flex-wrap">
            {PERIOD_PRESETS.map((p) => (
              <button key={p.key} onClick={() => applyPreset(p.key)}
                className={`text-[11px] font-bold rounded-lg px-2.5 py-1.5 transition-colors ${preset === p.key ? 'bg-white text-blue-900 shadow' : 'bg-white/10 text-blue-100 hover:bg-white/20'}`}>
                {p.label}
              </button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="text-[11px] rounded-lg border border-white/25 bg-white/10 text-white px-2 py-1.5 [color-scheme:dark]" />
              <span className="text-[10px] text-blue-200">←</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="text-[11px] rounded-lg border border-white/25 bg-white/10 text-white px-2 py-1.5 [color-scheme:dark]" />
            </div>
          )}
          <span className="text-[11px] font-bold text-blue-100 bg-white/10 rounded-lg px-2.5 py-1.5">{range.from} ← {range.to}</span>
          {liveMode && <span className="text-[10px] font-bold text-emerald-200 bg-emerald-500/15 rounded-lg px-2 py-1 animate-pulse">● وضع مباشر (يتحدث كل دقيقة)</span>}
          {!liveMode && <span className="text-[10px] text-blue-200">وضع تاريخي</span>}
          <label className="flex items-center gap-1.5 text-[10px] text-blue-100 cursor-pointer mr-auto">
            <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} className="accent-white" />
            إظهار الموظفين غير النشطين
          </label>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl p-3">{error}</div>
      )}

      {/* KPI band */}
      <ExecutiveKpiBand kpis={kpis} loading={loading} />

      {/* Filters + table */}
      <div className="space-y-3">
        <div className="bg-white rounded-xl border border-border p-3 flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو الكود..."
            className="flex-1 min-w-[160px] text-xs rounded-xl border border-border bg-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
          />
          <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0) }} className="text-[11px] rounded-xl border border-border bg-white px-2 py-2">
            {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>ترتيب: {o.label}</option>)}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold text-text-secondary px-1">الاتصال:</span>
          {CONNECTION_OPTIONS.map((c) => (
            <Chip key={c.key} active={connection === c.key} onClick={() => toggleColFilter(c.key, 'connection')}>{c.label}</Chip>
          ))}
          <span className="text-[10px] font-bold text-text-secondary px-1 mr-3">الحضور:</span>
          {ATTENDANCE_OPTIONS.map((a) => (
            <Chip key={a.key} active={attendance === a.key} onClick={() => toggleColFilter(a.key, 'attendance')}>{a.label}</Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold text-text-secondary px-1">نوع العمل:</span>
          {WORK_TYPE_OPTIONS.map((w) => (
            <Chip key={w.key} active={workType === w.key} onClick={() => { setWorkType(w.key as ExecWorkTypeFilter); setPage(0) }}>{w.label}</Chip>
          ))}
          <span className="text-[10px] font-bold text-text-secondary px-1 mr-3">نطاق المتابعة:</span>
          {SHOWN_OPTIONS.map((s) => (
            <Chip key={s.key} active={shown === s.key} onClick={() => { setShown(s.key as ExecShownFilter); setPage(0) }}>{s.label}</Chip>
          ))}
          {shown === 'included' && <span className="text-[10px] text-text-secondary">(الافتراضي: مشمول فقط)</span>}
        </div>

        <ExecutiveEmployeeTable
          employees={data?.employees || []}
          total={data?.total ?? 0}
          loading={loading}
          page={page}
          pageSize={pageSize}
          sort={sort}
          onSort={setSort}
          onPage={setPage}
          onPageSize={setPageSize}
          onRowClick={(employee) => navigate(`/attendance/executive/employee/${employee.employee_id}?from=${range.from}&to=${range.to}&live=${liveMode ? '1' : '0'}`, { state: { employee } })}
        />
      </div>

      {/* Settings modal */}
      {showPolicy && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowPolicy(false)}>
          <div className={`bg-white rounded-2xl w-full p-5 space-y-4 ${settingsTab === 'control' ? 'max-w-3xl' : 'max-w-md'}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-text">⚙️ السياسة والإعدادات</h3>
              <button onClick={() => setShowPolicy(false)} className="text-text-secondary hover:text-text">✕</button>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
              <button
                onClick={() => setSettingsTab('policy')}
                className={`flex-1 text-[11px] font-bold rounded-lg px-3 py-1.5 transition-colors ${settingsTab === 'policy' ? 'bg-white shadow text-text' : 'text-text-secondary hover:text-text'}`}
              >
                الإغلاق التلقائي
              </button>
              <button
                onClick={() => setSettingsTab('control')}
                className={`flex-1 text-[11px] font-bold rounded-lg px-3 py-1.5 transition-colors ${settingsTab === 'control' ? 'bg-white shadow text-text' : 'text-text-secondary hover:text-text'}`}
              >
                إعداد القوى العاملة (النطاق ونظام العمل)
              </button>
            </div>

            {settingsTab === 'policy' && (
              <>
                <div className="bg-blue-50 border border-blue-200 text-blue-800 text-[11px] rounded-xl p-3">
                  تُطبَّق هذه القيمة على مطبِّقي الإغلاق التلقائي (فحص الجلسات والدفعة الليلية). الافتراضي 60 دقيقة — القيمة الحالية: <b>{policy ? fmtNum(policy.inactivity_timeout_minutes) : '—'}</b> دقيقة. كل تغيير يُسجَّل في سجل التدقيق.
                </div>
                <div>
                  <label className="text-[11px] font-bold text-text block mb-1">مهلة عدم النشاط (بالدقائق، 5–1440)</label>
                  <input
                    type="number" min={5} max={1440} value={policyMinutes}
                    onChange={(e) => setPolicyMinutes(Number(e.target.value))}
                    className="w-full text-xs rounded-xl border border-border bg-surface px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                {policyMsg && (
                  <div className="text-[11px] rounded-xl p-3 bg-emerald-50 border border-emerald-200 text-emerald-700">{policyMsg}</div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => void savePolicy()} disabled={policySaving} className="flex-1 text-[12px] font-bold bg-gradient-to-l from-blue-600 to-indigo-700 text-white rounded-xl py-2.5 disabled:opacity-40">
                    {policySaving ? 'جاري الحفظ...' : 'حفظ'}
                  </button>
                  <button onClick={() => setShowPolicy(false)} className="px-4 text-[12px] font-bold text-text-secondary bg-gray-100 rounded-xl py-2.5">إغلاق</button>
                </div>
              </>
            )}

            {settingsTab === 'control' && <ExecutiveControlSettings onChanged={() => void load(true)} />}
          </div>
        </div>
      )}

    </div>
  )
}

function Chip({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] font-bold rounded-full px-2.5 py-1.5 border transition-colors ${active ? 'bg-blue-700 text-white border-blue-700 shadow' : 'bg-white text-text-secondary border-border hover:border-blue-300'}`}
    >
      {children}
    </button>
  )
}
