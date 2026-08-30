import { useCallback, useEffect, useState } from 'react'
import { executiveService } from '../../services/executiveFollowup'
import type {
  ExecControlEmployee,
  ExecControlPolicyResponse,
  ExecControlRoleDefault,
} from '../../types/executiveFollowup'
import { fmtDateTime, fmtNum } from './executiveFormat'

type Tab = 'roles' | 'employees' | 'audit'

function t2s(v: string | null | undefined): string {
  return v ? v.slice(0, 5) : ''
}

interface ToggleRow {
  key: string
  label: string
  value: boolean
  onChange: (v: boolean) => void
}

function Toggles({ rows }: { rows: ToggleRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {rows.map((r) => (
        <label key={r.key} className="flex items-center justify-between bg-gray-50 border border-border rounded-xl px-3 py-2 cursor-pointer">
          <span className="text-[11px] text-text font-bold">{r.label}</span>
          <input type="checkbox" checked={r.value} onChange={(e) => r.onChange(e.target.checked)} className="accent-blue-600" />
        </label>
      ))}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-bold text-text block mb-1">{label}</label>
      {children}
    </div>
  )
}

export function ExecutiveControlSettings({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<ExecControlPolicyResponse | null>(null)
  const [tab, setTab] = useState<Tab>('employees')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await executiveService.getControlPolicy())
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  return (
    <div className="space-y-3">
      <div className="bg-blue-50 border border-blue-200 text-blue-800 text-[11px] rounded-xl p-3">
        إعداد القوى العاملة الخاضعة للحضور والمتابعة: نطاق المتابعة (مشمول/غير مشمول) ونوع العمل (مكتبي/ميداني) لكل دور أو موظف. السياسة الفعّالة = تجاوز فردي ← افتراضي الدور ← النظام الافتراضي. كل تغيير يُسجَّل فوراً في سجل التدقيق.
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-[11px] rounded-xl p-3">{error}</div>}

      {loading && !data ? (
        <div className="text-center py-8 text-xs text-text-secondary">جاري تحميل نظام التحكم...</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <MiniStat label="مشمول بالنطاق" value={fmtNum(data.stats.shown_total)} tone="text-emerald-700" />
            <MiniStat label="غير مشمول" value={fmtNum(data.stats.hidden_total)} tone="text-red-600" />
            <MiniStat label="مكتبي" value={fmtNum(data.stats.fixed)} tone="text-violet-700" />
            <MiniStat label="ميداني" value={fmtNum(data.stats.flexible)} tone="text-amber-600" />
            <MiniStat label="نطاق الحضور" value={fmtNum(data.stats.attendance_monitored)} tone="text-emerald-700" />
            <MiniStat label="نطاق المتابعة" value={fmtNum(data.stats.follow_up_monitored)} tone="text-blue-700" />
            <MiniStat label="أدوار بافتراض" value={fmtNum(data.stats.roles_with_default)} />
            <MiniStat label="تجاوزات فردية" value={fmtNum(data.stats.employee_overrides)} tone={data.stats.employee_overrides ? 'text-blue-700' : undefined} />
          </div>

          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            {([['employees', 'إعداد القوى العاملة'], ['roles', 'افتراضيات الدور'], ['audit', 'سجل التدقيق']] as [Tab, string][]).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`flex-1 text-[11px] font-bold rounded-lg px-3 py-1.5 transition-colors ${tab === k ? 'bg-white shadow text-text' : 'text-text-secondary hover:text-text'}`}
              >
                {l}
              </button>
            ))}
          </div>

          {tab === 'roles' && (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto pl-1">
              <div className="text-[10px] text-text-secondary">افتراضي الدور يُطبَّق على كل موظف ليس له تجاوز فردي. الميداني (flexible) لا تُحسب له تأخير/مبكر أبداً — تُحتسب فقط للمكتبي (fixed) مع تفعيل الحساب.</div>
              {data.role_defaults.map((r) => <RoleEditor key={r.role_id} role={r} onSaved={() => { void reload(); onChanged() }} />)}
            </div>
          )}

          {tab === 'employees' && (
            <WorkforceGrid employees={data.employees} onSaved={() => { void reload(); onChanged() }} />
          )}

          {tab === 'audit' && (
            <AuditList entries={data.audit} />
          )}
        </>
      ) : null}
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-gray-50 border border-border rounded-xl px-2 py-1.5 text-center">
      <div className={`text-sm font-extrabold ${tone || 'text-text'}`}>{value}</div>
      <div className="text-[9px] text-text-secondary">{label}</div>
    </div>
  )
}

