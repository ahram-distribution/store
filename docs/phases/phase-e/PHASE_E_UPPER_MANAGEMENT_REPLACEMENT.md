# Phase E — Upper Management Replacement

**Status:** Design Proposal — Pending Owner Review
**Date:** 2026-12-27
**Based on:** Phase D (Hierarchy RPC + HierarchyTargetPage), Roadmap v3

---

## 1. Overview

### Goal

Build the 4 official Upper Management screens that will **replace** all existing target/performance/activity screens. At the end of Phase E, no old screen has been deleted yet, but the new screens are functionally complete and ready for the final Replacement phase.

### The 4 Official Screens

| # | Screen | Focus | Answers |
|---|--------|-------|---------|
| 1 | **النشاط** | Activity metrics (visits, orders, new customers) | "ماذا قام الفريق بعمله؟" |
| 2 | **الإنجاز** | Results (sales, target %, hierarchy, 6 KPIs) | "ماذا تحقق بالفعل؟" |
| 3 | **الأوزان** | KPI weight configuration | "كيف نحسب الأداء؟" |
| 4 | **التارجت** | Target input/distribution | "ما المطلوب تحقيقه؟" |

### Routes (Owner Approved ✅)

| Screen | Route | Notes |
|--------|-------|-------|
| النشاط | `/dashboard/activity` | New — replaces `/runtime/activity` |
| الإنجاز | `/dashboard/achievement` | New — absorbs `/targets/hierarchy` |
| الأوزان | `/dashboard/weights` | New — replaces `/dashboard/company-targets` |
| التارجت | `/dashboard/targets` | New — replaces `/dashboard/employee-targets` |

All 4 screens under the existing `/dashboard` namespace for consistency.

All 4 screens accessible from the Upper Management Dashboard launcher (`/dashboard`).

---

## 2. Screen 1 — النشاط (Activity)

### 2.1 Purpose

Show **what the team did** — raw activity counts, not weighted performance.

### 2.2 Data Displayed

| Metric | Source | Type |
|--------|--------|------|
| إجمالي المبيعات المُنشأة | `get_runtime_activity` | amount (EGP) |
| الطلبات المُنشأة | `get_runtime_activity` | count |
| الزيارات المُنجزة | `get_runtime_activity` | count |
| العملاء الجدد المُسجلين | `get_runtime_activity` | count |

4 KPIs only (Owner Approved ✅):
- المبيعات المُنشأة (وليست المستلمة)
- الطلبات غير الملغاة
- الزيارات المكتملة
- العملاء الجدد المُسجلين

Collections and attendance remain in the system (Phase F) but are NOT displayed in this screen. No backend/RPC field renaming — any display name changes are UI-only.

### 2.3 Hierarchy Levels

| Level | View | Description |
|-------|------|-------------|
| **L1 — Company** | Manager cards | Each manager's total activity (sales, orders, visits, customers) + progress bars |
| **L2 — Team** | Member table | List of team members under selected manager with their activity counts |
| **L3 — Individual** | Activity detail | Large cards showing each activity metric for the selected employee |

### 2.4 Period Filter

Dropdown with: اليوم / أمس / الأسبوع / الشهر / مخصص (date range).

### 2.5 Data Source

Use existing `get_runtime_team_activity(p_manager_employee_id, p_date_from, p_date_to)` and `get_runtime_activity(p_employee_id, p_date_from, p_date_to)` RPCs. These are already deployed and return the correct data shape.

No new RPCs needed.

### 2.6 Navigation

```
الإدارة العليا → شاشة النشاط → (اختيار فترة) → (اختيار مدير) → (اختيار فرد)
```

### 2.7 Comparison with Old TeamActivity

| Feature | Old (`/runtime/activity`) | New (`/upper/activity`) |
|---------|--------------------------|------------------------|
| Data | Same 4 KPIs | Same 4 KPIs |
| Levels | Company → Team → Rep | Same (cleaned up) |
| Period | Day/Yesterday/Week/Month/Custom | Same |
| Layout | Existing | Redesigned with card-based UI |
| Entry | From dashboard launcher | From dashboard launcher (same) |

---

