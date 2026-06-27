# GITHUB PAGES STATUS

**Date:** 2026-06-16
**Scope:** Read-only inspection — no code, commit, or push

---

## Official Repo: `ahram-distribution/store`

| Property | Value |
|----------|-------|
| **Repository** | `https://github.com/ahram-distribution/store` |
| **Published URL** | `https://ahram-distribution.github.io/store/` |
| **Status** | ✅ **WORKING — LIVE** |
| **Deployment Method** | GitHub Actions (`actions/deploy-pages@v4`) — NOT branch-based |
| **Last Successful Run** | #13 — Commit `6d3d029` (Documentation Governance) — 1m 8s ✅ |
| **Previous Run** | #12 — Commit `98942c0` (PRODUCTION_HOTFIX) — 1m 1s ✅ |
| **Total Deployments** | 13 — all successful |
| **Trigger** | Push to `main` branch + `workflow_dispatch` |
| **SPA Redirect** | ✅ Present — `spa-b` meta tag = `/store/`, sessionStorage-based fallback |
| **Assets** | ✅ Absolute paths `/store/assets/...` |
| **JS Bundle** | `index-Cx77kA6A.js` |
| **CSS Bundle** | `index-CcODWI09.css` |
| **PWA** | ✅ Manifest, SW, favicons/Icons all at `/store/pwa/...` |
| **gh-pages Branch** | ✅ Exists (auto-managed by actions/deploy-pages) |

---

## Secondary Repo: `joker-alahram/ahram-distribution`

| Property | Value |
|----------|-------|
| **Repository** | `https://github.com/joker-alahram/ahram-distribution` |
| **Published URL** | `https://joker-alahram.github.io/ahram-distribution/` |
| **Status** | ⚠️ **WORKING — BUT OLDER BUILD** |
| **SPA Redirect** | ❌ **Missing** — no `spa-b` meta, no `spa_r` sessionStorage script |
| **JS Bundle** | `index-BZSaJ9hk.js` (different from store) |
| **CSS Bundle** | `index-CcODWI09.css` (same CSS version) |
| **Assets** | ⚠️ Relative paths `/ahram-distribution/assets/...` (different base) |
| **PWA** | ⚠️ Relative paths `pwa/...`, `manifest.webmanifest` |
| **gh-pages Branch** | ✅ Exists |
| **Notes** | This is an older build — pre-dates the SPA 404 fix, pre-dates the enforcement layer |

---

## Answer

**السؤال:** هل الرابط الصحيح الحالي هو `https://ahram-distribution.github.io/store/`؟

**الإجابة: نعم ✅** — هذا هو الرابط الرسمي والصحيح للتطبيق المنشور حالياً. يحتوي على جميع الإصلاحات الحديثة (SPA 404 routing fix, hotfixes, enforcement layer).

**رابط ثانوي موجود:** `https://joker-alahram.github.io/ahram-distribution/` — يعمل لكنه نسخة قديمة قبل الإصلاحات (ينقصه SPA fallback، enforcement layer).

---

## Live URLs Comparison

| Feature | `store` ✅ | `origin` ⚠️ |
|---------|-----------|-------------|
| SPA 404 Redirect | ✅ | ❌ |
| Hotfix 1 (Routing) | ✅ | ❌ |
| Hotfix 2 (Date Crash) | ✅ | ❌ |
| Hotfix 3 (WhatsApp Snapshot) | ✅ | ❌ |
| Enforcement Layer | ✅ | ❌ |
| PWA (icons/manifest) | ✅ `/store/pwa/...` | ⚠️ relative `pwa/...` |
| Latest Commit | `6d3d029` | Unknown |

---

## Summary

- **Official PRODUCTION URL:** `https://ahram-distribution.github.io/store/`
- **Last successful deployment:** Run #13 — commit `6d3d029` — 1m 8s
- **All 13 deployments succeeded** — pipeline is healthy
- **Environment:** `github-pages` — auto-configured via `actions/deploy-pages@v4`
- **Source:** GitHub Actions (not a branch) — Pages configured to use Action artifact
- **No manual Pages configuration needed** — the `deploy.yml` workflow auto-configures everything
