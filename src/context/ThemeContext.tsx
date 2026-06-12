import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export interface Theme {
  id: string
  name: string
  icon: string
  vars: Record<string, string>
}

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
    const vars = theme.vars
    for (const key of Object.keys(vars)) {
      root.style.setProperty(key, vars[key])
    }
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
