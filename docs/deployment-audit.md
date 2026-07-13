# Ahram Runtime — Final Deployment Audit

> Complete trace of every byte path from `git add` to production delivery.
> Identifies all failure points, redundant components, canonical path, and removal path.

---

## 1. Complete Deployment Flow

### Path A — GitHub Actions (canonical candidate)

```
Git add → Git commit → Git push (main)
    │
    ▼
┌─────────────────────────────────────────────────┐
│ GitHub detects push to main branch              │
│ Triggers .github/workflows/deploy.yml           │
│                                                 │
│ Job: build                                       │
│   ├─ actions/checkout@v7                        │
│   │   Checkout exact commit (reproducible)      │
│   ├─ actions/setup-node@v6 + npm ci             │
│   │   Install from lockfile (reproducible)      │
│   ├─ Debug step (informational only)            │
│   ├─ npm run build (vite build)                 │
│   │   │                                         │
│   │   Vite build process:                       │
│   │   ├─ Resolve imports                        │
│   │   ├─ Compile TS → JS                        │
│   │   ├─ Compile CSS (Tailwind)                 │
│   │   ├─ Code-split chunks                      │
│   │   ├─ Content-hash filenames                 │
│   │   │  (e.g., index-BaWVlhnd.js)             │
│   │   ├─ Generate SW precache manifest          │
│   │   ├─ Generate sw.js (injectManifest)        │
│   │   ├─ Generate registerSW.js                 │
│   │   └─ Write dist/ directory                  │
│   │                                             │
│   ├─ Report build errors (always runs)          │
│   ├─ Prepare deploy directory                   │
│   │   ├─ mkdir deploy                           │
│   │   ├─ cp -r dist/* deploy/                   │
│   │   ├─ cp deploy/index.html deploy/404.html   │
│   │   └─ touch deploy/.nojekyll                 │
│   ├─ Upload Pages artifact                      │
│   │   Uploads deploy/ to GitHub Pages cache     │
│   ├─ peaceiris/actions-gh-pages@v4 (REDUNDANT)  │
│   │   Pushes deploy/ to gh-pages branch         │
│   │   force_orphan: true — REPLACES history     │
│   └─ [END build job]                            │
│                                                 │
│ Job: deploy (depends on build)                   │
│   └─ actions/deploy-pages@v4                    │
│       Deploys Pages artifact to GitHub Pages    │
│       Updates GitHub Pages service               │
│                                                 │
│ RESULT: gh-pages branch updated                 │
│         GitHub Pages CDN updated                │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│ GitHub Pages CDN                                 │
│ Serves from gh-pages branch                     │
│ Cache-Control: max-age=600 (index.html)         │
│ Cache-Control: max-age=31536000 (hashed assets) │
│                                                 │
│ User's browser requests /store/                 │
│   ├─ DNS: github.io → CDN edge                  │
│   ├─ CDN: serves index.html (or cached copy)    │
│   └─ Browser: parses HTML → fetches assets      │
│                                                 │
│ index.html → fetches:                           │
│   ├─ registerSW.js                              │
│   ├─ assets/index-BaWVlhnd.js                   │
│   ├─ assets/index-CYmYc1N7.css                  │
│   └─ ...other chunks (lazy-loaded)              │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│ Service Worker Lifecycle                         │
│                                                  │
│ 1. registerSW.js runs on window load             │
│    navigator.serviceWorker.register('/store/sw.js')│
│                                                  │
│ 2. Browser downloads sw.js                       │
│    Compares byte-for-byte with existing SW       │
│                                                  │
│ 3. If NEW (byte-diff):                           │
│    ├─ Install event fires                        │
│    │  ├─ self.skipWaiting() → bypasses waiting   │
│    │  └─ cache.addAll(precacheUrls)              │
│    │     Caches ALL assets into "ahram-v2" cache │
│    ├─ Activate event fires                       │
│    │  ├─ clients.claim() → controls all pages   │
│    │  ├─ Delete caches not named "ahram-v2"     │
│    │  └─ flushQueue() (sync tracking data)      │
│    └─ New SW controls page on NEXT navigation   │
│                                                  │
│ 4. If SAME (byte-match):                        │
│    └─ No install — existing SW continues        │
│                                                  │
│ 5. Fetch event (every request):                  │
│    ├─ RPC calls: PASS THROUGH (no cache)        │
│    ├─ Navigation: NETWORK-FIRST                 │
│    │  fetch('/store/index.html')                │
│    │  .catch → caches.match('/store/index.html')│
│    ├─ Other GETs: CACHE-FIRST                   │
│    │  caches.match(request)                     │
│    │  .then(found → serve, miss → fetch+store)  │
└─────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────┐
│ Browser Cache Lifecycle                          │
│                                                  │
│ HTML responses:                                  │
│   Cache-Control: max-age=600 (10 min CDN)       │
│   If CDN returns cached HTML → old bundle refs  │
│                                                  │
│ JS/CSS bundles (content-hashed):                 │
│   Cache-Control: max-age=31536000 (1 year)      │
│   Immutable — URL changes on content change     │
│   Old URLs eventually purged from CDN            │
│                                                  │
│ PWA Cache ("ahram-v2"):                         │
│   SW install → precaches all assets             │
│   SW fetch → cache-first for all GETs           │
│   Old assets stay cached until SW re-installs   │
│   SW re-install → overwrites same cache name    │
│   New hashes → cache miss → network fetch       │
└─────────────────────────────────────────────────┘
```