function RoleEditor({ role, onSaved }: { role: ExecControlRoleDefault; onSaved: () => void }) {
  const [attendance, setAttendance] = useState(role.attendance_enabled)
  const [followUp, setFollowUp] = useState(role.follow_up_enabled)
  const [late, setLate] = useState(role.late_calculation_enabled)
  const [early, setEarly] = useState(role.early_calculation_enabled)
  const [schedule, setSchedule] = useState<'' | 'fixed' | 'flexible'>(role.schedule_type)
  const [shown, setShown] = useState(role.show_in_screen)
  const [start, setStart] = useState(t2s(role.official_start_time))
  const [end, setEnd] = useState(t2s(role.official_end_time))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const dirty =
    attendance !== role.attendance_enabled ||
    followUp !== role.follow_up_enabled ||
    late !== role.late_calculation_enabled ||
    early !== role.early_calculation_enabled ||
    schedule !== role.schedule_type ||
    shown !== role.show_in_screen ||
    (start || null) !== (t2s(role.official_start_time) || null) ||
    (end || null) !== (t2s(role.official_end_time) || null)

  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const res = await executiveService.setRoleDefault({
        role_id: role.role_id,
        attendance_enabled: attendance,
        follow_up_enabled: followUp,
        schedule_type: schedule || 'fixed',
        late_calculation_enabled: late,
        early_calculation_enabled: early,
        show_in_screen: shown,
        official_start_time: start || null,
        official_end_time: end || null,
        reason: reason.trim() || undefined,
      })
      if (res.error) { setMsg(`خطأ: ${res.error}`); return }
      setMsg(`تم الحفظ — تم تسجيل ${res.audit_rows ?? 0} ضوابط في التدقيق.`)
      setReason('')
      onSaved()
    } catch (e: any) {
      setMsg(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-border rounded-xl p-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div>
          <span className="text-[12px] font-bold text-text">{role.role_name}</span>
          <span className="text-[10px] text-text-secondary mr-2">({fmtNum(role.employee_count)} موظف)</span>
        </div>
        <button
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="text-[11px] font-bold bg-blue-700 hover:bg-blue-800 text-white rounded-lg px-3 py-1 disabled:opacity-30 transition-colors"
        >
          {saving ? 'جاري الحفظ...' : dirty ? 'حفظ التغييرات' : 'محفوظ ✓'}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
        <Toggles rows={[
          { key: 's', label: 'مشمول بالنطاق', value: shown, onChange: setShown },
          { key: 'a', label: 'نطاق الحضور', value: attendance, onChange: setAttendance },
          { key: 'f', label: 'نطاق المتابعة', value: followUp, onChange: setFollowUp },
          { key: 'l', label: 'حساب التأخير', value: late, onChange: setLate },
          { key: 'e', label: 'حساب المبكر', value: early, onChange: setEarly },
        ]} />
        <Field label="نوع العمل">
          <select value={schedule} onChange={(e) => setSchedule(e.target.value as '' | 'fixed' | 'flexible')} className="w-full text-[11px] rounded-xl border border-border bg-white px-2 py-2">
            <option value="fixed">مكتبي (ثابت)</option>
            <option value="flexible">ميداني (مرن)</option>
          </select>
        </Field>
        <Field label="البداية الرسمية">
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-full text-[11px] rounded-xl border border-border bg-white px-2 py-2 [color-scheme:light]" />
        </Field>
        <Field label="النهاية الرسمية">
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full text-[11px] rounded-xl border border-border bg-white px-2 py-2 [color-scheme:light]" />
        </Field>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="سبب التغيير (اختياري) — يُسجَّل في التدقيق"
          className="flex-1 text-[11px] rounded-xl border border-border bg-surface px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
      </div>
      {msg && <div className="mt-1.5 text-[10px] text-emerald-700">{msg}</div>}
    </div>
  )
}

