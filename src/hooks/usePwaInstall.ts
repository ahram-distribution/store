import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { subscribePwaInstall, getPwaInstallSnapshot, promptPwaInstall } from '../services/pwaInstall'

export type InstallCapability =
  | 'native_prompt'
  | 'native_pending'
  | 'browser_install_ui'
  | 'ios_share'
  | 'unsupported'
  | 'already_installed'

export type PlatformName = 'ios' | 'android' | 'windows' | 'macos' | 'linux' | 'unknown'
export type BrowserName =
  | 'chrome'
  | 'edge'
  | 'brave'
  | 'opera'
  | 'firefox'
  | 'safari'
  | 'samsung-internet'
  | 'huawei-browser'
  | 'unknown'

export interface BrowserInfo {
  name: BrowserName
  platform: PlatformName
}

function getUA(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : ''
}

function getPlatformHint(): string {
  const ud = (navigator as { userAgentData?: { platform?: string } }).userAgentData
  return (ud?.platform || (navigator as { platform?: string }).platform || '').toLowerCase()
}

export function detectBrowser(): BrowserInfo {
  const ua = getUA()
  const platformHint = getPlatformHint()

  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (platformHint === 'macintel' && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)
  const isAndroid = /android/i.test(ua)

  if (isIOS) {
    if (/crios/i.test(ua)) return { name: 'chrome', platform: 'ios' }
    if (/edgios/i.test(ua)) return { name: 'edge', platform: 'ios' }
    if (/fxiOS/i.test(ua)) return { name: 'firefox', platform: 'ios' }
    if (/opios/i.test(ua)) return { name: 'opera', platform: 'ios' }
    return { name: 'safari', platform: 'ios' }
  }

  if (isAndroid) {
    if (/samsungbrowser[\s\/]/i.test(ua)) return { name: 'samsung-internet', platform: 'android' }
    if (/huaweibrowser/i.test(ua)) return { name: 'huawei-browser', platform: 'android' }
    if (/edg\//i.test(ua)) return { name: 'edge', platform: 'android' }
    if (/opr\//i.test(ua)) return { name: 'opera', platform: 'android' }
    if (/fxandroid|firefox/i.test(ua)) return { name: 'firefox', platform: 'android' }
    if (/chrome\/|chromium|crios/i.test(ua)) return { name: 'chrome', platform: 'android' }
    return { name: 'unknown', platform: 'android' }
  }

  const isWindows = /win/i.test(platformHint) || /windows/i.test(ua)
  const isMac = /mac/i.test(platformHint)
  const isLinux = /linux/i.test(platformHint) || /linux/i.test(ua)
  const platform: PlatformName = isWindows ? 'windows' : isMac ? 'macos' : isLinux ? 'linux' : 'unknown'

  if (/edg\//i.test(ua)) return { name: 'edge', platform }
  if (/opr\//i.test(ua) || /opera/i.test(ua)) return { name: 'opera', platform }
  if (/brave/i.test(ua)) return { name: 'brave', platform }
  if (/firefox\//i.test(ua)) return { name: 'firefox', platform }
  if (/chrome\/|chromium/i.test(ua)) return { name: 'chrome', platform }
  if (/safari\//i.test(ua)) return { name: 'safari', platform }
  return { name: 'unknown', platform }
}

function computeCapability(
  deferredAvailable: boolean,
  installed: boolean,
  browser: BrowserInfo
): InstallCapability {
  if (installed) return 'already_installed'
  if (deferredAvailable) return 'native_prompt'
  if (browser.platform === 'ios') return 'ios_share'
  if (browser.platform === 'android') {
    if (browser.name === 'firefox') return 'browser_install_ui'
    return 'native_pending'
  }
  if (browser.platform === 'windows' || browser.platform === 'macos' || browser.platform === 'linux') {
    if (browser.name === 'firefox') return 'unsupported'
    if (browser.name === 'safari') return 'browser_install_ui'
    return 'native_pending'
  }
  return 'unsupported'
}

export interface PwaInstallState {
  capability: InstallCapability
  browser: BrowserInfo
  openInstall: () => Promise<boolean>
}

export function usePwaInstall(): PwaInstallState {
  const browser = useMemo(detectBrowser, [])
  const { deferredAvailable, installed } = useSyncExternalStore(
    subscribePwaInstall,
    getPwaInstallSnapshot,
    getPwaInstallSnapshot
  )

  const capability = useMemo(() => computeCapability(deferredAvailable, installed, browser), [deferredAvailable, installed, browser])

  const openInstall = useCallback(async (): Promise<boolean> => {
    return promptPwaInstall()
  }, [])

  return { capability, browser, openInstall }
}

export function getInstallSteps(browser: BrowserInfo, capability: InstallCapability): string[] {
  if (capability === 'already_installed' || capability === 'native_prompt') return []

  if (capability === 'native_pending') {
    return [
      'لم يصدر المتصفح بعدُ أمر التثبيت المباشر لهذه الصفحة',
      'أعد فتح الصفحة مرة أخرى، وسيعمل الزر على فتح نافذة التثبيت الأصلية فور توافرها',
    ]
  }

  if (capability === 'ios_share') {
    return ['اضغط زر "مشاركة"', 'اختر "إضافة إلى الشاشة الرئيسية"', 'اضغط "إضافة" في الزاوية العلوية']
  }

  if (capability === 'unsupported') {
    if (browser.name === 'firefox' && browser.platform === 'android') {
      return [
        'افتح قائمة Firefox (☰)',
        'اختر "تثبيت" أو "إضافة إلى الشاشة الرئيسية"',
      ]
    }
    if (browser.name === 'firefox') {
      return [
        'متصفح Firefox على هذا الجهاز لا يدعم تثبيت الويب مباشرة',
        'للحصول على تجربة التطبيق استخدم Chrome أو Edge على هذا الجهاز',
      ]
    }
    return [
      'المتصفح الحالي لا يوفر مسار تثبيت مدعوماً لهذا التطبيق',
      'استخدم Chrome أو Edge للحصول على أفضل تجربة تثبيت',
    ]
  }

  if (browser.platform === 'android') {
    switch (browser.name) {
      case 'samsung-internet':
        return ['افتح قائمة Samsung Internet (☰)', 'اختر "إضافة صفحة إلى الشاشة الرئيسية"']
      case 'huawei-browser':
        return ['افتح قائمة Huawei Browser (☰)', 'اختر "إضافة إلى الشاشة الرئيسية"']
      case 'edge':
        return ['افتح قائمة Edge (...)', 'اختر "تطبيقات" ثم "تثبيت هذا التطبيق"']
      case 'opera':
        return ['افتح قائمة Opera', 'اختر "تثبيت" أو "إضافة إلى الشاشة الرئيسية"']
      case 'firefox':
        return ['افتح قائمة Firefox (☰)', 'اختر "تثبيت" أو "إضافة إلى الشاشة الرئيسية"']
      case 'chrome':
      default:
        return ['افتح قائمة Chrome (⋮)', 'اختر "تثبيت التطبيق" أو "إضافة إلى الشاشة الرئيسية"']
    }
  }

  switch (browser.name) {
    case 'edge':
      return ['افتح قائمة Edge (...) ثم "تطبيقات"', 'اختر "تثبيت هذا الموقع كتطبيق"']
    case 'brave':
      return ['افتح قائمة Brave (☰)', 'اختر "تثبيت هذا الموقع كتطبيق"']
    case 'opera':
      return ['افتح قائمة Opera (زر Opera)', 'اختر "تثبيت هذا الموقع كتطبيق"']
    case 'safari':
      return ['من شريط القوائم اختر ملف (File)', 'اختر "إضافة إلى Dock" (Add to Dock)']
    case 'chrome':
    default:
      return ['اضغط رمز التثبيت بجوار شريط العنوان', 'أو افتح قائمة Chrome (⋮) ثم اختر "تثبيت هذا الموقع كتطبيق"']
  }
}