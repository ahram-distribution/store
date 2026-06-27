# ACTIVE ROLE MODEL — نموذج الأدوار الفعلي

> **التاريخ:** 2026-10-03 (مُحدّث)  
> **الهدف:** تصنيف كل دور حسب وجوده الفعلي في النظام  
> **ملاحظة**: نموذج الصلاحيات الأساسي (session، capabilities، visibility) موثق في `SYSTEM_REFERENCE_CURRENT_STATE.md` Section 3. هذه الوثيقة تركز على تحليل الأدوار (variants، hardcoded checks، workspace routing).

---

## التصنيف

| التصنيف | المعنى |
|---------|--------|
| **ACTIVE** | موجود في قاعدة البيانات + مستخدم في الكود + ممنوح لموظف واحد على الأقل |
| **ACTIVE (seed)** | موجود في قاعدة البيانات لكن ليس بالضرورة ممنوحاً لموظف |
| **LEGACY** | مذكور في الكود أو RPCs لكن له بديل أحدث |
| **DUPLICATE** | تكرار لدور آخر (مجرد alias) |
| **DEPRECATED** | في DashboardPage للأدوار القديمة (غير موجودة في DB) |

---

## 1. الأدوار المزروعة في قاعدة البيانات (Seeded)

| الدور | ملف المهاجرة | is_system |
|-------|-------------|-----------|
| `مدير البيع` | `20260611_phase2_sales_hierarchy_cleanup.sql` | true |
| `SUPER_ADMIN` | `20260615_identity_rules_final.sql` | true |
| `سوبر أدمن` | `20260615_identity_rules_final.sql` | true |
| `سيلز داخلي` | `20260706_role_normalization.sql` | true |
| `الإدارة العليا` | `20260720_unify_upper_management_role.sql` | true |

**ملاحظة:** `سيلز داخلي` و `الإدارة العليا` هما أحدث دورين — `الإدارة العليا` هو الدور الموحد للإدارة العليا.

---

## 2. الأدوار الممنوحة فعلياً لموظفين (Active)

هذا يتطلب فحص قاعدة البيانات الفعلية. بناءً على تحليل الكود:

| الدور | منح لموظفين؟ | ملاحظة |
|-------|-------------|--------|
| `الإدارة العليا` | ✅ (على الأقل موظف واحد) | يُستخدم في `is_upper_management()` |
| `مدير البيع` | ✅ (على الأقل موظف واحد) | يُستخدم في Dashboard routing |
| `مندوب مبيعات` | ✅ (على الأقل موظف واحد) | الدور الأساسي للمناديب |
| `سيلز داخلي` | ❓ غير مؤكد | دور جديد — قد لا يكون ممنوحاً بعد |
| `SUPER_ADMIN` | ❓ غير مؤكد | يُستخدم في RPCs لكن قد لا يُمنح مباشرة |
| `سوبر أدمن` | ❓ غير مؤكد | بديل عربي لـ SUPER_ADMIN |

**تحذير:** هذا يتطلب تأكيداً من قاعدة البيانات الحية — لا يمكن معرفته من تحليل الكود فقط.

---

## 3. جميع الأدوار في الكود الأمامي (Frontend)

### 3.1 من `roleNormalization.ts` (7 أدوار قانونية)

| الدور القانوني | المصادر (variants) |
|----------------|-------------------|
| **الإدارة العليا** | `الإدارة العليا`, `SUPER_ADMIN`, `ADMIN`, `CHAIRMAN`, `EXECUTIVE_MANAGER`, `سوبر أدمن`, `سوبرادمن`, `رئيس مجلس الإدارة`, `أدمن`, `ادمن`, `مدير تنفيذي`, `superadmin`, `super_admin`, `administrator` |
| **مدير بيع** | `مدير البيع`, `مدير مبيعات`, `مدير المبيعات`, `Sales Manager`, `sales_manager`, `salesmanager`, `sales_director`, `salesdirector`, `sales`, `supervisor`, `مشرف مبيعات`, `سوبر فايزر`, `مشرف`, `SUPERVISOR` |
| **مندوب مبيعات** | `مندوب مبيعات`, `sales_rep`, `salesrep`, `مندوب` |
| **مشرف عام** | `general_supervisor`, `generalsupervisor`, `مشرف تنفيذي` |
| **مدير مخزن** | `warehouse_manager`, `warehousemanager`, `مدير مستودع`, `warehouse`, `مستودع` |
| **سيلز داخلي** | `سيلز داخلي` |
| **عميل** | (identity_type) |

