# Browser Compatibility

## Officially Supported Browsers

### Desktop
| Browser | Minimum Version | Notes |
|---------|----------------|-------|
| Google Chrome | 87+ | Full support including PWA install, Background Sync, Periodic Sync, Push Notifications |
| Microsoft Edge | 87+ | Chromium-based; same capabilities as Chrome |
| Mozilla Firefox | 78+ | Core app works. No Background Sync, no Periodic Sync, no Push Notifications, no Web Share API on desktop |
| Safari (macOS) | 14.1+ | Core app works. No Background Sync, no Periodic Sync, limited Push (16.4+ Home Screen only). Needs `-webkit-backdrop-filter` prefix |

### Mobile
| Browser | Minimum Version | Notes |
|---------|----------------|-------|
| Chrome for Android | 87+ | Full support including PWA, Background Sync, Push Notifications |
| Samsung Internet | 14+ | Chromium-based. No Background Sync, no Periodic Sync |
| Edge Mobile | 87+ | Chromium-based; same as Chrome for Android |
| Opera (Android) | 73+ | Chromium-based; same as Chrome for Android |
| Huawei Browser | Latest | Chromium-based WebView. Geolocation may be restricted in-app |
| Oppo Browser | Latest | Chromium-based WebView. Clipboard API may be restricted in-app |
| Xiaomi Browser | Latest | Chromium-based WebView. Clipboard API may be restricted in-app |
| Safari on iPhone/iPad | 14.1+ (iOS) | No Push unless added to Home Screen (iOS 16.4+). Clipboard API requires user gesture |
| Android WebView | 87+ | Used by in-app browsers. Clipboard API may be restricted |

## Feature Support Matrix

| Feature | Chrome/Edge | Firefox | Safari | Samsung Internet | Chinese Browsers |
|---------|:-----------:|:-------:|:------:|:----------------:|:----------------:|
| Service Worker | ✅ | ✅ | ✅ 14.1+ | ✅ | ⚠️ Partial |
| Cache API | ✅ | ✅ | ✅ | ✅ | ⚠️ Partial |
| Background Sync | ✅ | ❌ | ❌ | ❌ | ❌ |
| Periodic Sync | ✅ | ❌ | ❌ | ❌ | ❌ |
| Push Notifications | ✅ | ✅ | ⚠️ 16.4+ Home Screen only | ✅ | ❌ |
| Web Share API | ✅ | ⚠️ Android only | ✅ 12.1+ | ✅ | ❌ |
| Clipboard API | ✅ | ✅ (user gesture required) | ✅ 13.1+ | ✅ | ⚠️ May be blocked |
| Geolocation | ✅ | ✅ | ✅ | ✅ | ⚠️ May be blocked in-app |
| IndexedDB | ✅ | ✅ | ✅ | ✅ | ⚠️ Partial |
| Notifications API | ✅ | ✅ | ⚠️ 16.4+ Home Screen only | ✅ | ❌ |
| `navigator.onLine` | ✅ | ✅ | ✅ | ✅ | ✅ |
| CSS `gap` in flexbox | ✅ 84+ | ✅ 63+ | ✅ 14.1+ | ✅ | ✅ |
| `backdrop-filter` | ✅ | ✅ 103+ | ✅ (needs `-webkit-` prefix) | ✅ | ✅ |
| `100dvh` | ✅ 108+ | ✅ 101+ | ✅ 15.4+ | ✅ | ⚠️ Older versions |

## Graceful Degradation

The application is designed to degrade gracefully on unsupported features:

### Clipboard API
All `navigator.clipboard.writeText()` calls are guarded by `copyToClipboard()` which checks for API existence before calling. If unavailable, the copy operation silently fails (returns `false`) rather than throwing a runtime error.

### Service Worker & Background Sync
The application checks `('serviceWorker' in navigator)` before accessing the Service Worker API. Background Sync is feature-detected via `('sync' in reg)`. On browsers without Background Sync (Firefox, Safari, Chinese browsers), tracking data is synced through the foreground `QUEUE_UPDATED` message path instead.

### Push Notifications
Push notification delivery is handled server-side. The SW push event listener is only active when a push subscription exists. Browsers without push support simply never receive push events — no error occurs.

### localStorage / sessionStorage
All storage access in the auth store uses `storageRead()`, `storageWrite()`, and `storageRemove()` wrappers that catch `QuotaExceededError` and private browsing restrictions, returning `null` or `false` instead of throwing.

### Geolocation
`navigator.geolocation` is checked with `if (!navigator.geolocation)` before use. A secure context check (`window.isSecureContext`) is also performed.

### Web Share API
All `navigator.share()` calls use optional chaining (`navigator.share?.()`) or explicit `if (navigator.share)` guards. When unavailable (Firefox desktop, Chinese browsers), the share button is hidden or falls back to clipboard copy.

## Known Limitations

### Background Sync (Chromium-only)
The offline tracking queue relies on Background Sync to flush queued GPS points when the browser regains connectivity. On non-Chromium browsers (Firefox, Safari), this mechanism is unavailable. The application falls back to foreground syncing when the user interacts with the app while online.

**Impact:** On Firefox/Safari, tracking points queued during a connectivity outage will only sync when the user opens the app and the foreground sync path runs. If the app is closed, points may be delayed until the next app open.

### Periodic Sync (Chrome/Edge-only)
The `periodicsync` event is used to periodically flush the tracking queue even when the app is not in the foreground. This is only available in Chrome and Edge, and requires the PWA to be installed and the user to have engaged with the app.

**Impact:** On non-Chromium browsers, the periodic heartbeat flush does not run. The application relies on foreground activity to trigger syncs.

### Push Notifications
Web Push is limited on iOS/iPadOS (requires Home Screen installation on iOS 16.4+) and unavailable in most Chinese browser in-app WebViews. The application degrades to no push notifications on these platforms.

### PWA Install
The `beforeinstallprompt` event is only available in Chromium-based browsers. Firefox and Safari users cannot install the app via the browser's install prompt. The install banner is not shown to these users.

## Security Context Requirements

The following APIs require a **secure context** (HTTPS or localhost):

| API | Requirement |
|-----|------------|
| Clipboard API | HTTPS + user gesture |
| Geolocation | HTTPS (recommended) |
| Service Worker | HTTPS (or localhost for development) |
| Push Notifications | HTTPS |
| IndexedDB | HTTPS (some browsers allow HTTP in development) |

The production deployment at `https://ahram-distribution.github.io/store` meets all secure context requirements.

## Browser Detection vs Feature Detection

This project uses **feature detection** (not browser detection) for all compatibility logic:

```typescript
// ✅ Correct: feature detection
if (navigator.clipboard?.writeText) { ... }
if ('serviceWorker' in navigator) { ... }
if ('sync' in reg) { ... }

// ❌ Not used: browser detection
if (navigator.userAgent.includes('Firefox')) { ... }
```

The only exception is `navigator.userAgent` usage in diagnostic pages (`GpsTestPage.tsx`) and the environment resolver, which are used for display purposes only and do not affect application behavior.
