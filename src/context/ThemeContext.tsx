import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export interface Theme {
  id: string
  name: string
  icon: string
  vars: Record<string, string>
}

/**
 * GLOBAL theme source of truth (Gold Classic = Default, VIP = Secondary).
 *
 * ONE centralized state: ThemeProvider sits at the application root (App.tsx
 * and DesktopApp.tsx) above every route/layout, so selecting a theme applies
 * to the ENTIRE application immediately with no refresh, survives navigation
 * (provider never unmounts) and survives reload (localStorage).
 *
 * Application mechanism: the active theme's `vars` are written as CSS custom
 * properties on <html>, and `data-theme` is set for structural scoping. Brand
 * tokens (--color-primary/--color-secondary/--color-accent/...) deliberately
 * mirror the Tailwind @theme tokens in style.css, so every Tailwind utility
 * (bg-primary, text-accent, bg-card, ...) follows the selected theme with no
 * per-component theme handling. Content/functional tokens (card, surface, bg,
 * text, border, success, warning, danger) are identical in both themes to
 * preserve the approved readable appearance; VIP differs in brand chrome
 * (near-black primary + brighter gold accent), exactly its approved identity.
 */
const themes: Theme[] = [
  {
    id: 'gold',
    name: 'Gold Classic',
    icon: '✨',
    vars: {
      '--theme-primary': '#0F2B5B',
      '--theme-accent': '#C9A227',
      '--theme-accent-rgb': '201, 162, 39',
      '--theme-bg-card': '#ffffff',
      '--theme-text-card': '#0F2B5B',
      '--theme-text-card-muted': '#6b7280',
      '--theme-text-card-heading': '#111827',
      // Brand tokens (mirror style.css @theme — Default approved values)
      '--color-primary': '#0052cc',
      '--color-primary-dark': '#003d99',
      '--color-primary-light': '#1a6bff',
      '--color-secondary': '#0F2B5B',
      '--color-brand': '#0F2B5B',
      '--color-accent': '#f59e0b',
      '--color-accent-light': '#fbbf24',
      '--color-gold': '#C9A227',
      '--color-gold-light': '#E0B85A',
      // Navy chrome scale (auth/desktop/splash chrome — Default approved values)
      '--theme-navy-deep': '#071B4D',
      '--theme-navy': '#0B3D91',
      '--theme-navy-soft': '#173872',
      '--theme-navy-rgb': '11, 61, 145',
      '--theme-navy-deep-rgb': '7, 27, 77',
      // Content tokens (identical in both themes — approved readable surfaces)
      '--color-surface': '#f3f4f6',
      '--color-bg': '#f8fafc',
      '--color-border': '#e5e7eb',
      '--color-text': '#111827',
      '--color-text-secondary': '#6b7280',
      '--color-text-muted': '#9ca3af',
      '--color-muted': '#9ca3af',
      '--color-card': '#ffffff',
    },
  },
  {
    id: 'vip',
    name: 'VIP',
    icon: '👑',
    vars: {
      '--theme-primary': '#1a1a1a',
      '--theme-accent': '#D4AF37',
      '--theme-accent-rgb': '212, 175, 55',
      '--theme-bg-card': '#ffffff',
      '--theme-text-card': '#1a1a1a',
      '--theme-text-card-muted': '#6b7280',
      '--theme-text-card-heading': '#111827',
      // Brand tokens remapped to the approved VIP identity (near-black chrome
      // + brighter gold); every bg-primary/text-accent/... utility app-wide
      // follows automatically.
      '--color-primary': '#1a1a1a',
      '--color-primary-dark': '#000000',
      '--color-primary-light': '#3d3d3d',
      '--color-secondary': '#1a1a1a',
      '--color-brand': '#1a1a1a',
      '--color-accent': '#D4AF37',
      '--color-accent-light': '#E7C65C',
      '--color-gold': '#D4AF37',
      '--color-gold-light': '#E0B85A',
      // Navy chrome scale mapped to the VIP black scale (same shapes, VIP identity)
      '--theme-navy-deep': '#000000',
      '--theme-navy': '#1a1a1a',
      '--theme-navy-soft': '#2b2b2b',
      '--theme-navy-rgb': '26, 26, 26',
      '--theme-navy-deep-rgb': '0, 0, 0',
      // Content tokens (identical to Default — approved readable surfaces)
      '--color-surface': '#f3f4f6',
      '--color-bg': '#f8fafc',
      '--color-border': '#e5e7eb',
      '--color-text': '#111827',
      '--color-text-secondary': '#6b7280',
      '--color-text-muted': '#9ca3af',
      '--color-muted': '#9ca3af',
      '--color-card': '#ffffff',
    },
  },
]

const STORAGE_KEY = 'ahram_theme'

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const found = themes.find((t) => t.id === saved)
      if (found) return found
    }
  } catch {}
  return themes[0]
}

interface ThemeContextValue {
  theme: Theme
  themes: Theme[]
  setTheme: (id: string) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(loadTheme)

  const setTheme = (id: string) => {
    const next = themes.find((t) => t.id === id) || themes[0]
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next.id)
    } catch {}
  }

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme.id
    const vars = theme.vars
    for (const key of Object.keys(vars)) {
      root.style.setProperty(key, vars[key])
    }
    // Verbatim last-applied cache for the cold-load boot shim in index.html.
    // ThemeContext remains the only place theme values are defined; the shim
    // only re-applies this cache before first paint (no flash).
    try {
      localStorage.setItem('ahram_theme_vars', JSON.stringify({ id: theme.id, vars }))
    } catch {}
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, themes, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
