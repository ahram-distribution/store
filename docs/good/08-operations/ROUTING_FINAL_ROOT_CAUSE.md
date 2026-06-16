# ROUTING FINAL ROOT CAUSE — 404 + Redirect to `/`

**Date:** 2026-06-16
**Scope:** Read-only analysis — no changes

---

## The Routing Chain — All 5 Layers

### Layer 1: Vite Config (`vite.config.ts:55`)

```ts
base: isMobileBuild ? './' : basePath,
// basePath = process.env.VITE_BASE_PATH || '/'
```

For GitHub Pages (`deploy.yml`):
```
VITE_BASE_PATH = /store/
// → base = '/store/'
```

### Layer 2: `index.html:7` — `%BASE_URL%` placeholder

```html
<meta name="spa-b" content="%BASE_URL%">
```

Vite replaces `%BASE_URL%` with `base` at build time:
- **Prod build:** `/store/` ✅
- **Dev build:** `/` (VITE_BASE_PATH not set)

### Layer 3: `index.html:6` — SPA Redirect Script

```js
(function(){
  var r = sessionStorage.getItem('spa_r');
  sessionStorage.removeItem('spa_r');
  if (r && r !== location.href) {
    history.replaceState(null, null, r);
    return;
  }
  var p = location.pathname;
  var b = document.querySelector('meta[name=spa-b]');
  var base = b ? b.getAttribute('content') : '/';
  if (p !== base && !p.match(/\.\w+$/)) {
    sessionStorage.setItem('spa_r', location.href);
    location.replace(location.origin + base);  // ← REDIRECT LINE
  }
})();
```

### Layer 4: `App.tsx:16,59` — React Router

```tsx
const basePath = import.meta.env.VITE_BASE_PATH || '/'
<Router basename={isNative ? undefined : basePath.replace(/\/+$/, '')}>
```
- **basename:** `/store` (without trailing slash)
- **Note:** `spa-b` = `/store/` (WITH slash) — **INCONSISTENT** with basename

### Layer 5: `src/routes/index.tsx:81,173` — Route Definitions

```tsx
<Route path="/" element={<Navigate to={user?.identity_type === 'employee' ? '/dashboard' : '/storefront'} replace />} />
<Route path="*" element={<Navigate to="/dashboard" replace />} />
```

---

## Root Cause 1 (PRIMARY): SPA Script Redirect to `/` — `index.html:6`

**The bug is in line 6 of index.html:**

```js
location.replace(location.origin + base)
```

### Scenario that breaks:

When a stale CDN node or incorrect build serves `index.html` where `%BASE_URL%` was NOT replaced (or replaced with `/`), the `spa-b` meta tag = `/`.

The SPA script then sees ANY path under `/store/` as not matching base `/`, and redirects:

```js
base = '/'  // WRONG — should be '/store/'
p = '/store/dashboard'
p !== base  → TRUE → redirect
location.replace('https://ahram-distribution.github.io' + '/')
// → https://ahram-distribution.github.io/  (org root, NOT the app)
```

### Why this happens intermittently ("أحياناً"):

- `actions/deploy-pages@v4` deploys to CDN
- CDN edge nodes cache different versions
- Without `.nojekyll`, some nodes serve the default Jekyll-processed page instead of the artifact
- The default page has `base = /` → redirect goes to org root

**THE LINE THAT CAUSES `/store/ → /`:** Line 6 of `index.html`:
```
location.replace(location.origin + base)
```
When `base = /` (wrong), this becomes `https://ahram-distribution.github.io/ + /` = `https://ahram-distribution.github.io/`

---

## Root Cause 2: SPA Base vs React Router Basename Mismatch

| System | Value | Source |
|--------|-------|--------|
| `spa-b` meta tag | `/store/` (WITH slash) | Vite `%BASE_URL%` |
| React Router basename | `/store` (WITHOUT slash) | `basePath.replace(/\/+$/, '')` |

This inconsistency means:
- SPA script expects paths to be exactly `/store/` to load
- React Router expects paths starting with `/store` (not `/store/`)

When user visits `/store/`:
- SPA sees `p === base` → no redirect ✅
- React Router sees relative path `/` → redirects to `/dashboard` ✅

When user visits `/store` (no slash):
- SPA sees `p !== base` (`/store` ≠ `/store/`) → **redirects to `/store/`** ✅
- But if `base` were `/`, redirect goes to org root ❌

---

## Root Cause 3: Missing `.nojekyll` — The Enabler

Without `.nojekyll`:
- GH Pages CDN runs Jekyll processing on the artifact
- Directory index serving (`/store/` → `index.html`) fails
- `index.html` may get processed/modified by Jekyll (breaking `%BASE_URL%`)
- CDN edge node behavior becomes inconsistent
- Some nodes serve the artifact correctly, others serve stale/Jekyll-processed pages
- This causes the "sometimes works, sometimes 404, sometimes redirects to /" behavior

---

## Complete Attack Chain

```
User visits /store/
  ↓
GH Pages (no .nojekyll) → Jekyll interferes
  ↓
Directory index serving FAILS → 404
  ↓
GH Pages serves 404.html (copy of index.html)
  ↓
CDN edge node inconsistency:
  ├── Node A: serves artifact's 404.html → spa-b=/store/ → WORKING
  ├── Node B: serves stale/Jekyll-processed page → spa-b=/ → REDIRECT TO /
  └── Node C: serves DEFAULT GH 404 (no 404.html found) → 404 PAGE
```

---

## Key Files & Lines

| File | Line | Role |
|------|------|------|
| `vite.config.ts` | 12, 55 | `basePath` / `base` — controls `%BASE_URL%` |
| `index.html` | 6 | **SPA redirect script** — `location.replace(location.origin + base)` |
| `index.html` | 7 | `%BASE_URL%` — becomes `spa-b` content |
| `App.tsx` | 16 | `basePath` from `import.meta.env.VITE_BASE_PATH` |
| `App.tsx` | 59 | `basename` — `basePath.replace(/\/+$/, '')` strips trailing slash |
| `src/routes/index.tsx` | 81 | Route `/` → redirect |
| `src/routes/index.tsx` | 173 | Catch-all `*` → redirect |
| `deploy.yml` | — | Sets `VITE_BASE_PATH=/store/` |

---

## Fix Required

1. **`public/.nojekyll`** ✅ Already done — commit `3020e22`
2. **Verify GH Pages source** = "GitHub Actions" (Settings → Pages — requires repo admin)

After `.nojekyll` is deployed:
- GH Pages skips Jekyll ✅
- Directory index serving works (`/store/` → `index.html`) ✅
- No stale base path issues ✅
- All CDN edge nodes return consistent content ✅
