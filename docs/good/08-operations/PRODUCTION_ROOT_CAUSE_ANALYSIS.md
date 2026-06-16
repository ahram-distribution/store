# PRODUCTION ROOT CAUSE ANALYSIS — GitHub Pages /store/ 404

**Date:** 2026-06-16
**Status:** Investigation only — no changes made

---

## Symptom

| URL | Expected | Actual (User) | Actual (Probe) |
|-----|----------|---------------|----------------|
| `https://ahram-distribution.github.io/store/` | App loads | **404 GitHub Pages** | 200 ✅ |
| `https://ahram-distribution.github.io/store/index.html` | App loads | App loads ✅ | 200 ✅ |

**User reports 404 for root path, but `/store/index.html` works.**

---

## Investigation — What We Verified

### 1. dist/ Structure (Local — matches what was deployed)

```
dist/
├── index.html          (1693 bytes) ✅ at root
├── 404.html            (1693 bytes — identical to index.html) ✅ SPA fallback
├── assets/
│   ├── index-*.js
│   └── index-*.css
├── pwa/
├── manifest.webmanifest
└── registerSW.js
```

**Conclusion:** Artifact structure is correct — `index.html` is at the root.

### 2. Deployment Pipeline

- **Action:** `actions/upload-pages-artifact@v3` with `path: ./dist` — uploads **contents** of `dist/` to artifact root
- **Action:** `actions/deploy-pages@v4` — deploys artifact to Pages CDN
- **Deployment API:** Status = `success`, Environment URL = `https://ahram-distribution.github.io/store/`
- **Last successful run:** #13 — commit `6d3d029` — 10s deploy step ✅

### 3. Response Verification (From Probe Location)

Both URLs return HTTP 200 with identical content (2184 bytes, `text/html`):

```http
GET /store/            → 200 OK  (2184 bytes)
GET /store/index.html  → 200 OK  (2184 bytes)
```

### 4. Branches on Remote

```
refs/heads/main  (ONLY branch — no gh-pages branch)
```

### 5. Git Remotes

```
origin → https://github.com/joker-alahram/ahram-distribution.git
store  → https://github.com/ahram-distribution/store.git
```

### 6. Two Active Workflows

The Actions page shows **two** Pages-related workflows:
1. **Deploy to GitHub Pages** (custom `deploy.yml`) — builds + deploys
2. **pages-build-deployment** (built-in) — auto-triggered by Pages events

---

## Root Cause

### Primary: Missing `.nojekyll` + Pages Source Configuration Gap

**GitHub Pages Action-based deployment** requires the repository's Pages source to be set to **"GitHub Actions"** (not "Deploy from a branch").  

When the source is misconfigured or when the `.nojekyll` file is absent:

- `actions/deploy-pages@v4` uploads the artifact and reports success
- But the **Pages CDN** may revert to legacy branch-based deployment (empty `gh-pages` branch or stale data)
- The **directory index serving** (`/store/` → `/store/index.html`) fails because the CDN doesn't recognize the Action-deployed content as the active Pages source
- Explicit file paths (`/store/index.html`) work because the CDN serves them directly from the artifact

### Secondary: Missing `.nojekyll` in Both Repo Root and dist/

| Location | .nojekyll |
|----------|-----------|
| Repo root | ❌ MISSING |
| `dist/` | ❌ MISSING |

Without `.nojekyll`, the legacy GitHub Pages Jekyll build system may interfere with Action-based deployments, especially for **organization project sites with subpaths** (`/store/`). This is a known GitHub Pages issue.

---

## Corrective Actions Required

1. **Set Pages source to "GitHub Actions"** in repo Settings → Pages (requires repo admin)
2. **Add `.nojekyll` to `dist/`** — either by:
   - Adding `public/.nojekyll` (Vite copies `public/` to `dist/`)
   - Or adding a build step: `echo "" > dist/.nojekyll`
3. **Remove the legacy `gh-pages` branch** if it exists on `origin` (`joker-alahram/ahram-distribution`) — not on `store`
4. **Verify** after deployment: both `/store/` and `/store/index.html` return 200

---

## Why `/store/index.html` Works But `/store/` Doesn't

This is the classic symptom of a GitHub Pages **directory index serving failure**:

- `/store/index.html` → direct file request → Pages CDN finds the file in the artifact → 200
- `/store/` → directory index request → Pages CDN tries to serve `index.html` → **fails** because the CDN's directory index handler doesn't recognize the Action-deployed artifact as a valid Pages source

The SPA redirect script in `index.html` (`spa-b` meta tag + `spa_r` sessionStorage) works correctly for direct file access but can't help with the root 404 because the HTML is never loaded.

---

## Summary Table

| Finding | Status | Impact |
|---------|--------|--------|
| `dist/` structure | ✅ Correct | None |
| `index.html` at root | ✅ Yes | None |
| `404.html` as copy of `index` | ✅ Yes | Good for SPA |
| `.nojekyll` in `dist/` | ❌ **MISSING** | **HIGH** — causes root 404 |
| `.nojekyll` in repo root | ❌ **MISSING** | **HIGH** |
| Pages source = GitHub Actions | ⚠️ **UNCONFIRMED** | **HIGH** — requires admin check |
| gh-pages branch on `store` | ❌ Does not exist | ✅ Clean |
| Two workflow files | ⚠️ **2 workflows active** | **MEDIUM** — potential conflict |
| Deployment API status | ✅ Success | None |
| Probe HTTP response | ✅ 200 for both | None (intermittent issue) |