### 3.2 من `DashboardPage.tsx` (Workspace Routing)

| الدور في الـ Hierarchy | الـ Workspace |
|------------------------|---------------|
| `الإدارة العليا` ✅ | UpperManagementDashboard |
| `مدير بيع` ✅ | SalesManagerCCPage |
| `مشرف عام` ✅ | SalesManagerCCPage |
| `مندوب مبيعات` ✅ | SalesRepWorkDay |
| `مدير مخزن` ✅ | WarehouseManagerWorkspace |
| `سيلز داخلي` ✅ | ManagementDashboard |

### 3.3 أدوار Deprecated في DashboardPage (9 أدوار)

| الدور | الـ Workspace | ملاحظة |
|-------|---------------|--------|
| `warehouse` | WarehouseDashboard | دور قديم |
| `delivery` | WarehouseDashboard | دور قديم |
| `collector` | ManagementDashboard | دور قديم |
| `accountant` | ManagementDashboard | دور قديم |
| `purchasing_manager` | ManagementDashboard | دور قديم |
| `secretary` | ManagementDashboard | دور قديم |
| `security` | ManagementDashboard | دور قديم |
| `buffet` | ManagementDashboard | دور قديم |
| `data_entry` | ManagementDashboard | دور قديم |

**كل هذه الأدوار غير موجودة في قاعدة البيانات — لا يمكن منحها لأي موظف. شفراتها في DashboardPage لا تؤدي إلى أي شيء.**

---

## 4. جميع الأدوار في RPCs

### 4.1 فحص الإدارة العليا (Visibility Bypass)

| النمط | عدد مرات الظهور | الحالة |
|-------|-----------------|--------|
| `r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')` | ~45 مرة في 32+ ملف | **LEGACY** — يجب استبداله بـ `is_upper_management()` |
| `r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')` | ~30 مرة | **LEGACY** — نفس الشيء |
| `is_upper_management(v_session.employee_id)` | ~20 مرة (جديد) | **ACTIVE** — المعيار الجديد |
| `r.name = 'الإدارة العليا'` | 3 مرات (جديد) | **ACTIVE** — التحقق الموحد |

### 4.2 فحص الأدوار الموسع (Authorization Gate)

| النمط | عدد مرات الظهور |
|-------|-----------------|
| `r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN','EXECUTIVE_MANAGER','Sales Manager')` | ~5 مرات |

### 4.3 تصنيف الأدوار (Role Classification — `role_type` output)

| الـ `role_type` الناتج | الشروط |
|------------------------|--------|
| `'مدير البيع'` | `مدير البيع` أو `مدير تنفيذي` |
| `'سوبر فايزر'` | `مشرف مبيعات` أو `مشرف تنفيذي` |
| `'مندوب'` | كل ما تبقى |
| `'مدير'` | (في RPC واحد فقط) |

---

## 5. التصنيف النهائي لكل دور