## 3. Screen 2 — الإنجاز (Achievement)

### 3.1 Purpose

Show **what was achieved** — weighted performance, target achievement, hierarchy drill-down with 6 KPI cards.

This is the evolution of `HierarchyTargetPage`.

### 3.2 What Changes from HierarchyTargetPage

| Current (`HierarchyTargetPage`) | New (`/upper/achievement`) |
|-------------------------------|---------------------------|
| 3 levels: Company → Manager → Member | 4 levels: Company → Manager → Member → KPI Detail |
| Sales-only target/actual in tables | All-KPI target/actual in tables |
| 6 KPI cards only at Level 3 | 6 KPI cards at Level 2 (manager) AND Level 3 (member) |
| No KPI contributor drill-down | Click KPI → shows contributor list (from PerformanceAnalysis) |
| No customer-level drill-down | Click employee → customer breakdown (from EmployeeAnalysis) |
| Single-column KPI cards | Improved card layout |
| Basic company overview | Full company overview with all 6 KPI progress bars |

### 3.3 Additional Features (from Old Screens)

**From PerformanceAnalysisPage:**
- KPI contributor drill-down: Click a KPI percentage → show ranked list of all employees for that KPI
- Per-employee customer breakdown: Click an employee → show their customer-level data

**From EmployeeAnalysisPage:**
- Per-employee analysis with 5 KPI contributor sources merged
- Per-employee customer drill-down with orders detail

### 3.4 Hierarchy Levels

| Level | View | Description |
|-------|------|-------------|
| **L1 — Company** | Company summary + Manager table | Company: all 6 KPI totals + progress bars. Managers table sorted by `team_overall_pct DESC` |
| **L2 — Manager Team** | Team summary + Members table | Manager's own 6 KPI cards + team summary (all 6 KPIs) + members table |
| **L3 — Member** | Member KPI cards | 6 KPI cards (sales, orders, visits, new_customers, collections, attendance) |
| **L4 — KPI Detail** | Contributor list / Customer list | When clicking a KPI at L3 → ranked contributors. When clicking employee name → customer breakdown |

### 3.5 Data Source

Primary: `get_governed_target_performance(p_month, p_year, p_token)` — already returns company + employees + hierarchy with all 6 KPIs.

For drill-downs (L4): `get_kpi_contributors`, `get_team_members_kpis`, `get_rep_customer_kpis`, `get_customer_delivered_orders` — all existing RPCs.

No new RPCs needed.

### 3.6 What Remains from HierarchyTargetPage

- The 3-level drill-down structure
- Manager ordering by `team_overall_pct DESC`
- 6 KPI cards with colored progress bars
- Team summary with all 6 KPIs
- Unassigned employee handling

### 3.7 What Is Removed from HierarchyTargetPage

- The `/targets/hierarchy` route (replaced by `/upper/achievement`)
- The separate `HierarchyTargetPage.tsx` component (absorbed into new achievement component)

---

## 4. Screen 3 — الأوزان (Weights)

### 4.1 Purpose

Pure configuration screen. **No performance data, no reports, no summaries.**

### 4.2 What It Shows

- Month/Year selector (same as current)
- 6 weight input fields (numbers that must sum to 100%)
- Total indicator (green checkmark if 100%, red X otherwise)
- Save button (disabled if sum ≠ 100%)

### 4.3 What Is Removed from CompanyTargetsPage

| Current Feature | Action |
|----------------|--------|
| Performance summary (employee count, avg achievement, top employee) | **Removed** — belongs in الإنجاز |
| Target values display (sales_target, sales_actual) | **Removed** — belongs in التارجت |
| Company weight editing | **Kept** |
| Validation (sum = 100%) | **Kept** |

### 4.4 Data Source

- Read: `get_governed_company_monthly_target(p_month, p_year, p_token)`
- Write: `governed_upsert_company_monthly_target(p_...)`

No new RPCs needed.

### 4.5 Weight Fields (6)

| Field | Default | Currently |
|-------|---------|-----------|
| المبيعات | 75 | 35 |
| الطلبات | 7.5 | 7.5 |
| الزيارات | 7.5 | 15 |
| العملاء الجدد | 10 | 15 |
| التحصيل | 0 | 20 |
| الحضور والانضباط | 0 | 15 |