function WorkforceGrid({ employees, onSaved }: { employees: ExecControlEmployee[]; onSaved: () => void }) {
  const [q, setQ] = useState('')
  const filtered = !q.trim() ? employees : employees.filter((e) =>
    e.name.includes(q.trim()) || e.code.includes(q.trim()) || (e.role_name || '').includes(q.trim()))

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="بحث في القوى العاملة (الاسم / الكود / الدور)..."
          className="flex-1 text-[11px] rounded-xl border border-border bg-surface px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
        <span className="text-[10px] font-bold text-text-secondary whitespace-nowrap">{filtered.length} / {employees.length}</span>
      </div>
      <div className="max-h-[50vh] overflow-y-auto pl-1 space-y-1.5">
        {filtered.length === 0 && <div className="bg-white border border-border rounded-xl p-6 text-center text-xs text-text-secondary">لا توجد نتائج مطابقة للبحث.</div>}
        {filtered.map((e) => <EmpRow key={e.employee_id} emp={e} onSaved={onSaved} />)}
      </div>
    </div>
  )
}

function EmpRow({ emp, onSaved }: { emp: ExecControlEmployee; onSaved: () => void }) {
  const [attendance, setAttendance] = useState(emp.attendance_enabled)
  const [followUp, setFollowUp] = useState(emp.follow_up_enabled)
  const [late, setLate] = useState(emp.late_calculation_enabled)
  const [early, setEarly] = useState(emp.early_calculation_enabled)
  const [schedule, setSchedule] = useState<'' | 'fixed' | 'flexible'>(emp.schedule_type)
  const [shown, setShown] = useState(emp.show_in_screen)
  const [start, setStart] = useState(t2s(emp.official_start_time))
  const [end, setEnd] = useState(t2s(emp.official_end_time))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [stateKey, setStateKey] = useState('')

  useEffect(() => {
    const key = JSON.stringify([
      emp.attendance_enabled, emp.follow_up_enabled, emp.schedule_type,
      emp.late_calculation_enabled, emp.early_calculation_enabled,
      emp.show_in_screen, emp.official_start_time, emp.official_end_time,
    ])
    setStateKey((k) => {
      if (k !== key) {
        setAttendance(emp.attendance_enabled)
        setFollowUp(emp.follow_up_enabled)
        setSchedule(emp.schedule_type)
        setLate(emp.late_calculation_enabled)
        setEarly(emp.early_calculation_enabled)
        setShown(emp.show_in_screen)
        setStart(t2s(emp.official_start_time))
        setEnd(t2s(emp.official_end_time))
        setMsg(null)
      }
      return key
    })
  }, [emp])

  const dirty =
    attendance !== emp.attendance_enabled ||
    followUp !== emp.follow_up_enabled ||
    late !== emp.late_calculation_enabled ||
    early !== emp.early_calculation_enabled ||
    schedule !== emp.schedule_type ||
    shown !== emp.show_in_screen ||
    (start || null) !== (t2s(emp.official_start_time) || null) ||
    (end || null) !== (t2s(emp.official_end_time) || null)

  const save = async (clear: boolean) => {
    setSaving(true)
    setMsg(null)
    try {
      const res = await executiveService.setEmployeeOverride({
        employee_id: emp.employee_id,
        attendance_enabled: attendance,
        follow_up_enabled: followUp,
        schedule_type: schedule || 'fixed',
        late_calculation_enabled: late,
        early_calculation_enabled: early,
        show_in_screen: shown,
        official_start_time: start || null,
        official_end_time: end || null,
        clear,
        reason: reason.trim() || undefined,
      })
      if (res.error) { setMsg(`خطأ: ${res.error}`); return }
      setReason('')
      onSaved()
    } catch (e: any) {
      setMsg(String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-border rounded-xl p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="min-w-0">
          <span className="text-[12px] font-bold text-text truncate">{emp.name}</span>
          <span className="text-[10px] text-text-secondary mr-2">{emp.code} — {emp.role_name}</span>
          <span className={`inline-flex px-1.5 py-0.5 rounded-full border text-[9px] font-bold mr-1 ${emp.source === 'employee_override' ? 'bg-blue-50 text-blue-700 border-blue-200' : emp.source === 'role_default' ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
            {emp.source === 'employee_override' ? 'تجاوز فردي' : emp.source === 'role_default' ? 'افتراضي الدور' : 'النظام الافتراضي'}
          </span>
          {emp.last_changed_at && <span className="text-[9px] text-text-secondary">آخر تغيير: {fmtDateTime(emp.last_changed_at)}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => void save(false)}
            disabled={!dirty || saving}
            className="text-[11px] font-bold bg-blue-700 hover:bg-blue-800 text-white rounded-lg px-3 py-1 disabled:opacity-30 transition-colors"
          >
            {saving ? 'جاري الحفظ...' : dirty ? 'حفظ' : 'محفوظ ✓'}
          </button>
          {emp.override && (
            <button
              onClick={() => void save(true)}
              disabled={saving}
              className="text-[10px] font-bold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg px-2.5 py-1 disabled:opacity-40 transition-colors"
            >
              {saving ? '...' : 'مسح التجاوز'}
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1.5">
        <Toggles rows={[
          { key: 's', label: 'مشمول بالنطاق', value: shown, onChange: setShown },
          { key: 'a', label: 'نطاق الحضور', value: attendance, onChange: setAttendance },
          { key: 'f', label: 'نطاق المتابعة', value: followUp, onChange: setFollowUp },
          { key: 'l', label: 'حساب التأخير', value: late, onChange: setLate },
          { key: 'e', label: 'حساب المبكر', value: early, onChange: setEarly },
        ]} />
        <Field label="نوع العمل">
          <select value={schedule} onChange={(e) => setSchedule(e.target.value as '' | 'fixed' | 'flexible')} className="w-full text-[11px] rounded-xl border border-border bg-white px-2 py-2">
            <option value="fixed">مكتبي (ثابت)</option>
            <option value="flexible">ميداني (مرن)</option>
          </select>
        </Field>
        <Field label="البداية الرسمية">
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-full text-[11px] rounded-xl border border-border bg-white px-2 py-2 [color-scheme:light]" />
        </Field>
        <Field label="النهاية الرسمية">
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full text-[11px] rounded-xl border border-border bg-white px-2 py-2 [color-scheme:light]" />
        </Field>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="سبب التغيير (اختياري) — يُسجَّل في التدقيق"
          className="flex-1 text-[11px] rounded-xl border border-border bg-surface px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        />
      </div>
      {msg && <div className="mt-1.5 text-[10px] text-emerald-700">{msg}</div>}
    </div>
  )
}

function AuditList({ entries }: { entries: ExecControlPolicyResponse['audit'] }) {
  if (!entries.length) {
    return <div className="bg-white border border-border rounded-xl p-6 text-center text-xs text-text-secondary">لا توجد تغييرات مسجلة بعد.</div>
  }
  return (
    <div className="max-h-[50vh] overflow-y-auto pl-1 space-y-1.5">
      {entries.map((c) => (
        <div key={c.id} className="bg-white border border-border rounded-xl px-3 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <BadgeTone entityType={c.entity_type} />
            <span className="text-[11px] font-bold text-text">{c.entity_label || c.entity_id}</span>
            <span className="text-[10px] text-text-secondary font-mono">{c.policy_key}</span>
            <span className="text-[10px] font-bold text-blue-700">{c.old_value ?? '—'}</span>
            <span className="text-[10px] text-text-secondary">←</span>
            <span className="text-[10px] font-bold text-emerald-700">{c.new_value ?? '— (محذوف)'}</span>
          </div>
          <div className="text-[10px] text-text-secondary mt-1 flex items-center gap-2 flex-wrap">
            <span>{fmtDateTime(c.changed_at)}</span>
            {c.changed_by_name && <span>بواسطة: {c.changed_by_name}</span>}
            {c.reason && <span className="text-gray-500">— {c.reason}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function BadgeTone({ entityType }: { entityType: 'role' | 'employee' }) {
  return entityType === 'role'
    ? <span className="inline-flex px-1.5 py-0.5 rounded-full border text-[9px] font-bold bg-violet-50 text-violet-700 border-violet-200">دور</span>
    : <span className="inline-flex px-1.5 py-0.5 rounded-full border text-[9px] font-bold bg-blue-50 text-blue-700 border-blue-200">موظف</span>
}