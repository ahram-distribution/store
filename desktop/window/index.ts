export const WINDOW_CONFIG = {
  width: 1280,
  height: 800,
  minWidth: 1024,
  minHeight: 600,
  title: 'Ahram ERP',
  show: false,
  backgroundColor: '#071B4D',
  webPreferences: {
    devTools: true,
  },
} as const

export const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'