Default values follow the approved Phase C2 policy. The form reads the actual DB value for the selected month.

---

## 5. Screen 4 — التارجت (Targets)

### 5.1 Purpose

One unified screen for **all target management**:

- Company-level target (total company goals)
- Manager-level target distribution
- Individual employee target editing

### 5.2 Company Target Section

Input fields for company-level monthly targets:

| Field | Type | Note |
|-------|------|------|
| هدف المبيعات | number (EGP) | Company total sales target |
| هدف الزيارات | number (count) | Company total visits target |
| هدف الطلبات | number (count) | Company total orders target |
| هدف العملاء الجدد | number (count) | Company total new customers target |
| هدف التحصيل | number (EGP) | Company total collections target |

These are saved via `governed_upsert_company_monthly_target`.

**Important:** The old CompanyTargetsPage also saves these targets with the weights. The new system **separates** targets (in شاشة التارجت) from weights (in شاشة الأوزان). The RPC will still handle both in a single call, but the UI is split.

### 5.3 Manager Target Distribution

After setting the company target, a table shows all managers with:

| Column | Description |
|--------|-------------|
| Manager name | Read-only |
| Current target | Current assigned target |
| Company target | Total company target (read-only reference) |
| Input field | New target for this manager |
| Share % | Auto-calculated: manager target / company target |

Validation: Sum of all manager targets must equal company target (or be within a tolerance).

### 5.4 Individual Employee Target Editing

When drilling into a manager, show a table of their team members with editable target fields:

| Column | Description |
|--------|-------------|
| Employee name | Read-only |
| Target fields | sales_target, visits_target, orders_target, new_customers_target, collections_target |
| Current actual | Read-only reference (from KPI contributors) |
| Achievement % | Auto-calculated |

Also accessible directly without going through company → manager: a search/filter to find any employee and edit their targets.

### 5.5 Business Rules (Owner Approved ✅)

1. **Month selection:** Current month or future months
2. **Past months:** View-only — targets cannot be modified **عرض للقراءة فقط**
3. **Validation before save:**
   - All target values must be ≥ 0
   - Manager target sum ≤ company target (warning, not block)
4. **Auto-distribution (seeding):** Button to auto-distribute company target to managers using `seed_sales_rep_monthly_targets` **تلقائي + يدوي**

### 5.6 Data Sources

| Operation | RPC |
|-----------|-----|
| Read company target | `get_governed_company_monthly_target` |
| Write company target | `governed_upsert_company_monthly_target` |
| Read employee targets | `get_governed_employee_monthly_targets` |
| Write employee target | `governed_upsert_employee_monthly_target` |
| Read actual values | `get_kpi_contributors` (5 KPIs) |
| Auto-distribute | `seed_sales_rep_monthly_targets` |

---

## 6. Replacement Plan — Old → New Mapping

### 6.1 Screen Mapping

| Old Screen | Old Route | Replaced By | New Route |
|-----------|-----------|-------------|-----------|
| `CompanyTargetsPage` | `/dashboard/company-targets` | شاشة الأوزان (weights part) + شاشة التارجت (targets part) | `/upper/weights` + `/upper/targets` |
| `EmployeeTargetsPage` | `/dashboard/employee-targets` | شاشة التارجت (individual section) | `/upper/targets` |
| `PerformanceAnalysisPage` | `/dashboard/performance` | شاشة الإنجاز (KPI drill-down) | `/upper/achievement` |
| `EmployeeAnalysisPage` | `/dashboard/employee-analysis` | شاشة الإنجاز (employee detail) | `/upper/achievement` |
| `TeamAchievement` | `/runtime/achievement` | شاشة الإنجاز | `/upper/achievement` |
| `TeamActivity` | `/runtime/activity` | شاشة النشاط | `/upper/activity` |
| `ModuleLauncherPage` (targets section) | `/launcher/targets` | يُلغى — no replacement needed | — |
| `HierarchyTargetPage` | `/targets/hierarchy` | تندمج في شاشة الإنجاز | `/upper/achievement` |

### 6.2 File Replacement

