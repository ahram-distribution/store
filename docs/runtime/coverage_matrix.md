# Phase 4: Coverage Matrix — RPC Verification Status

**Date:** 2026-06-30
**Status legend:** ✅ Verified (SQL traced & correct), ⚠️ Partial (needs DB query), ❌ Missing (no definition in repo), 🔧 Needs Fix (bug found), 🟢 خارج Source Control (موجود بالإنتاج فقط)

---

## Canonical RPCs (defined in migrations)

| # | RPC Name | Migration File | Year | Status | Notes |
|---|----------|---------------|------|--------|-------|
| 1 | `get_governed_target_performance` | `20261229_fix_company_target_source.sql` | 2026-12-29 | ✅ | Core KPI engine — SQL verified correct |
| 2 | `get_dashboard_management` | `20261001_f2_canonical_kpi_unification.sql` | 2026-10-01 | ✅ | SQL verified |
| 3 | `get_completed_workdays_history` | `20261001_f2_canonical_kpi_unification.sql` | 2026-10-01 | ✅ | SQL verified |
| 4 | `get_live_workday_overview` | `20261001_f2_canonical_kpi_unification.sql` | 2026-10-01 | ✅ | Real-time activity summary — SQL verified |
| 5 | `get_sales_reps_effort` | `20261001_f2_canonical_kpi_unification.sql` | 2026-10-01 | ✅ | Included in the f2 unification migration |
| 6 | `get_employee_day_map` | `20260727_fix_attendance_detail_rpcs.sql` | 2026-07-27 | ✅ | Haversine + 3 drift filters verified — يعيد حساب المسافة مباشرة |
| 7 | `end_workday` | `20260727_session_lifecycle_policy.sql` / `20261230_fix_session_distance_persistence.sql` | 2026 | ❓ Unknown | SQL يشير إلى أن `total_distance_meters` لا يُحدَّث — لكن لم يتم التحقق من DB الإنتاج الفعلية |
| 8 | `get_employee_monthly_targets` | `20261229_fix_company_target_source.sql` | 2026-12-29 | ✅ | Prorated target logic verified |
| 9 | `get_company_monthly_targets` | `20261229_fix_company_target_source.sql` | 2026-12-29 | ✅ | Aggregation logic verified |
| 10 | `get_effective_weights` | `20261229_fix_company_target_source.sql` | 2026-12-29 | ✅ | Cached weight logic verified |
| 11 | `get_employee_identity_id` | `20261001_f2_canonical_kpi_unification.sql` | 2026-10-01 | ✅ | Utility function |
| 12 | `get_employee_id_name` | `20261001_f2_canonical_kpi_unification.sql` | 2026-10-01 | ✅ | Utility function |

## Production Runtime RPCs (خارج Source Control)

| # | RPC Name | يعمل في الإنتاج | نتائجه صحيحة | Frontend يعتمد عليها | SQL في المشروع | الحالة |
|---|----------|-----------------|-------------|----------------------|---------------|--------|
| 13 | `get_runtime_activity` | ✅ | ✅ (يفترض) | ActivityScreen, SalesRepActivity, UpperManagementDashboard | ❌ غير موجود | 🟢 خارج Source Control |
| 14 | `get_runtime_team_activity` | ✅ | ✅ (يفترض) | ActivityScreen, UpperManagementDashboard | ❌ غير موجود | 🟢 خارج Source Control |
| 15 | `get_runtime_achievement` | ✅ | ✅ (يفترض) | SalesRepAchievement, TeamAchievement | ❌ غير موجود | 🟢 خارج Source Control |
| 16 | `get_runtime_achievement_with_targets` | ✅ | ✅ (يفترض) | SalesRepAchievement (باسمه) | ❌ غير موجود | 🟢 خارج Source Control |
| 17 | `get_runtime_team` | ✅ | ✅ (يفترض) | TeamAchievement | ❌ غير موجود | 🟢 خارج Source Control |

## Migration-only RPCs (not called from frontend, used internally)

| # | RPC Name | Purpose | Status | Notes |
|---|----------|---------|--------|-------|
| 17 | `get_geo_fence_employee_attendance` | Geo-fence validation | ✅ | |
| 18 | `get_employee_list_by_user` | Employee list for user | ✅ | |
| 19 | `search_by_text` | Full-text search | ✅ | |
| 20 | `get_user_nav_permissions` | Navigation permissions | ✅ | |
| 21 | `get_filter_options` | Filter options | ✅ | |
| 22 | `get_customer_summary` | Customer summary | ✅ | |
| 23 | `get_employee_basic_common_rank` | Employee ranking | ✅ | |
| 24 | `get_employee_day_info` | Employee day info | ✅ | |
| 25 | `get_customer_type_percentages` | Customer analytics | ✅ | |
| 26 | `get_range_customer_tree` | Customer tree | ✅ | |

## Attendance RPCs (called from attendance service)

| # | RPC Name | Status | Notes |
|---|----------|--------|-------|
| 27-55 | All 29 attendance RPCs | ✅ | All defined in migrations, wrapped by `src/services/attendance.ts` |

## Services (TypeScript wrappers)

| # | Service File | Status | Notes |
|---|-------------|--------|-------|
| S1 | `src/services/targets.ts` | ✅ | Wraps `get_governed_target_performance` |
| S2 | `src/services/attendance.ts` | ✅ | Wraps 29 attendance RPCs |
| S3 | `src/services/auth.ts` | ✅ | Auth logic |
| S4 | `src/services/excel.ts` | ✅ | Export logic |
| S5-N | `orders.ts`, `customers.ts`, `employees.ts`, `collections.ts`, `visits.ts` | ❌ Deleted | All removed from repo (both local & remote) |

## Technical Debt

| # | File | Issue | Impact | Recommended Fix |
|---|------|-------|--------|----------------|
| TD1 | `src/pages/dashboard/EmployeeAnalysisPage.tsx` | يستخدم `supabase.from('employees')`, `supabase.from('customers')`, `supabase.from('visits')` مباشرة — bypass للـ RPCs | بدون فحوصات صلاحية RLS/RPC | استبدال الاستعلامات المباشرة باستدعاءات RPC |

## Summary

| Category | Count |
|----------|-------|
| ✅ معرّفة في المشروع (Verified) | ~45 RPCs in migrations |
| 🟢 خارج Source Control (تعمل في الإنتاج) | 5 (runtime RPCs) |
| ❓ Unknown (بحاجة تحقق من DB الإنتاج) | 1 (end_workday — مسافة الثبات) |
| ❌ Deleted (ملفات خدمات محذوفة) | 5 (orders, customers, employees, collections, visits) |
| 📋 Technical Debt | 1 (EmployeeAnalysisPage) |
