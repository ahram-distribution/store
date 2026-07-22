import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/shared/ErrorBoundary'
import 'leaflet/dist/leaflet.css'
import './style.css'
import { BUILD_VERSION } from './version'
console.log('Build:', BUILD_VERSION)

// ─── TEMPORARY NAVIGATION DEBUGGER ───
// Captures every path-based navigation and logs the initiator.
// Remove after capturing the 404 source.
;(function initNavDebugger() {
  const BASE = '/store'
  function isPathNav(url: string) {
    try {
      const u = new URL(url, location.href)
      return u.origin === location.origin && u.pathname.startsWith(BASE) && !u.hash
    } catch { return false }
  }

  // 1. Capture <a> tag clicks
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null
    if (!a) return
    const href = a.getAttribute('href')
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return
    if (isPathNav(href) || isPathNav(a.href)) {
      console.error('[NAV-DEBUG] <a> click →', href, a.href, '\nanchor:', a, '\ncallstack:', new Error().stack)
    }
  }, true)

  // 2. Intercept history.pushState / replaceState
  const origPush = history.pushState.bind(history)
  const origReplace = history.replaceState.bind(history)
  history.pushState = function (...args) {
    const url = args[2]
    if (typeof url === 'string' && isPathNav(url)) {
      console.error('[NAV-DEBUG] pushState →', url, '\ncallstack:', new Error().stack)
    }
    return origPush(...args)
  }
  history.replaceState = function (...args) {
    const url = args[2]
    if (typeof url === 'string' && isPathNav(url)) {
      console.error('[NAV-DEBUG] replaceState →', url, '\ncallstack:', new Error().stack)
    }
    return origReplace(...args)
  }

  // 4. Intercept fetch for path-based navigations
  const origFetch = window.fetch.bind(window)
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : '')
    if (isPathNav(url)) {
      console.error('[NAV-DEBUG] fetch →', url, '\ncallstack:', new Error().stack)
    }
    return origFetch(...args)
  }

  // 5. Intercept XMLHttpRequest for path-based navigations
  const origOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (typeof url === 'string' && isPathNav(url)) {
      console.error('[NAV-DEBUG] xhr.open →', method, url, '\ncallstack:', new Error().stack)
    }
    return origOpen.call(this, method, url, ...rest)
  }

  console.log('[NAV-DEBUG] Navigation debugger active. Capturing path-based navigations under', BASE)
})()
// ─── END TEMPORARY NAVIGATION DEBUGGER ───

const root = document.getElementById('app')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
