# Phase 8: Consistency Matrix — Screens vs Runtime Data Sources

**Date:** 2026-06-30
**Status:** Source code analysis complete. **طبقة Runtime معتمدة للتطوير.**

---

## 1. Screen-to-RPC Mapping

| الشاشة | الملف | RPC(s) المستخدمة | مصدر الـ RPC | ملاحظة |
|--------|-------|-----------------|-------------|--------|
| **ActivityScreen** | `dashboard/ActivityScreen.tsx` | `get_runtime_activity`, `get_runtime_team_activity` | 🟢 خارج Source Control (يعمل في الإنتاج) | النشاط الفردي + الجماعي |
| **SalesRepActivity** | `sales-rep/SalesRepActivity.tsx` | `get_runtime_activity` | 🟢 خارج Source Control | نشاط مندوب المبيعات |
| **SalesRepAchievement** | `sales-rep/SalesRepAchievement.tsx` | `get_runtime_achievement` | 🟢 خارج Source Control | إنجاز مندوب المبيعات |
| **TeamAchievement** | `sales-manager/TeamAchievement.tsx` | `get_runtime_team`, `get_runtime_achievement` | 🟢 كلاهما خارج Source Control | إنجاز الفريق + تفاصيل الأعضاء |
| **UpperManagementDashboard** | `dashboard/UpperManagementDashboard.tsx` | `get_runtime_team_activity`, `targetService.getPerformance()` | 🟢+✅ الأول خارج SC، الثاني موثّق | مؤشرات عليا + إجمالي الشركة |
| **ManagerReportsPage** | `reports/ManagerReportsPage.tsx` | `targetService.getPerformance()`, `get_live_workday_overview`, `get_completed_workdays_history` | ✅ كلها معتمدة | تقارير المدير الكاملة |
| **HierarchyTargetPage** | `target-runtime/HierarchyTargetPage.tsx` | `targetService.getPerformance()` | ✅ معتمدة | الهرم + KPI |
| **TargetRuntimePage** | `target-runtime/TargetRuntimePage.tsx` | `targetService.getPerformance()`, `get_governed_active_employees` | ✅ معتمدة | قائمة الموظفين + تجميع |
| **TargetsTab** | `dashboard/TargetsTab.tsx` | `get_governed_active_employees` | ✅ معتمدة | أهداف الموظفين |
| **PerformanceAnalysisPage** | `dashboard/PerformanceAnalysisPage.tsx` | `targetService.getPerformance()`, `get_kpi_contributors`, `get_team_members_kpis`, `get_rep_customer_kpis`, `get_customer_delivered_orders` | ✅ كلها معتمدة | تحليل KPI + المساهمون |
| **EmployeeAnalysisPage** | `dashboard/EmployeeAnalysisPage.tsx` | canonical RPCs + **`supabase.from()` مباشرة** | 📋 Technical Debt | يستخدم RPCs صحيحة + وصول مباشر للجداول |
| **WeightsTab** | `dashboard/WeightsTab.tsx` | RPCs الأوزان | ✅ معتمدة | إعدادات الأوزان |
| **SalesDashboard** | `dashboard/SalesDashboard.tsx` | `get_dashboard_sales` | ✅ معتمدة (موجودة في الترحيلات) | ملخص المبيعات |
| **AttendanceRuntimePage** | `attendance/runtime/AttendanceRuntimePage.tsx` | attendance RPCs + tracking engine | ✅ كلها في الترحيلات | الحضور والانصراف |
| **SalesManagerCCPage** | `sales-manager/SalesManagerCCPage.tsx` | governed_* RPCs (19) | ✅ كلها في الترحيلات | مركز القيادة |

---

## 2. ملاحظات Consistency

### ملاحظة أ: Runtime RPCs خارج Source Control
**الشاشات:** ActivityScreen, SalesRepActivity, SalesRepAchievement, TeamAchievement
**الحالة:** 🟢 تعمل في الإنتاج — ليست عائقًا للتطوير
**ملاحظة:** لا يمكن إعادة بناء DB من الترحيلات وحدها، لكن التطبيق الحالي يعمل بكفاءة

### ملاحظة ب: تعريفات KPI مزدوجة (نشاط vs إنجاز)
| عائلة الشاشات | RPC | اسم KPI العملاء الجدد | تعريف المبيعات |
|---------------|-----|----------------------|----------------|
| النشاط (runtime) | `get_runtime_activity` | `registered_customers` | غير معروف (بدون تعريف SQL في المشروع) |
| الإنجاز (canonical) | `get_governed_target_performance` | `new_customers` | طلبات مُسلَّمة بعد الخصم |

**ملاحظة:** لا يمكن تأكيد التطابق أو الاختلاف حتى استخراج تعريف RPC النشاط من DB الإنتاج

### ملاحظة ج: EmployeeAnalysisPage — Technical Debt
**الشاشة:** EmployeeAnalysisPage.tsx
**المشكلة:** يستخدم `supabase.from('employees')`, `supabase.from('customers')`, `supabase.from('visits')` مباشرة — bypass للـ RPCs
**التصنيف:** 📋 Technical Debt — لا يؤثر على صحة Runtime الحالية
**الإصلاح المقترح:** استبدال الاستعلامات المباشرة باستدعاءات RPC

### ملاحظة د: `get_dashboard_sales`
**الحالة:** ✅ معتمدة — موجودة في الترحيلات (`20261001_f2_canonical_kpi_unification.sql`)

---

## 3. ملخص تناسق مصادر البيانات

| عائلة البيانات | تُستخدم بواسطة | الحالة |
|----------------|---------------|--------|
| **Canonical (`get_governed_target_performance`)** | ManagerReportsPage, HierarchyTargetPage, TargetRuntimePage, PerformanceAnalysisPage, UpperManagementDashboard (جزئي) | ✅ معتمدة |
| **Runtime Activity (خارج Source Control)** | ActivityScreen, SalesRepActivity, UpperManagementDashboard (جزئي) | 🟢 تعمل في الإنتاج |
| **Runtime Achievement (خارج Source Control)** | SalesRepAchievement, TeamAchievement | 🟢 تعمل في الإنتاج |
| **Technical Debt (وصول مباشر)** | EmployeeAnalysisPage | 📋 للتحسين المستقبلي |
| **Attendance** | AttendanceRuntimePage, SalesManagerCCPage | ✅ معتمدة |

---

## 4. توصيات (غير عاجلة)

1. **استخراج RPCs الخمسة من DB الإنتاج** إلى ملفات ترحيل — مهمة تشغيلية
2. **توحيد تعريفات KPI** بين RPCs النشاط و RPCs canonical بعد استخراجها
3. **إصلاح EmployeeAnalysisPage** كأولوية Technical Debt
