import type { ExecOverviewKpis } from '../../types/executiveFollowup'
import { fmtDecimal, fmtHours, fmtMinutes, fmtMoney, fmtNum } from './executiveFormat'

interface KpiCard {
  label: string
  value: string
  hint?: string
  tone: 'blue' | 'emerald' | 'amber' | 'red' | 'violet' | 'slate'
}

function colorFor(tone: string): string {
  const map: Record<string, string> = {
    blue: 'border-blue-200',
    emerald: 'border-emerald-200',
    amber: 'border-amber-200',
    red: 'border-red-200',
    violet: 'border-violet-200',
    slate: 'border-gray-200',
  }
  return map[tone] || map.slate
}

function Card({ c }: { c: KpiCard }) {
  return (
    <div className={`bg-white rounded-xl border ${colorFor(c.tone)} px-3 py-2.5`}>
      <div className="text-[10px] text-text-secondary">{c.label}</div>
      <div className="text-base font-extrabold text-text truncate" title={c.value}>{c.value}</div>
      {c.hint ? <div className="text-[9px] text-text-secondary mt-0.5">{c.hint}</div> : null}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between px-1 mb-1.5">
        <h3 className="text-xs font-bold text-text">{title}</h3>
        <span className="text-[10px] text-text-secondary">{hint}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">{children}</div>
    </div>
  )
}

