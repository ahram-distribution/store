import { StatusBadge } from '../shared/StatusBadge'
import { formatDate, formatCurrencyShort } from '../../utils/format'

function formatDateTime(dt: string): string {
  try {
    const d = new Date(dt)
    const date = d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' })
    const time = d.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })
    return date + ' ' + time
  } catch { return dt }
}

function calcDuration(start: string, end: string): string {
  const diff = new Date(end).getTime() - new Date(start).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'أقل من دقيقة'
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return hours > 0
    ? hours + 'س ' + (rem > 0 ? rem + 'د' : '')
    : rem + ' دقيقة'
}

interface VisitCardProps {
  visit: any
  customerName?: string
  employeeName?: string
  onClick: () => void
}

export function VisitCard({ visit, customerName, employeeName, onClick }: VisitCardProps) {
  const isActive = visit.status === 'active'
  const isCompleted = visit.status === 'completed'
  const hasEnd = !!visit.check_out_at

  let cardBorder = 'border border-border'
  let headerBg = 'bg-gradient-to-l from-primary/10 to-primary/5 border-b border-primary/10'
  let codeBg = 'bg-primary text-white'
  let durationColor = 'text-text-secondary'
  if (isActive) {
    cardBorder = 'border border-accent/40'
    headerBg = 'bg-gradient-to-l from-accent/15 to-accent/5 border-b border-accent/10'
    codeBg = 'bg-accent text-white'
    durationColor = 'text-accent font-semibold'
  } else if (isCompleted) {
    cardBorder = 'border border-success/30'
    headerBg = 'bg-gradient-to-l from-success/10 to-success/5 border-b border-success/10'
    codeBg = 'bg-success text-white'
    durationColor = 'text-success font-semibold'
  }

  const name = customerName || visit.customer_name || ''
  const emp = employeeName || visit.employee_name || ''
  const ccx = visit.customer_context || null

  return (
    <div onClick={onClick}
      className={'rounded-xl cursor-pointer active:scale-[0.98] transition-all bg-white ' + cardBorder}>
      <div className={'rounded-t-xl px-3 py-2 flex items-center justify-between ' + headerBg}>
        <span className={'text-[10px] px-2 py-0.5 rounded-full font-semibold ' + codeBg}>
          {visit.code || 'غير متوفر'}
        </span>
        <StatusBadge status={visit.status} />
      </div>
      <div className="p-3 space-y-1.5">
        <p className="text-sm font-bold text-text">{name}</p>

        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
          {emp && (
            <>
              <span className="text-text-secondary">بواسطة</span>
              <span className="text-text font-medium">{emp}</span>
            </>
          )}

          {visit.check_in_at && (
            <>
              <span className="text-text-secondary">البداية</span>
              <span className="text-text">{formatDateTime(visit.check_in_at)}</span>
            </>
          )}

          {hasEnd && (
            <>
              <span className="text-text-secondary">النهاية</span>
              <span className="text-text">{formatDateTime(visit.check_out_at)}</span>
            </>
          )}

          {visit.check_in_at && hasEnd && (
            <>
              <span className="text-text-secondary">المدة</span>
              <span className={durationColor}>{calcDuration(visit.check_in_at, visit.check_out_at)}</span>
            </>
          )}
        </div>

        {visit.notes && (
          <p className="text-[11px] bg-surface/50 rounded-lg px-2 py-1.5 text-text-secondary leading-relaxed mt-1">
            {visit.notes.replace(/^طلب:[a-f0-9-]+\|/, '')}
          </p>
        )}

        {ccx && (
          <div className="mt-2 border-t border-border/60 pt-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-primary uppercase tracking-wide">بيانات العميل</p>
              {ccx.visit_count != null && ccx.visit_count > 0 && (
                <span className="text-[10px] text-text-secondary">الزيارات: {ccx.visit_count}</span>
              )}
            </div>

            <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
              {ccx.phone && (
                <>
                  <span className="text-text-secondary">الهاتف</span>
                  <span dir="ltr" className="text-left text-text font-medium">{ccx.phone}</span>
                </>
              )}
              {ccx.registered_address && (
                <>
                  <span className="text-text-secondary">العنوان</span>
                  <span className="text-text">{ccx.registered_address}</span>
                </>
              )}
              {ccx.created_at && (
                <>
                  <span className="text-text-secondary">تاريخ الإنشاء</span>
                  <span className="text-text">{formatDate(ccx.created_at)}</span>
                </>
              )}
              {ccx.creator_name && (
                <>
                  <span className="text-text-secondary">أنشأ الحساب</span>
                  <span className="text-text">{ccx.creator_name}</span>
                </>
              )}
            </div>

            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              <div className="bg-surface/60 rounded-lg px-1.5 py-1 text-center">
                <p className="text-[9px] text-text-secondary">الطلبات</p>
                <p className="text-[12px] font-bold text-text" dir="ltr">{ccx.order_count ?? 0}</p>
              </div>
              <div className="bg-surface/60 rounded-lg px-1.5 py-1 text-center">
                <p className="text-[9px] text-text-secondary">قيمة الطلبات</p>
                <p className="text-[12px] font-bold text-text" dir="ltr">{ccx.orders_total != null ? formatCurrencyShort(ccx.orders_total) : '0'}</p>
              </div>
              <div className="bg-surface/60 rounded-lg px-1.5 py-1 text-center">
                <p className="text-[9px] text-text-secondary">آخر طلب</p>
                <p className="text-[12px] font-semibold text-text">{ccx.last_order_date ? formatDate(ccx.last_order_date) : '—'}</p>
              </div>
            </div>

            <div className="mt-1.5 flex items-center justify-between text-[11px]">
              <span className="text-text-secondary">آخر زيارة قبل الحالية</span>
              <span className="text-text font-medium">{ccx.last_visit_before ? formatDateTime(ccx.last_visit_before) : 'لا توجد زيارة سابقة'}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
