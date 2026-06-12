import { useTheme } from '../../context/ThemeContext'

interface ThemeSelectorProps {
  onClose: () => void
}

export function ThemeSelector({ onClose }: ThemeSelectorProps) {
  const { theme, themes, setTheme } = useTheme()

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div className="rounded-t-2xl p-5 pb-8 animate-slide-up" onClick={(e) => e.stopPropagation()} style={{ background: 'var(--theme-primary)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold" style={{ color: 'var(--theme-accent)' }}>🎨 اختر الثيم</h3>
          <button onClick={onClose} style={{ color: 'rgba(255,255,255,.5)', fontSize: 20, lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-2.5">
          {themes.map((t) => {
            const active = t.id === theme.id
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 14,
                  border: active ? '2px solid var(--theme-accent)' : '1px solid rgba(var(--theme-accent-rgb), .15)',
                  background: active ? 'rgba(var(--theme-accent-rgb), .1)' : 'rgba(255,255,255,.04)',
                  cursor: 'pointer',
                  WebkitAppearance: 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 10, background: t.vars['--theme-primary'], border: '1px solid rgba(var(--theme-accent-rgb), .2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 18, lineHeight: 1 }}>{t.icon}</span>
                </div>
                <div className="flex-1 text-right">
                  <div style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{t.name}</div>
                  <div style={{ color: 'rgba(255,255,255,.45)', fontSize: 11, marginTop: 1 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: t.vars['--theme-accent'], marginLeft: 4, verticalAlign: 'middle' }} />
                    {t.vars['--theme-accent']}
                  </div>
                </div>
                {active && (
                  <span style={{ color: 'var(--theme-accent)', fontSize: 18, lineHeight: 1 }}>✓</span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
