import type { EntityType } from '../modules/types'
import { toCairoDate } from '../lib/dateRange'
import { formatInteger } from '../utils/numbers'

interface Props {
  open: boolean
  title: string
  subtitle?: string
  description?: string
  expectedValue?: string
  recordType: string
  records: any[]
  loading: boolean
  onClose: () => void
  onRecordClick: (entityType: EntityType, entityId?: string) => void
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return formatInteger(n)
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return formatInteger(n)
}

function fmtTime(t?: string): string {
  if (!t) return '\u2014'
  try { return new Date(t).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: true }) }
  catch { return t.length >= 5 ? t.slice(0, 5) : t }
}

function fmtHours(minutes: number | null | undefined): string {
  if (minutes == null) return '\u2014'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

function fmtDist(meters: number | null | undefined): string {
  if (meters == null || meters === 0) return '0'
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} كم` : `${Math.round(meters)} م`
}

function fmtSessionDate(d?: string): string {
  if (!d) return '\u2014'
  const [y, m, day] = d.split('-')
  if (!y || !m || !day) return d
  return `${Number(day)}/${Number(m)}`
}

const ENTITY_TYPE_MAP: Record<string, EntityType> = {
  orders: 'order',
  customers: 'customer',
  visits: 'visit',
  collections: 'collection',
}

function computeTotals(recordType: string, records: any[]): string | null {
  const n = records.length
  switch (recordType) {
    case 'orders': {
      const sum = records.reduce((s, r) => s + (Number(r.total_amount) || 0), 0)
      return `عدد الطلبات: ${formatInteger(n)} — إجمالي المبالغ: ${formatInteger(sum)} ج.م`
    }
    case 'customers':
      return `إجمالي العملاء: ${formatInteger(n)}`
    case 'visits':
      return `إجمالي الزيارات: ${formatInteger(n)}`
    case 'collections': {
      const sum = records.reduce((s, r) => s + (Number(r.amount) || 0), 0)
      return `عدد التحصيلات: ${formatInteger(n)} — إجمالي المبالغ: ${formatInteger(sum)} ج.م`
    }
    case 'sessions': {
      const net = records.reduce((s, r) => s + (Number(r.net_minutes) || 0), 0)
      const dist = records.reduce((s, r) => s + (Number(r.distance_meters) || 0), 0)
      return `عدد الجلسات: ${formatInteger(n)} — إجمالي ساعات العمل: ${fmtHours(net)} — إجمالي المسافة: ${fmtDist(dist)}`
    }
    default:
      return null
  }
}

export function KpiDrillDownModal({ open, title, subtitle, description, expectedValue, recordType, records, loading, onClose, onRecordClick }: Props) {
  const entityType = ENTITY_TYPE_MAP[recordType] || 'order'
  const noRecords = !loading && records.length === 0
  const totals = loading || noRecords ? null : computeTotals(recordType, records)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl border border-border shadow-xl w-full max-w-lg mx-4 max-h-[calc(100dvh-6rem)] flex flex-col"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between p-4 pb-3">
          <div>
            <h2 className="text-sm font-bold">{title} — تفاصيل</h2>
            {subtitle ? <div className="text-[11px] text-text-secondary mt-0.5">{subtitle}</div> : null}
          </div>
          <button onClick={onClose} className="text-text-secondary text-lg">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">

        {description ? (
          <div className="mb-3 bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 text-[11px] leading-relaxed text-text-secondary">{description}</div>
        ) : null}

        {loading ? (
          <div className="text-center py-4 text-xs text-text-secondary">جاري التحميل...</div>
        ) : noRecords ? (
          <div className="text-center py-4 text-xs text-text-secondary">لا توجد سجلات</div>
        ) : recordType === 'orders' ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="px-2 py-1.5 text-right font-semibold text-text-secondary">رقم الطلب</th>
                <th className="px-2 py-1.5 text-right font-semibold text-text-secondary">العميل</th>
                <th className="px-2 py-1.5 text-left font-semibold text-text-secondary">المبلغ</th>
                <th className="px-2 py-1.5 text-center font-semibold text-text-secondary">الحالة</th>
                <th className="px-2 py-1.5 text-center font-semibold text-text-secondary">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r: any, i: number) => (
                <tr
                  key={i}
                  className="border-b border-border/50 cursor-pointer hover:bg-primary/5 transition-colors"
                  onClick={() => onRecordClick(entityType, r.id || r.order_number)}
                >
                  <td className="px-2 py-1.5">{r.order_number}</td>
                  <td className="px-2 py-1.5">{r.customer_name}</td>
                  <td className="px-2 py-1.5 text-left font-semibold">{fmtMoney(r.total_amount)}</td>
                  <td className="px-2 py-1.5 text-center">{r.status}</td>
                  <td className="px-2 py-1.5 text-center text-[10px]">{toCairoDate(r.submitted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : recordType === 'customers' ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="px-2 py-1.5 text-right font-semibold text-text-secondary">الكود</th>
                <th className="px-2 py-1.5 text-right font-semibold text-text-secondary">الاسم</th>
                <th className="px-2 py-1.5 text-right font-semibold text-text-secondary">المسؤول</th>
                <th className="px-2 py-1.5 text-center font-semibold text-text-secondary">تاريخ الإنشاء</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r: any, i: number) => (
                <tr
                  key={i}
                  className="border-b border-border/50 cursor-pointer hover:bg-primary/5 transition-colors"
                  onClick={() => onRecordClick(entityType, r.id || r.code)}
                >
                  <td className="px-2 py-1.5">{r.code}</td>
                  <td className="px-2 py-1.5">{r.company_name}</td>
                  <td className="px-2 py-1.5">{r.responsible_name}</td>
                  <td className="px-2 py-1.5 text-center text-[10px]">{toCairoDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : recordType === 'visits' ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="px-2 py-1.5 text-right font-semibold text-text-secondary">كود الزيارة</th>
                <th className="px-2 py-1.5 text-right font-semibold text-text-secondary">العميل</th>
                <th className="px-2 py-1.5 text-center font-semibold text-text-secondary">الحالة</th>
                <th className="px-2 py-1.5 text-center font-semibold text-text-secondary">النتيجة</th>
                <th className="px-2 py-1.5 text-center font-semibold text-text-secondary">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r: any, i: number) => (
                <tr
                  key={i}
                  className="border-b border-border/50 cursor-pointer hover:bg-primary/5 transition-colors"
                  onClick={() => onRecordClick(entityType, r.id || r.code)}
                >
                  <td className="px-2 py-1.5">{r.code}</td>
                  <td className="px-2 py-1.5">{r.customer_name}</td>
                  <td className="px-2 py-1.5 text-center">{r.status}</td>
                  <td className="px-2 py-1.5 text-center">{r.visit_result}</td>
                  <td className="px-2 py-1.5 text-center text-[10px]">{toCairoDate(r.check_in_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : recordType === 'collections' ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="px-2 py-1.5 text-right font-semibold text-text-secondary">الكود</th>
                <th className="px-2 py-1.5 text-right font-semibold text-text-secondary">العميل</th>
                <th className="px-2 py-1.5 text-left font-semibold text-text-secondary">المبلغ</th>
                <th className="px-2 py-1.5 text-center font-semibold text-text-secondary">الحالة</th>
                <th className="px-2 py-1.5 text-center font-semibold text-text-secondary">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r: any, i: number) => (
                <tr
                  key={i}
                  className="border-b border-border/50 cursor-pointer hover:bg-primary/5 transition-colors"
                  onClick={() => onRecordClick(entityType, r.id || r.code)}
                >
                  <td className="px-2 py-1.5">{r.code}</td>
                  <td className="px-2 py-1.5">{r.customer_name}</td>
                  <td className="px-2 py-1.5 text-left font-semibold">{fmtMoney(r.amount)}</td>
                  <td className="px-2 py-1.5 text-center">{r.status}</td>
                  <td className="px-2 py-1.5 text-center text-[10px]">{toCairoDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : recordType === 'sessions' ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="px-2 py-1.5 text-right font-semibold text-text-secondary">التاريخ</th>
                <th className="px-2 py-1.5 text-center font-semibold text-text-secondary">البداية</th>
                <th className="px-2 py-1.5 text-center font-semibold text-text-secondary">النهاية</th>
                <th className="px-2 py-1.5 text-center font-semibold text-text-secondary">ساعات العمل</th>
                <th className="px-2 py-1.5 text-center font-semibold text-text-secondary">المسافة</th>
                <th className="px-2 py-1.5 text-center font-semibold text-text-secondary">الزيارات</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r: any, i: number) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="px-2 py-1.5">{fmtSessionDate(r.date)}</td>
                  <td className="px-2 py-1.5 text-center">{fmtTime(r.start_time)}</td>
                  <td className="px-2 py-1.5 text-center">{fmtTime(r.end_time)}</td>
                  <td className="px-2 py-1.5 text-center font-semibold">{fmtHours(r.net_minutes)}</td>
                  <td className="px-2 py-1.5 text-center">{fmtDist(r.distance_meters)}</td>
                  <td className="px-2 py-1.5 text-center">{r.visit_count != null ? fmtNum(r.visit_count) : '\u2014'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {totals && (
          <div className="mt-3 bg-surface border border-border/60 rounded-lg px-3 py-2 text-[11px] font-semibold text-text">
            {totals}
            {expectedValue ? <span className="mr-2 text-success">(الرقم المعروض: {expectedValue})</span> : null}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