| File | Will Be Deleted When |
|------|---------------------|
| `src/pages/dashboard/CompanyTargetsPage.tsx` | After شاشة الأوزان + شاشة التارجت approved |
| `src/pages/dashboard/EmployeeTargetsPage.tsx` | After شاشة التارجت approved |
| `src/pages/dashboard/PerformanceAnalysisPage.tsx` | After شاشة الإنجاز approved |
| `src/pages/dashboard/EmployeeAnalysisPage.tsx` | After شاشة الإنجاز approved |
| `src/pages/TeamAchievement.tsx` | After شاشة الإنجاز approved |
| `src/pages/TeamActivity.tsx` | After شاشة النشاط approved |
| `src/pages/target-runtime/HierarchyTargetPage.tsx` | After شاشة الإنجاز approved |
| `src/pages/target-runtime/TargetRuntimePage.tsx` | (Already no route — dead code) |
| `src/pages/dashboard/ModuleLauncherPage.tsx` (targets section) | After all 4 screens approved |

### 6.3 Route Replacement

| Old Route | Will Be Removed When |
|-----------|---------------------|
| `/dashboard/company-targets` | After شاشة الأوزان + شاشة التارجت approved |
| `/dashboard/employee-targets` | After شاشة التارجت approved |
| `/dashboard/performance` | After شاشة الإنجاز approved |
| `/dashboard/employee-analysis` | After شاشة الإنجاز approved |
| `/runtime/achievement` | After شاشة الإنجاز approved |
| `/runtime/activity` | After شاشة النشاط approved |
| `/targets/hierarchy` | Replaced by `/upper/achievement` |

### 6.4 Upper Management Dashboard Launcher Changes

Current entries to be added/replaced:

| Current Entry | Action |
|---------------|--------|
| نشاط الشركة → `/runtime/activity` | Replace with → النشاط → `/upper/activity` |
| إنجاز الشركة → `/runtime/achievement` | Replace with → الإنجاز → `/upper/achievement` |
| التسلسل الهرمي → `/targets/hierarchy` | Replace with → merge into الإنجاز |
| الأهداف → `/launcher/targets` (sub-launcher) | Replace with → التارجت → `/upper/targets` |
| (no direct weights entry) | Add → الأوزان → `/upper/weights` |

---

## 7. Navigation Flow

```
الإدارة العليا (/dashboard)
  ├── 🏃 النشاط      →  /upper/activity
  │                      Level 1: Company (manager cards)
  │                      Level 2: Team (members table)
  │                      Level 3: Individual (4 detail cards)
  │
  ├── 🏆 الإنجاز     →  /upper/achievement
  │                      Level 1: Company (6 KPI summary + manager table)
  │                      Level 2: Manager Team (team summary + members)
  │                      Level 3: Individual (6 KPI cards)
  │                      Level 4: KPI Detail / Customer Detail
  │
  ├── ⚖️ الأوزان     →  /upper/weights
  │                      Month select + 6 weight inputs + save
  │
  └── 🎯 التارجت     →  /upper/targets
                         Company target → Manager distribution → Individual editing
```

From any screen: "← العودة" button goes back to previous level or to `/dashboard`.

---

## 8. Execution Plan

| Step | Description | Est. Effort | Depends On |
|------|-------------|-------------|------------|
| 1 | **Design Approval** — this document | — | — |
| 2 | **النشاط** — build `/upper/activity` component | Medium | Approval |
| 3 | **الأوزان** — strip CompanyTargetsPage down to pure weight form | Small | Approval |
| 4 | **التارجت** — build `/upper/targets` with company + manager + individual sections | Large | Approval |
| 5 | **الإنجاز** — evolve HierarchyTargetPage into `/upper/achievement` with drill-down | Large | Approval |
| 6 | **Upper Management Dashboard** — update launcher entries to point to new routes | Small | Steps 2-5 |
| 7 | **Verification** — functional testing of all 4 screens | Medium | Steps 2-6 |
| 8 | **Close Phase E** | — | Step 7 |

### Effort Legend

