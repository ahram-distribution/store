import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import 'leaflet/dist/leaflet.css'
import './style.css'
import { BUILD_VERSION } from './version'
console.log('Build:', BUILD_VERSION)

const root = document.getElementById('app')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
