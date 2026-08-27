type BeforeInstallPromptEvent = Event & {
  prompt: () => void | Promise<void>
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export interface PwaInstallSnapshot {
  deferredAvailable: boolean
  installed: boolean
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
let installed = false
let initialized = false
let snapshot: PwaInstallSnapshot = { deferredAvailable: false, installed: false }
const subscribers = new Set<() => void>()

function detectInstalled(): boolean {
  if (typeof window === 'undefined') return false
  const check = (mode: string) => Boolean(window.matchMedia?.(`(display-mode: ${mode})`)?.matches)
  const viaDisplayMode = check('standalone') || check('fullscreen') || check('minimal-ui')
  const viaIOS = Boolean((navigator as unknown as { standalone?: boolean }).standalone)
  return viaDisplayMode || viaIOS
}

function updateSnapshot(): void {
  const next: PwaInstallSnapshot = { deferredAvailable: Boolean(deferredPrompt), installed }
  if (next.deferredAvailable === snapshot.deferredAvailable && next.installed === snapshot.installed) return
  snapshot = next
  subscribers.forEach((cb) => cb())
}

export function initPwaInstall(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  installed = detectInstalled()
  updateSnapshot()

  const onBeforeInstallPrompt = (e: Event) => {
    e.preventDefault()
    deferredPrompt = e as unknown as BeforeInstallPromptEvent
    updateSnapshot()
  }
  const onAppInstalled = () => {
    installed = true
    deferredPrompt = null
    updateSnapshot()
  }
  const onDisplayModeChange = () => {
    installed = detectInstalled()
    if (installed) deferredPrompt = null
    updateSnapshot()
  }

  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.addEventListener('appinstalled', onAppInstalled)
  ;['standalone', 'fullscreen', 'minimal-ui'].forEach((mode) => {
    window.matchMedia?.(`(display-mode: ${mode})`)?.addEventListener('change', onDisplayModeChange)
  })
}

export function subscribePwaInstall(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

export function getPwaInstallSnapshot(): PwaInstallSnapshot {
  return snapshot
}

export async function promptPwaInstall(): Promise<boolean> {
  const deferred = deferredPrompt
  if (!deferred) return false
  deferredPrompt = null
  updateSnapshot()
  try {
    await deferred.prompt()
    if (deferred.userChoice) await deferred.userChoice
    return true
  } catch {
    return false
  }
}