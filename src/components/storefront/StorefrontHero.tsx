import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { ThemeSelector } from './ThemeSelector'

const stats = [
  { value: '35+', label: 'شركة شريكة' },
  { value: '1500+', label: 'منتج متنوع' },
  { value: 'عروض', label: 'يومية' },
  { value: 'توصيل', label: 'سريع' },
]

export function StorefrontHero() {
  const navigate = useNavigate()
  const { token } = useAuthStore()
  const [themeOpen, setThemeOpen] = useState(false)

  return (
    <>
      <div style={{ background: 'var(--theme-primary)', borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }}>

        <div className="flex items-center gap-3" style={{ padding: '18px 16px 10px' }}>
          <img
            src={`${import.meta.env.BASE_URL}pwa/branding/logo-square.png`}
            alt=""
            style={{ width: 48, height: 48, borderRadius: 10, flexShrink: 0 }}
          />
          <div className="flex-1 min-w-0">
            <div style={{ color: 'var(--theme-accent)', fontWeight: 700, fontSize: 18, lineHeight: 1.2 }}>
              الأهرام للتجارة والتوزيع
            </div>
            <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 11, marginTop: 2 }}>
              منصة توزيع متكاملة للجملة والتجزئة
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2" style={{ padding: '0 16px 14px' }}>
          <button
            onClick={() => navigate(token ? '/account' : '/login')}
            className="shrink-0 flex items-center justify-center active:opacity-80 transition-opacity"
            style={{ width: 36, height: 36, borderRadius: 999, background: 'rgba(var(--theme-accent-rgb), .15)', border: '1px solid rgba(var(--theme-accent-rgb), .25)', color: 'var(--theme-accent)' }}
          >
            {token ? <span style={{ fontSize: 18, lineHeight: 1 }}>👤</span> : <span style={{ fontSize: 13, fontWeight: 600 }}>دخول</span>}
          </button>
          <button
            onClick={() => setThemeOpen(true)}
            className="shrink-0 flex items-center justify-center active:opacity-80 transition-opacity"
            style={{ width: 36, height: 36, borderRadius: 999, background: 'rgba(var(--theme-accent-rgb), .15)', border: '1px solid rgba(var(--theme-accent-rgb), .25)', color: 'var(--theme-accent)', fontSize: 16, lineHeight: 1 }}
            title="الثيمات"
          >
            🎨
          </button>
        </div>

        <div className="grid grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.label} style={{ background: 'var(--theme-primary)', padding: '10px 4px', textAlign: 'center', borderRight: i < stats.length - 1 ? '1px solid rgba(var(--theme-accent-rgb), .15)' : 'none', borderTop: '1px solid rgba(var(--theme-accent-rgb), .15)' }}>
              <div style={{ color: 'var(--theme-accent)', fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{s.value}</div>
              <div style={{ color: 'rgba(255,255,255,.45)', fontSize: 9, marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {themeOpen && <ThemeSelector onClose={() => setThemeOpen(false)} />}
    </>
  )
}
