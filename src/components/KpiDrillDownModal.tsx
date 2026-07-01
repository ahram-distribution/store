import type { EntityType } from '../modules/types'

interface Props {
  open: boolean
  title: string
  recordType: string
  records: any[]
  loading: boolean
  onClose: () => void
  onRecordClick: (entityType: EntityType, entityId?: string) => void
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || n === 0) return '\u2014'
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

const ENTITY_TYPE_MAP: Record<string, EntityType> = {
  orders: 'order',
  customers: 'customer',
  visits: 'visit',
  collections: 'collection',
}

export function KpiDrillDownModal({ open, title, recordType, records, loading, onClose, onRecordClick }: Props) {
  const entityType = ENTITY_TYPE_MAP[recordType] || 'order'
  const noRecords = !loading && records.length === 0

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl border border-border shadow-xl w-full max-w-lg mx-4 max-h-[80vh] overflow-auto p-4"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold">{title} — تفاصيل</h2>
          <button onClick={onClose} className="text-text-secondary text-lg">&times;</button>
        </div>

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
                  <td className="px-2 py-1.5 text-center text-[10px]">{r.submitted_at?.slice(0, 10)}</td>
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
                  <td className="px-2 py-1.5 text-center text-[10px]">{r.created_at?.slice(0, 10)}</td>
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
                  <td className="px-2 py-1.5 text-center text-[10px]">{r.check_in_at?.slice(0, 10)}</td>
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
                  <td className="px-2 py-1.5 text-center text-[10px]">{r.created_at?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </div>
  )
}