| Size | Meaning | Approx. time |
|------|---------|-------------|
| Small | Edit existing component | < 1 hour |
| Medium | New component, reuses existing patterns | 2-4 hours |
| Large | Complex new component with multiple views | 4-8 hours |

---

## 9. What Does NOT Change

| Item | Reason |
|------|--------|
| All existing RPCs | The backend is complete. All 4 screens use existing RPCs. |
| `get_governed_target_performance` return shape | The `hierarchy` key remains. New routes consume the same data. |
| Weight overrides per employee | This feature in EmployeeTargetsPage moves to شاشة التارجت. |
| Seed/auto-distribute functionality | Moves to شاشة التارجت. |
| Collections + Attendance (0/null) | Will be activated in Phase F. |

---

## Phase E — Progress

| Step | Screen | Status |
|------|--------|--------|
| — | 🔧 Service Worker: Navigation Strategy change | ✅ Deployed — in monitoring |
| 1 | الأوزان (`/dashboard/weights`) | ✅ Built — pending owner test |
| 2 | التارجت (`/dashboard/targets`) | ⬜ Not started |
| 3 | الإنجاز (`/dashboard/achievement`) | ⬜ Not started |
| 4 | النشاط (`/dashboard/activity`) | ⬜ Not started |

---

## Architectural Decision: Service Worker Navigation Strategy

### Context
After deploying Phase D and early Phase E builds, users occasionally experienced a transient 404 page when navigating to deep SPA routes (e.g., `/dashboard/weights`) immediately after a new deploy. The issue resolved on refresh.

### Root Cause
The Service Worker's navigation handler used **cache-first** strategy:
```js
caches.match('/store/index.html') || fetch('/store/index.html')
```
After deployment, the cached `index.html` (from the previous build) referenced old JS bundles with stale hashes. If those bundles were cleaned up during the new deploy, the browser failed to load them → 404.

### Change
Navigation handler changed to **network-first with cache fallback**:
```js
fetch('/store/index.html').catch(() => caches.match('/store/index.html'))
```

| Aspect | Before (Cache-first) | After (Network-first) |
|--------|:--------------------:|:---------------------:|
| After deploy | Serves stale cached index.html → 404 | Fetches fresh index.html → no 404 |
| During CDN propagation | Serves stale → possible 404 | Fails to fetch → cache fallback (stale but functional) |
| Offline | Serves from cache ✅ | Cache fallback ✅ |
| All other SW handlers | Unchanged | Unchanged |

### Reasoning
GitHub Pages already provides SPA fallback via `404.html = index.html`. The cache-first strategy was redundant for the online case and actively harmful after deployments. Network-first keeps offline support intact (via cache fallback) while ensuring fresh content after each deploy.

### Status
- **Commit:** `2a3e91e`
- **Run:** #155 ✅
- **Monitoring:** The fix is deployed and under observation. If the 404 issue does not reappear after several deployment cycles, the fix will be considered permanent.

---

## 10. Pending Decisions

| # | Decision | Status |
|---|----------|--------|
| 1 | Routes | ✅ `/dashboard/activity`, `/dashboard/achievement`, `/dashboard/weights`, `/dashboard/targets` |
| 2 | Activity KPIs | ✅ 4 مؤشرات فقط (مبيعات، طلبات، زيارات، عملاء جدد) |
| 3 | Target distribution | ✅ تلقائي + يدوي |
| 4 | Past months | ✅ عرض للقراءة فقط |

---

## 11. Design Decisions Summary

| Decision | Choice | Reason |
|----------|--------|--------|
| All 4 screens use existing RPCs | Yes | Backend is complete; only UI changes needed |
| Separate target input from weight config | Yes | Different concerns — "what to achieve" vs "how to measure" |
| Hierarchy becomes part of الإنجاز | Yes | الإنجاز IS the hierarchy — no need for a separate screen |
| KPI drill-down from الإنجاز | Yes | Replaces PerformanceAnalysis without duplication |
| النشاط uses runtime RPCs | Yes | Runtime RPCs already return correct activity data |
| All 4 screens under `/dashboard/` | `/dashboard/activity`, `/dashboard/achievement`, `/dashboard/weights`, `/dashboard/targets` | Consistent with existing dashboard namespace |
