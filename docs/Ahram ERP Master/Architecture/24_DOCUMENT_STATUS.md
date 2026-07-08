# 24 – Document Status

**التصنيف:** حوكمة معمارية — حالة الوثائق  
**الغرض:** توثيق حالة كل وثيقة معمارية — أيها نشط، أيها ملغي، أيها مرجع تاريخي  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** ✅ نافذ

---

## 1. تصنيفات الحالة

| الحالة | المعنى | الإجراء |
|--------|--------|---------|
| **Canonical** | المرجع الرسمي — وثيقة معتمدة ونشطة | يُرجع إليها في كل قرار |
| **Historical** | معلومات سابقة — لم تعد المرجع | لا تُستخدم في القرارات الجديدة لكنها مفيدة للسياق |
| **Superseded** | مستبدلة بوثيقة أحدث | لا يُرجع إليها — تشير إلى البديل |
| **Draft** | مسودة غير معتمدة — قيد المراجعة | لا تُستخدم في التنفيذ |

---

## 2. جدول حالة الوثائق

### 2.1 TASK-001 — Architecture Baseline

| الرقم | الوثيقة | الحالة | السبب |
|-------|---------|--------|-------|
| 01 | CURRENT_ARCHITECTURE.md | 🔴 **Historical** | تحليل للوضع السابق — تم تجاوزه بالعمارة الجديدة |
| 02 | DATABASE_BASELINE.md | 🔴 **Historical** | مرجع لقاعدة البيانات الحالية — مفيد للسياق فقط |
| 03 | DATA_ACCESS_MAP.md | 🔴 **Historical** | 165+ نقطة وصول — معظمها سيتغير مع الترحيل |
| 04 | BUSINESS_RULES_MAP.md | 🔴 **Historical** | مستبدلة بـ 15_BUSINESS_CAPABILITIES.md (التنظيم الجديد) |
| 05 | MODULE_MAP.md | 🔴 **Historical** | تحليل للوحدات القديمة — تم تجاوزه |
| 06 | RUNTIME_FLOW.md | 🔴 **Historical** | يصف النظام القديم — العمارة الجديدة تغير التدفق |
| 07 | DEPENDENCY_MAP.md | 🔴 **Historical** | تبعيات قديمة — تم استبدالها بـ 18_DEPENDENCY_DIRECTION.md |
| 08 | ARCHITECTURE_FINDINGS.md | 🔴 **Historical** | نتائج سابقة — بعضها لا يزال صحيحاً لكنها ليست Canonical |

**سبب Historical:** TASK-001 كان تحليلاً للوضع الراهن. الوثائق الآن معاد تصميمها بالكامل في TASK-002/003.

### 2.2 TASK-002 — Data Provider Architecture

| الرقم | الوثيقة | الحالة | السبب |
|-------|---------|--------|-------|
| 09 | DATA_PROVIDER_ARCHITECTURE.md | ⚠️ **Superseded** | مستبدلة بـ 21_ARCHITECTURE_SPECIFICATION_V1.md (القسم 8) |
| 10 | PROVIDER_INTERFACES.md | ⚠️ **Superseded** | أسماء الـ Interfaces تغيّرت حسب ADR-005 — مستبدلة بـ 21 (القسم 8.2) |
| 11 | APPLICATION_LAYER.md | ⚠️ **Superseded** | تم دمجها في 21 (القسم 3.2) — تبقى مرجعاً للتفاصيل |
| 12 | FOLDER_STRUCTURE_V2.md | ⚠️ **Superseded** | تم تحديثها وإضافة Infrastructure Layer — مستبدلة بـ 21 (القسم 13) |
| 13 | PROVIDER_MIGRATION_PLAN.md | 🔴 **Historical** | الخطة لا تزال صالحة — لكنها ليست Canonical (مرجع تنفيذي) |
| 14 | IMPLEMENTATION_STRATEGY.md | 🔴 **Historical** | خطة تنفيذية — ستُستخدم عند البدء لكنها ليست معمارية |

**سبب Superseded:** TASK-002 صمم قبل TASK-003. ADR-001 إلى ADR-005 غيّرت جزءاً من التصميم. المحتوى المعتمد الآن هو في 21.

### 2.3 TASK-003 — Domain Architecture

| الرقم | الوثيقة | الحالة | السبب |
|-------|---------|--------|-------|
| 15 | BUSINESS_CAPABILITIES.md | 🟢 **Canonical** | التعريف الرسمي لقدرات الأعمال الـ 23 |
| 16 | DOMAIN_MODEL.md | 🟢 **Canonical** | التعريف الرسمي لنماذج النطاق |
| 17 | AGGREGATE_DESIGN.md | 🟢 **Canonical** | التصميم الرسمي للتجميعات |
| 18 | DEPENDENCY_DIRECTION.md | 🟢 **Canonical** | قواعد التبعية الرسمية |
| 19 | ARCHITECTURE_REVIEW_TASK2.md | 🟢 **Canonical** | مراجعة TASK-002 — التغييرات المطلوبة |
| 20 | ARCHITECTURE_DECISIONS.md | 🟢 **Canonical** | سجل ADRs الرسمي |

