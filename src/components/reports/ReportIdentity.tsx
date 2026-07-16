import { safeFormatDateTime } from '../../utils/format'
import type { ReportIdentity as ReportIdentityData } from '../../types/reports'
import { cairoDateComponents } from '../../lib/dateRange'

interface ReportIdentityProps {
  identity: ReportIdentityData
}

function fmtArabicDate(isoOrDate: string): string {
  if (!isoOrDate) return ''
  try {
    const d = new Date(isoOrDate)
    const [y, m, day] = cairoDateComponents(d)
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    return `${day} ${months[m - 1]} ${y}`
  } catch { return isoOrDate.slice(0, 10) }
}

export function ReportIdentity({ identity }: ReportIdentityProps) {
  const { title, scope, managerName, employeeName, employeeCode, dateFrom, dateTo, generatedAt } = identity

  return (
    <div className="bg-white rounded-2xl border border-border/60 p-5 space-y-2.5">
      <h1 className="text-lg font-bold text-text">{title}</h1>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-text-secondary">
        {scope === 'manager' && managerName && (
          <span className="font-semibold">{managerName}</span>
        )}
        {scope === 'employee' && employeeName && (
          <span className="font-semibold">
            {employeeName}
            {employeeCode ? ` (${employeeCode})` : ''}
          </span>
        )}
        {dateFrom && dateTo && (
          <span className="bg-surface/60 px-2 py-0.5 rounded-full">
            {fmtArabicDate(dateFrom)} — {fmtArabicDate(dateTo)}
          </span>
        )}
        {generatedAt && (
          <span className="text-text-secondary/60">
            {safeFormatDateTime(generatedAt, '--')}
          </span>
        )}
      </div>
    </div>
  )
}