### Path B — Manual npm run deploy (to be removed)

```
Local developer runs: npm run deploy
    │
    ├─ Depends on dist/ existing (NO BUILD CHECK!)
    ├─ If dist/ stale → publishes OLD build
    ├─ Runs: gh-pages -d dist
    │   ├─ Reads dist/ directory contents
    │   ├─ Creates orphan commit on gh-pages branch
    │   ├─ Force-pushes to origin/gh-pages
    │   └─ OVERWRITES GitHub Actions deploy
    │
    └─ Result: gh-pages = local dist/ contents
               GitHub Pages updates (after CDN TTL)
```

---

## 2. Where Deployment Can Fail

| Step | Failure Mode | Current Handling | Severity |
|------|-------------|-----------------|----------|
| `npm ci` | Network/dependency issue | Step fails → workflow stops | High |
| `npm run build` | TypeScript error, missing module | Step fails → exit code trapped, "Build failed" warning emitted, **workflow continues to Report step, then STOPS** | High |
| `Upload Pages artifact` | Disk space, network | Step fails → `deploy` job skipped (depends on build) | High |
| `peaceiris/actions-gh-pages` | Auth failure, branch conflict | Step fails → no impact (deploy-pages still runs) | Low (redundant) |
| `actions/deploy-pages` | Auth failure, Pages not configured | Step fails → no deploy | High |
| CDN propagation | Edge cache stale | ~1-15 min delay before all edges serve new content | Medium |
| SW activation | User has page open, SW updates silently | New SW activated but **page content is already loaded** — user sees old version until reload | **Critical** |
| SW install failure | One precache URL fails → entire install fails | `cache.addAll()` fails → `waitUntil` rejects → SW **does not install** | **Critical** |
| Browser cache | index.html cached for 10 min | Old HTML references old bundles → old bundles served from PWA cache | Medium |
| Manual `npm run deploy` | Runs without `npm run build` first | Publishes stale `dist/` with ZERO warning | **Critical** |

---

## 3. Where Stale Content Can Appear

| Location | Cause | Time window | User visibility |
|----------|-------|-------------|-----------------|
| **CDN edge** (index.html) | `Cache-Control: max-age=600` | Up to 10 min after deploy | Browser loads old HTML → old bundle refs |
| **CDN edge** (hashed assets) | `Cache-Control: max-age=31536000` | Until CDN evicts old URL | Low (new HTML has new URLs) |
| **PWA cache "ahram-v2"** | SW install failed (one bad URL) | Forever — failed install never updates | User stuck on old SW indefinitely |
| **PWA cache "ahram-v2"** | SW cache-first returns old asset for same URL | Until SW reinstalls | Only if asset URL didn't change (rare with hashing) |
| **Browser memory** (current page) | SW auto-updated but page has old JS | Until user hard-refreshes | **Primary user-facing stale content** |
| **`dist/` directory** | Not rebuilt before deploy | Until next `npm run build` | **Primary deployment-stale content** |
| **gh-pages branch** | Manual deploy overwrites CI deploy | Until next CI deploy | Lost CI-deployed version |

---

## 4. Redundant Components

| Component | Redundancy | Reason |
|-----------|-----------|--------|
| **`peaceiris/actions-gh-pages@v4`** in deploy.yml | **FULLY REDUNDANT** | Workflow also calls `actions/deploy-pages@v4` which is the official GitHub Pages deploy action. The `peaceiris` step pushes to `gh-pages` branch with `force_orphan: true`, destroying deployment history, while `deploy-pages` handles the actual Pages update. The `gh-pages` branch is never read directly — GitHub Pages reads from the Pages deployment artifact, not the branch. |
| **`npm run deploy` script** in package.json | **FULLY REDUNDANT** | Duplicates CI functionality locally without safeguards (no build check, no commit requirement, no verification). Creates conflicting deploys. |
| **`gh-pages` npm package** (devDependency) | **FULLY REDUNDANT** | Only used by the `deploy` script. `peaceiris/actions-gh-pages` in CI is also redundant. Neither is needed — `actions/deploy-pages` is the sole required deploy mechanism. |
| **`Debug` step** in deploy.yml | **FULLY REDUNDANT** | Node/Vite/Tailwind version checks that succeed every time. Adds ~10s to every deploy. Was useful during setup, now noise. |