### 2.4 TASK-004 — Architecture Freeze

| الرقم | الوثيقة | الحالة | السبب |
|-------|---------|--------|-------|
| 21 | ARCHITECTURE_SPECIFICATION_V1.md | 🟢 **Canonical** | **المواصفة المعمارية الرسمية — المرجع الأول** |
| 22 | ARCHITECTURE_FREEZE.md | 🟢 **Canonical** | إعلان التجميد الرسمي |
| 23 | ARCHITECTURE_GOVERNANCE.md | 🟢 **Canonical** | قواعد الحوكمة الرسمية |
| 24 | DOCUMENT_STATUS.md | 🟢 **Canonical** | هذه الوثيقة — حالة الوثائق الرسمية |
| 25 | IMPLEMENTATION_RULES.md | 🟢 **Canonical** | قواعد التنفيذ الرسمية |

---

## 3. مصفوفة الحالة الكاملة

| الرقم | الوثيقة | الحالة | Canonical Reference |
|-------|---------|--------|---------------------|
| INDEX | INDEX.md | 🟢 Canonical | قواعد التسجيل والفهرسة |
| Master | Ahram ERP Master.md | 🟢 Canonical | الوثيقة الأم |
| 01 | CURRENT_ARCHITECTURE.md | 🔴 Historical | — |
| 02 | DATABASE_BASELINE.md | 🔴 Historical | — |
| 03 | DATA_ACCESS_MAP.md | 🔴 Historical | — |
| 04 | BUSINESS_RULES_MAP.md | 🔴 Historical | 15 |
| 05 | MODULE_MAP.md | 🔴 Historical | — |
| 06 | RUNTIME_FLOW.md | 🔴 Historical | — |
| 07 | DEPENDENCY_MAP.md | 🔴 Historical | 18 |
| 08 | ARCHITECTURE_FINDINGS.md | 🔴 Historical | — |
| 09 | DATA_PROVIDER_ARCHITECTURE.md | ⚠️ Superseded | 21 (§8) |
| 10 | PROVIDER_INTERFACES.md | ⚠️ Superseded | 21 (§8.2) |
| 11 | APPLICATION_LAYER.md | ⚠️ Superseded | 21 (§3.2) |
| 12 | FOLDER_STRUCTURE_V2.md | ⚠️ Superseded | 21 (§13) |
| 13 | PROVIDER_MIGRATION_PLAN.md | 🔴 Historical | — |
| 14 | IMPLEMENTATION_STRATEGY.md | 🔴 Historical | — |
| 15 | BUSINESS_CAPABILITIES.md | 🟢 Canonical | نفسها |
| 16 | DOMAIN_MODEL.md | 🟢 Canonical | نفسها |
| 17 | AGGREGATE_DESIGN.md | 🟢 Canonical | نفسها |
| 18 | DEPENDENCY_DIRECTION.md | 🟢 Canonical | نفسها |
| 19 | ARCHITECTURE_REVIEW_TASK2.md | 🟢 Canonical | نفسها |
| 20 | ARCHITECTURE_DECISIONS.md | 🟢 Canonical | نفسها |
| 21 | ARCHITECTURE_SPECIFICATION_V1.md | 🟢 **Canonical (Primary)** | المرجع الأول |
| 22 | ARCHITECTURE_FREEZE.md | 🟢 Canonical | نفسها |
| 23 | ARCHITECTURE_GOVERNANCE.md | 🟢 Canonical | نفسها |
| 24 | DOCUMENT_STATUS.md | 🟢 Canonical | نفسها |
| 25 | IMPLEMENTATION_RULES.md | 🟢 Canonical | نفسها |
| 26 | PRESENTATION_ARCHITECTURE.md | 🟢 Canonical | نفسها |
| 27 | DESKTOP_RUNTIME_STRATEGY.md | 🟢 Canonical | نفسها |

---

## 4. القاعدة

| القاعدة | التفصيل |
|---------|---------|
| **Canonical = معتمد** | يُرجع إليه في القرارات والتنفيذ |
| **Historical = للسياق فقط** | يُقرأ لفهم التاريخ — لا يُستخدم كمرجع للتنفيذ |
| **Superseded = لا يُستخدم** | يُشير إلى البديل — يُحدّث إذا تغير البديل |
| **أي وثيقة خارج INDEX.md** | غير معترف بها — يجب تسجيلها |
