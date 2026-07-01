import type { ActivityKpis } from './types'

interface Props {
  kpis: ActivityKpis
  onKpiClick: (kpiType: string) => void
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || n === 0) return '\u2014'
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

const CARD_CONFIG = [
  { key: 'visits', label: 'الزيارات', fmt: (v: any) => fmtNum(v) },
  { key: 'orders', label: 'الطلبات', fmt: (v: any) => fmtNum(v) },
  { key: 'sales', label: 'المبيعات', fmt: (v: any) => fmtMoney(v), className: 'text-green-600' },
  { key: 'collections', label: 'التحصيل', fmt: (v: any) => fmtMoney(v) },
  { key: 'customers', label: 'عملاء جدد', fmt: (v: any) => fmtNum(v) },
]

export function BusinessActivityPanel({ kpis, onKpiClick }: Props) {
  return (
    <>
      {CARD_CONFIG.map((cfg) => (
        <button
          key={cfg.key}
          onClick={() => onKpiClick(cfg.key)}
          className="bg-white rounded-lg border border-border p-3 text-center cursor-pointer hover:bg-primary/5 transition-colors"
        >
          <div className={`text-lg font-bold ${cfg.className || 'text-text'}`}>
            {cfg.fmt((kpis as any)[cfg.key]?.value)}
          </div>
          <div className="text-[10px] text-text-secondary">{cfg.label}</div>
        </button>
      ))}
    </>
  )
}