---

## 5. Deployment Paths — Canonical vs. Removal

### Two existing paths

```
Path A: git push → GitHub Actions → actions/deploy-pages → GitHub Pages
Path B: npm run deploy → gh-pages package → force-push gh-pages → GitHub Pages
```

### Path A (CANONICAL)

| Criteria | Status |
|----------|--------|
| Fresh build on every deploy | ✅ `npm run build` runs every time |
| Reproducible from git | ✅ `actions/checkout` checks exact commit |
| Build from lockfile | ✅ `npm ci` |
| Verifiable | ❌ No post-deploy hash verification |
| Consistent | ✅ Same every time |
| Type-checked | ❌ No `tsc` step (could fail build) |
| SW-notified | ❌ No versioned cache name |
| User-notified | ❌ No update prompt |
| Single source of truth | ✅ CI-only |

### Path B (REMOVAL)

| Criteria | Status |
|----------|--------|
| Fresh build on every deploy | ❌ No build step |
| Reproducible from git | ❌ Uses working tree, not git |
| Verifiable | ❌ |
| Consistent | ❌ Depends on local state |
| Conflict with Path A | ✅ Force-pushes over A's deploy |

### Decision

| Path | Action | Reason |
|------|--------|--------|
| **A** (GitHub Actions) | **Canonical — keep and strengthen** | Fully automated, git-committed, reproducible |
| **B** (manual deploy) | **Remove entirely** | Publishes stale builds, overwrites CI, no safeguards |

---

## 6. Complete JS Bundle Delivery Path (end-to-end)

```
1. Developer edits src/components/activity/MonthlyActivity.tsx
2. git add src/components/activity/MonthlyActivity.tsx
3. git commit -m "feat: update MonthlyActivity"
4. git push origin main
5. GitHub detects push, triggers deploy.yml
6. actions/checkout@v7 — checks out commit at step 3
7. npm ci — installs node_modules from lockfile
8. npm run build — vite build
   a. Compiles MonthlyActivity.tsx → JS
   b. Tree-shakes, bundles, code-splits
   c. Content-hashes output: index-XYZ123.js
   d. Updates SW precache manifest with new hash
   e. Generates sw.js with updated hash list
   f. Writes dist/assets/index-XYZ123.js
9. Prepare deploy/ — copies dist/* → deploy/
10. actions/upload-pages-artifact — uploads deploy/
11. actions/deploy-pages — deploys to GitHub Pages
12. GitHub Pages CDN serves new index.html + new sw.js
13. User's browser requests /store/
    a. CDN returns index.html (or 10-min cached version)
    b. index.html has <script src="/store/registerSW.js">
    c. registerSW.js calls navigator.serviceWorker.register('/store/sw.js')
    d. Browser fetches /store/sw.js
    e. SW is byte-different from previous → install event
    f. Install: skipWaiting() + precache new assets into "ahram-v2"
    g. Activate: clients.claim() + delete non-"ahram-v2" caches
    h. SW takes over — cache-miss on new hash → fetches index-XYZ123.js from network
    i. Returns new bundle to browser
    j. React renders new MonthlyActivity component
14. If user was already on the page:
    a. SW updates silently in background
    b. Page still has old JS in memory
    c. User must hard-refresh (or close/reopen) to get new JS
```

---

## 7. Summary Table

| # | Component | Status | Action |
|---|-----------|--------|--------|
| 1 | `.github/workflows/deploy.yml` | Canonical but needs fixes | Strengthen: add tsc, verification, remove redundant steps |
| 2 | `peaceiris/actions-gh-pages` step | Redundant | Remove from workflow |
| 3 | `actions/deploy-pages` step | Canonical | Keep |
| 4 | `Debug` step in workflow | Redundant | Remove |
| 5 | `npm run deploy` script | Dangerous | Replace with error message |
| 6 | `gh-pages` npm package | Redundant | Uninstall |
| 7 | `src/sw.ts` cache name | Static — no versioning | Inject build ID |
| 8 | `vite.config.ts` | No build ID injection | Add `define` for `__BUILD_ID__` |
| 9 | `registerSW.js` | autoUpdate mode | Keep, enhance with update listener |
| 10 | Client-side update detection | Missing | Add `useSWUpdate` hook |
| 11 | Post-deploy verification | Missing | Add to workflow |
| 12 | `build-manifest.json` | Missing | Generate in workflow |
| 13 | CDN cache (10-min HTML TTL) | Acceptable | Document as known delay |