export function ExecutiveKpiBand({ kpis, loading }: { kpis: ExecOverviewKpis | null; loading: boolean }) {
  if (loading && !kpis) {
    return <div className="bg-white rounded-xl border border-border p-6 text-center text-sm text-text-secondary">جاري تحميل المؤشرات...</div>
  }
  if (!kpis || kpis.error) {
    return <div className="bg-white rounded-xl border border-border p-6 text-center text-sm text-text-secondary">لا توجد مؤشرات.</div>
  }
  const k = kpis.kpis
  const ctl = kpis.control
  const live = k.live

  const controlCards: KpiCard[] = [
    { label: 'القوى العاملة', value: fmtNum(k.workforce), hint: 'لا تشمل الإدارة العليا والرئيس التنفيذي', tone: 'slate' },
    { label: 'مشمول بالنطاق', value: fmtNum(ctl?.shown_total ?? k.workforce), hint: 'تظهر في الشاشة والفهرسة', tone: 'emerald' },
    { label: 'غير مشمول', value: fmtNum(ctl?.hidden_total ?? 0), hint: 'مستبعدون من الفهرسة (مؤجلون/مستقلون...)', tone: 'red' },
    { label: 'نطاق الحضور', value: fmtNum(ctl?.attendance_monitored ?? k.attendance_monitored), hint: 'تُلزم بعلامة البداية/النهاية', tone: 'blue' },
    { label: 'نطاق المتابعة (الموقع)', value: fmtNum(ctl?.follow_up_monitored ?? k.follow_up_monitored), hint: 'تُعرض زياراتهم/مساراتهم', tone: 'violet' },
    { label: 'مكتبي', value: fmtNum(ctl?.fixed ?? k.fixed_count), hint: 'دوام ثابت — تُحسب التأخير/الانصراف المبكر', tone: 'violet' },
    { label: 'ميداني', value: fmtNum(ctl?.flexible ?? k.flexible_count), hint: 'دوام مرن — بدون حساب تأخير/مبكر', tone: 'amber' },
  ]

  const presenceCards: KpiCard[] = [
    { label: 'موظفون حاضرون', value: fmtNum(k.present_employees), hint: 'لديهم يوم عمل في الفترة', tone: 'emerald' },
    { label: 'لم يبدأوا بعد', value: fmtNum(k.not_started), hint: 'ضمن القوى العاملة اليوم', tone: 'slate' },
    { label: 'أيام غياب', value: fmtNum(k.absence_days), hint: 'أيام عمل لموظفين دون حضور', tone: 'red' },
    { label: 'أيام عمل (إجمالي)', value: fmtNum(k.worked_days_total), tone: 'blue' },
    { label: 'ساعات حضور', value: fmtHours(k.presence_hours_total), hint: 'إجمالي الفترة', tone: 'emerald' },
    { label: 'متوسط حضور يومي', value: fmtMinutes(k.avg_daily_presence_minutes), hint: 'لكل موظف حاضر', tone: 'blue' },
    { label: 'متوسط ساعات يوم العمل', value: fmtDecimal(k.avg_worked_hours), hint: 'ساعة لكل يوم عمل', tone: 'violet' },
  ]

  const complianceCards: KpiCard[] = [
    { label: 'أيام تأخير / دقائق', value: `${fmtNum(k.late_days_total)} / ${fmtNum(k.late_minutes_total)}`, hint: 'الدوام الثابت فقط', tone: 'amber' },
    { label: 'أيام انصراف مبكر', value: fmtNum(k.early_days_total), tone: 'amber' },
    { label: 'أيام إغلاق تلقائي', value: fmtNum(k.auto_closed_days_total), hint: 'كل الأسباب', tone: 'red' },
  ]

  const productivityCards: KpiCard[] = [
    { label: 'مبيعات / ساعة حضور', value: fmtDecimal(k.sales_per_worked_hour), hint: 'صافي المبيعات ÷ ساعات الحضور', tone: 'violet' },
    { label: 'صافي المبيعات', value: fmtMoney(k.total_sales), tone: 'blue' },
    { label: 'الطلبات', value: fmtNum(k.total_orders), tone: 'emerald' },
    { label: 'الزيارات', value: fmtNum(k.total_visits), tone: 'violet' },
    { label: 'التحصيلات', value: `${fmtNum(k.total_collections)} / ${fmtMoney(k.collection_amount ?? 0)}`, tone: 'blue' },
    { label: 'العملاء الجدد', value: fmtNum(k.total_new_customers), tone: 'emerald' },
  ]
  if (k.best_performer) {
    productivityCards.push({ label: 'الأفضل (مبيعات/ساعة)', value: `${k.best_performer.name} — ${fmtDecimal(k.best_performer.sales_per_hour)}`, hint: 'مبيعات لكل ساعة حضور', tone: 'emerald' })
  }
  if (k.worst_performer) {
    productivityCards.push({ label: 'الأقل (مبيعات/ساعة)', value: `${k.worst_performer.name} — ${fmtDecimal(k.worst_performer.sales_per_hour)}`, hint: 'مبيعات لكل ساعة حضور', tone: 'red' })
  }

  return (
    <div className="space-y-4">
      <Section title="نطاق النظام والتحكم" hint={ctl ? 'وفق السياسة الفعّالة (افتراضي الدور / تجاوز فردي / النظامي)' : 'نطاق الحضور/المتابعة'}>
        {controlCards.map((c) => <Card key={c.label} c={c} />)}
      </Section>

      <Section title="حضور الفترة" hint={`${kpis.period.from} ← ${kpis.period.to}`}>
        {presenceCards.map((c) => <Card key={c.label} c={c} />)}
      </Section>

      <Section title="الالتزام (مكتبي)" hint="تُحتسب التأخير والمبكر للمكتبي فقط — الميداني بدون حساب">
        {complianceCards.map((c) => <Card key={c.label} c={c} />)}
      </Section>

      <Section title="النشاط والإنتاجية" hint="صافي المبيعات لكل ساعة حضور = مؤشر الأداء">
        {productivityCards.map((c) => <Card key={c.label} c={c} />)}
      </Section>

      {live && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="bg-gradient-to-l from-indigo-600 to-blue-800 px-4 py-2 flex items-center justify-between">
            <h3 className="text-xs font-bold text-white">الحالة اللحظية اليوم</h3>
            <span className="text-[10px] text-indigo-100">الآن (تحديث تلقائي)</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-x divide-y divide-gray-100">
            <LiveCell label="يعمل الآن" value={live.active_today} tone="emerald" />
            <LiveCell label="على زيارة" value={live.on_visit_today} tone="blue" />
            <LiveCell label="في استراحة" value={live.on_break_today} tone="violet" />
            <LiveCell label="متصل" value={live.connected_today} tone="emerald" />
            <LiveCell label="متأخر" value={live.delayed_today} tone="amber" />
            <LiveCell label="مفقود" value={live.lost_today} tone="red" />
            <LiveCell label="لا بيانات" value={live.no_data_today} tone="slate" />
            <LiveCell label="لم يبدأ" value={live.no_start_today} tone="slate" />
            <LiveCell label="أنهى اليوم" value={live.ended_today} tone="slate" />
            <LiveCell label="إغلاق تلقائي" value={live.auto_closed_today} tone="red" />
            <LiveCell label="متأخر اليوم" value={live.late_today} tone="amber" />
          </div>
        </div>
      )}

      <div className="text-[10px] text-text-secondary px-1">{kpis.definition_note || ''}</div>
    </div>
  )
}

function LiveCell({ label, value, tone }: { label: string; value: number; tone: string }) {
  const txt: Record<string, string> = {
    emerald: 'text-emerald-700', blue: 'text-blue-700', violet: 'text-violet-700',
    amber: 'text-amber-600', red: 'text-red-600', slate: 'text-gray-600',
  }
  return (
    <div className="px-3 py-2">
      <div className={`text-lg font-extrabold ${txt[tone] || txt.slate}`}>{fmtNum(value)}</div>
      <div className="text-[10px] text-text-secondary">{label}</div>
    </div>
  )
}
