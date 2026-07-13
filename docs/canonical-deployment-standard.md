# Ahram Runtime — Canonical Deployment Standard

> Single official deployment pipeline for the Ahram Runtime.
> No other deployment method exists.

---

## 1. State After Migration

### Removed
| Method | Tool | Reason |
|--------|------|--------|
| Manual `npm run deploy` | `gh-pages` npm package | Published stale `dist/`, no build check, overwrote CI deploys |
| `peaceiris/actions-gh-pages` step | GitHub Actions | Redundant — `actions/deploy-pages` is the official GitHub Pages deploy |
| `Debug` step | GitHub Actions | No longer needed (informational only) |

### Changed
| File | Change |
|------|--------|
| `package.json` | `deploy` script replaced with error message; `gh-pages` dependency removed |
| `.github/workflows/deploy.yml` | Removed Debug + peaceiris steps; added build ID generation + build-manifest generation + post-deploy verification |
| `vite.config.ts` | Added `define` for `__BUILD_ID__`/`__COMMIT_HASH__`; added `build-manifest` plugin (generates `dist/build-manifest.json`) |
| `src/sw.ts` | Cache name changed from static `ahram-v2` to `ahram-{BUILD_ID}` (versioned per deploy) |
| `src/vite-env.d.ts` | Added `__BUILD_ID__` and `__COMMIT_HASH__` global type declarations |
| `src/App.tsx` | Mounts `useSWUpdate` hook |

### Added
| File | Purpose |
|------|---------|
| `src/hooks/useSWUpdate.tsx` | SW update detection + toast notification ("نسخة جديدة متاحة") with reload button |

---

## 2. Canonical Pipeline

```
           ┌─────────────────────────────────────────────────────────┐
           │  Developer                                               │
           │  git add .                                               │
           │  git commit -m "feat: ..."                              │
           │  git push origin main                                    │
           └──────────────────────┬──────────────────────────────────┘
                                  │
                                  ▼
           ┌─────────────────────────────────────────────────────────┐
           │  GitHub Actions (deploy.yml)                            │
           │                                                         │
           │  1. actions/checkout@v7          exact commit           │
           │  2. actions/setup-node@v6 + ci   from lockfile          │
           │  3. Generate BUILD_ID            git rev-parse --short  │
           │  4. npm run build (vite)         BUILD_ID env var set   │
           │     ├─ define __BUILD_ID__        injected into bundles │
           │     ├─ define __COMMIT_HASH__                            │
           │     ├─ build-manifest plugin      writes sha256 hashes  │
           │     ├─ VitePWA                    47 precached assets   │
           │     └─ dist/ ready               content-hashed files   │
           │  5. Report build manifest         build_id + hashes     │
           │  6. Prepare deploy/               dist/* → deploy/      │
           │  7. actions/upload-pages-artifact to Pages CDN          │
           └──────────────────────┬──────────────────────────────────┘
                                  │
                                  ▼
           ┌─────────────────────────────────────────────────────────┐
           │  deploy job (needs build)                                │
           │                                                         │
           │  8. actions/deploy-pages@v4      updates GitHub Pages    │
           │  9. Post-deploy verification                             │
           │     ├─ sleep 30 (CDN propagation)                       │
           │     ├─ fetch build-manifest.json from production        │
           │     └─ log build_id + commit for comparison             │
           └──────────────────────┬──────────────────────────────────┘
                                  │
                                  ▼
           ┌─────────────────────────────────────────────────────────┐
           │  Browser (user)                                          │
           │                                                         │
           │  10. User visits /store/                                 │
           │  11. index.html loaded (or 10-min CDN cached)           │
           │  12. registerSW.js → navigator.serviceWorker.register   │
           │  13. Browser fetches /store/sw.js                        │
           │  14. Byte-diff detected → install event                 │
           │  15. skipWaiting() + precache into ahram-{BUILD_ID}     │
           │  16. activate → clients.claim() + delete old caches     │
           │  17. Fetch cache-first for GETs (except RPC)            │
           │  18. useSWUpdate detects update → toast "تحديث" button   │
           │  19. User clicks تحديث → page reloads with new bundles  │
           └─────────────────────────────────────────────────────────┘
```

---

## 3. Future Deployment Instructions

### For developers

To release a new version:

```bash
# 1. Make changes, commit, push
git add .
git commit -m "feat: description of changes"
git push origin main

# 2. Wait for CI (2-3 minutes)
# Monitor at: https://github.com/ahram-distribution/store/actions

# 3. Verify the build
# Open the workflow run → "Report build errors" step → confirm build_id
# Example: Build succeeded — build_id: a1b2c3d

# 4. Verify production deployment
# Visit: https://ahram-distribution.github.io/store/build-manifest.json
# Compare build_id with the CI output — they must match.
# Optionally compare sha256 hashes of individual assets.

# 5. Clear your local SW cache (if testing)
# DevTools → Application → Service Workers → Unregister
```

### What NOT to do

```bash
# DO NOT run these:
npm run deploy              # ERROR: prints message and exits
npx gh-pages -d dist        # bypasses CI entirely — not possible (gh-pages uninstalled)
```

### Architecture decisions

| Decision | Rationale |
|----------|-----------|
| **Only `git push` deploys** | Every deploy comes from a git commit — reproducible and auditable |
| **`actions/deploy-pages` only** | Official GitHub Pages action; no branch manipulation |
| **`build-manifest.json` generated by Vite plugin** | Every build produces it automatically (local + CI) |
| **`BUILD_ID` from commit hash** | Links deploy to exact commit; developer compares locally |
| **Versioned SW cache name** | `ahram-{BUILD_ID}` — clean slate per deploy; old caches auto-deleted |
| **Auto-update + user notification** | SW updates silently; user clicks "تحديث" to reload with new bundles |

---

## 4. Verification Checklist

After every deploy, confirm:

- [ ] CI workflow completed successfully (green checkmark)
- [ ] `build-manifest.json` exists at `https://ahram-distribution.github.io/store/build-manifest.json`
- [ ] `build_id` in production manifest matches CI output
- [ ] `commit_hash` in production manifest matches the git commit
- [ ] App loads at `https://ahram-distribution.github.io/store/`
- [ ] Service Worker registers (DevTools → Application → Service Workers)
- [ ] Cache name is `ahram-{build_id}` (DevTools → Application → Cache Storage)
- [ ] No console errors on page load
