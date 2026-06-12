import { useNavigate } from 'react-router-dom'

export interface LauncherIcon {
  icon: string
  label: string
  desc?: string
  path: string
  badge?: string | number
}

export function SubLauncherPage({ title, icons }: { title: string; icons: LauncherIcon[] }) {
  const nav = useNavigate()

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">{title}</h1>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {icons.map((ic) => (
          <button
            key={ic.path}
            onClick={() => nav(ic.path)}
            className="bg-white rounded-xl border border-border p-4 text-center active:bg-surface transition-colors hover:shadow-sm hover:border-primary/30 active:scale-95"
          >
            <div className="text-2xl mb-1.5">{ic.icon}</div>
            <div className="text-xs font-semibold text-text">{ic.label}</div>
            {ic.desc && <div className="text-[9px] text-text-secondary mt-0.5 leading-tight">{ic.desc}</div>}
            {ic.badge !== undefined && (
              <div className="mt-1 text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full inline-block">{ic.badge}</div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