| الدور | في DB (seeded) | في RPCs | في Frontend | ممنوح لموظف | التصنيف النهائي |
|-------|---------------|---------|-------------|-------------|-----------------|
| `الإدارة العليا` | ✅ | ✅ (جديد) | ✅ | ✅ | **ACTIVE** |
| `مدير البيع` | ✅ (`مدير البيع`) | ✅ | ✅ | ✅ | **ACTIVE** |
| `مندوب مبيعات` | ❌ | ✅ (تصنيف) | ✅ | ✅ | **ACTIVE** (مرجعي) |
| `سيلز داخلي` | ✅ | ❌ | ✅ | ❓ | **ACTIVE (seed)** |
| `مشرف عام` | ❌ | ❌ (فقط `مشرف تنفيذي`) | ✅ | ❓ | **ACTIVE** (مرجعي) |
| `مدير مخزن` | ❌ | ❌ | ✅ | ❓ | **ACTIVE** (مرجعي) |
| `SUPER_ADMIN` | ✅ | ✅ (~45) | ✅ (normalized) | ❓ | **LEGACY** → الإدارة العليا |
| `سوبر أدمن` | ✅ | ✅ (~30) | ✅ (normalized) | ❓ | **LEGACY** → الإدارة العليا |
| `ADMIN` / `أدمن` | ❌ | ✅ (~45) | ✅ (normalized) | ❌ | **LEGACY** → الإدارة العليا |
| `CHAIRMAN` / `رئيس مجلس الإدارة` | ❌ | ✅ (~45) | ✅ (normalized) | ❌ | **LEGACY** → الإدارة العليا |
| `EXECUTIVE_MANAGER` / `مدير تنفيذي` | ❌ | ✅ (~8) | ✅ (normalized) | ❌ | **LEGACY** → الإدارة العليا |
| `مشرف مبيعات` / `supervisor` | ❌ | ✅ (~8) | ✅ (normalized) | ❌ | **LEGACY** → مدير بيع |
| `سوبر فايزر` | ❌ | ✅ (مخرج تصنيف) | ✅ | ❌ | **LEGACY** → مدير بيع |
| `مدير مبيعات` | ❌ | ✅ (قديم) | ✅ | ❌ | **LEGACY** → مدير بيع |
| `مشرف` | ❌ | ✅ (قديم) | ✅ (normalized) | ❌ | **LEGACY** → مدير بيع |
| `مشرف تنفيذي` | ❌ | ✅ (تصنيف) | ✅ | ❌ | **LEGACY** → مشرف عام |
| `مندوب` | ❌ | ✅ (مخرج تصنيف) | ✅ | ❌ | **LEGACY** → مندوب مبيعات |
| `Sales Manager` | ❌ | ✅ (قديم) | ✅ (normalized) | ❌ | **LEGACY** → مدير بيع |
| `warehouse` | ❌ | ❌ | ✅ (deprecated) | ❌ | **DEPRECATED** |
| `delivery` | ❌ | ❌ | ✅ (deprecated) | ❌ | **DEPRECATED** |
| `collector` | ❌ | ❌ | ✅ (deprecated) | ❌ | **DEPRECATED** |
| `accountant` | ❌ | ❌ | ✅ (deprecated) | ❌ | **DEPRECATED** |
| `purchasing_manager` | ❌ | ❌ | ✅ (deprecated) | ❌ | **DEPRECATED** |
| `secretary` | ❌ | ❌ | ✅ (deprecated) | ❌ | **DEPRECATED** |
| `security` | ❌ | ❌ | ✅ (deprecated) | ❌ | **DEPRECATED** |
| `buffet` | ❌ | ❌ | ✅ (deprecated) | ❌ | **DEPRECATED** |
| `data_entry` | ❌ | ❌ | ✅ (deprecated) | ❌ | **DEPRECATED** |

---

## 6. الخلاصة

| الفئة | العدد |
|-------|-------|
| **ACTIVE** (في DB + يمنح + يُستخدم) | 3-5 أدوار |
| **LEGACY** (مذكور في الكود لكن له بديل) | ~15 دوراً |
| **DEPRECATED** (في DashboardPage فقط، لا يُمنح) | 9 أدوار |
| **ACTIVE (seed)** (في DB لكن غير مؤكد المنح) | 2 دور |

**الأدوار الفعلية العاملة في النظام حالياً (بناءً على الهيكل الإداري):**

1. **الإدارة العليا** ← UpperManagementDashboard + is_upper_management bypass
2. **مدير بيع** ← SalesManagerCCPage + Attendance operations
3. **مندوب مبيعات** ← SalesRepWorkDay + Attendance runtime
4. **مدير مخزن** ← WarehouseManagerWorkspace
5. **سيلز داخلي** ← ManagementDashboard

**جميع الأدوار الأخرى (16+ دوراً) غير ممنوحة ولا يمكن الوصول إليها — يجب إما إزالتها من الكود أو تبرير الحاجة إليها.**

---

### ملاحظة أمنية

تكوين GRANT والـ RLS Policies موثق في `SYSTEM_REFERENCE_CURRENT_STATE.md` Section 1.7 (Security Configuration).  
ملخص سريع: جميع الـ Functions من نوع SECURITY DEFINER، مع GRANT شامل (`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated`) منذ 2026-07-08.
