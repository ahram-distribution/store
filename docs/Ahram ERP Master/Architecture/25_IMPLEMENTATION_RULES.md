# 25 – Implementation Rules

**التصنيف:** حوكمة معمارية — قواعد التنفيذ  
**الغرض:** تحديد القواعد الملزمة لجميع عمليات التطوير المستقبلية بعد تجميد العمارة  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** ✅ نافذ

---

## 1. المبادئ

1. **كل سطر كود يخضع لهذه القواعد** — لا استثناءات.
2. **القواعد ليست توصيات** — violations تمنع PR من الدمج.
3. **بعض القواعد آلية (ESLint)** — وبعضها يدوي (Code Review).

---

## 2. القواعد الأساسية

### R-001: Architecture First

| القاعدة | التفصيل |
|---------|---------|
| **النص** | لا يُكتب أي كود دون الرجوع إلى العمارة المعتمدة أولاً |
| **الاستثناء** | (لا يوجد) |
| **التحقق** | Code Review: "هل هذا يتماشى مع 21_ARCHITECTURE_SPECIFICATION_V1.md؟" |

### R-002: Capability First

| القاعدة | التفصيل |
|---------|---------|
| **النص** | كل كود جديد يُنظّم حسب Business Capability (15_BUSINESS_CAPABILITIES.md) |
| **الاستثناء** | الـ Infrastructure Layer (لا تتبع قدرة محددة) |
| **التحقق** | Code Review: "هل هذا الملف في مجلد القدرة الصحيحة؟" |

### R-003: Provider First (Contracts)

| القاعدة | التفصيل |
|---------|---------|
| **النص** | قبل تنفيذ أي Provider، يُعتمد Interface في `providers/contracts/` أولاً |
| **الاستثناء** | (لا يوجد) |
| **التحقق** | الـ Interface موجود ومراجع قبل أي تنفيذ |

### R-004: No Direct Database Access

| القاعدة | التفصيل |
|---------|---------|
| **النص** | لا استدعاء `supabase.rpc()` أو أي استعلام قاعدة بيانات مباشر من **أي مكان خارج Provider Implementation** |
| **الاستثناء** | `lib/supabase.ts` — إنشاء الـ Client فقط |
| **التحقق** | `grep -r "supabase.rpc" src/pages src/application src/domain` = 0 نتائج |

### R-005: No Business Logic Inside UI

| القاعدة | التفصيل |
|---------|---------|
| **النص** | لا يُكتب منطق أعمال (حسابات أسعار، تحقق صلاحية، قواعد خصم) داخل Pages أو Components أو Hooks |
| **الاستثناء** | تنسيق العرض (formatPrice, formatDate) — هذه تنسيق وليس منطق أعمال |
| **التحقق** | Code Review + (مستقبلاً) Static Analysis |

### R-006: Dependency Direction

| القاعدة | التفصيل |
|---------|---------|
| **النص** | تبعيات الاستيراد تتبع القواعد في 18_DEPENDENCY_DIRECTION.md |
| **الاستثناء** | (لا يوجد) |
| **التحقق** | ESLint `import/no-restricted-paths` (23_ARCHITECTURE_GOVERNANCE.md §5.1) |

---

## 3. قواعد التطوير

### R-101: Strangler Fig Migration

| القاعدة | التفصيل |
|---------|---------|
| **النص** | الترحيل من النظام القديم إلى الجديد يتم بـ Strangler Fig — لا Big Bang |
| **الممارسة** | `services/` القديم يبقى حتى آخر صفحة تُرحّل |
| **التحقق** | لا حذف لملف من `services/` دون التأكد من عدم استيراده |

### R-102: Test Before Migration

| القاعدة | التفصيل |
|---------|---------|
| **النص** | قبل ترحيل أي صفحة من النظام القديم إلى الجديد، يجب أن يكون Provider الهدف مُختبراً (Unit Test يمر) |
| **الممارسة** | MockProvider يُستخدم للاختبار — ليس Supabase الحقيقي في Unit Tests |
| **الاستثناء** | Integration Tests مع Supabase الحقيقي — مسموح به |

### R-103: Backward Compatibility

| القاعدة | التفصيل |
|---------|---------|
| **النص** | أثناء الترحيل، النظام القديم والجديد يُنتجان نفس النتائج (A/B verification) |
| **الممارسة** | لكل استعلام في Provider الجديد، مقارنة مع RPC القديم (يدوياً أو آلياً) |
| **التحقق** | قبل اعتبار الـ Provider "مكتملاً" |

### R-104: Documentation Update Required

| القاعدة | التفصيل |
|---------|---------|
| **النص** | أي تغيير معماري (ADR جديد) يتطلب تحديث الوثيقة المعنية |
| **الممارسة** | الـ ADR يُرفق بقائمة الوثائق التي تغيّرت |
| **التحقق** | Architecture Lead يراجع قبل إغلاق ADR |

---

## 4. قواعد الـ Provider

### R-201: Single Interface per Provider

| القاعدة | التفصيل |
|---------|---------|
| **النص** | كل Provider Implementation ينفذ Interface واحد على الأقل من `providers/contracts/` |
| **الاستثناء** | `SupabaseUnitOfWork` (لا ينتمي لقدرة) |
| **التحقق** | Code Review |

### R-202: Provider Independence

| القاعدة | التفصيل |
|---------|---------|
| **النص** | لا Provider يستدعي Provider آخر |
| **الاستثناء** | عبر Application Service فقط |
| **التحقق** | Code Review + Dependency Cruiser |

### R-203: Provider Returns Domain Models

| القاعدة | التفصيل |
|---------|---------|
| **النص** | دوال الـ Provider تُرجع Domain Models (من `domain/models/`) — وليس DTOs وليس Raw SQL |
| **الاستثناء** | (لا يوجد — Mapper في Application Service يحوّل للعرض) |
| **التحقق** | Code Review |

### R-204: Mock Provider Before Real Provider

| القاعدة | التفصيل |
|---------|---------|
| **النص** | لكل Interface جديد، يُنفذ MockProvider قبل SupabaseProvider |
| **السبب** | MockProvider يسمح باختبار Application Service دون الحاجة لـ Supabase |
| **التحقق** | الـ Mock موجود في `providers/implementations/mock/` قبل التنفيذ |

---

## 5. قواعد الـ Application Layer

### R-301: Application Service Stateless

| القاعدة | التفصيل |
|---------|---------|
| **النص** | Application Services لا تحمل حالة — Stateless |
| **الاستثناء** | (لا يوجد — الحالة تكون في Store أو Provider) |
| **التحقق** | Code Review |

### R-302: Providers via Constructor

| القاعدة | التفصيل |
|---------|---------|
| **النص** | كل Application Service يستقبل Providers عبر Constructor |
| **الاستثناء** | (لا يوجد — حتى لو Provider واحد) |
| **السبب** | قابلية الاختبار — MockProvider يُمرر بدل Real |
| **التحقق** | Code Review |

### R-303: DTOs in, DTOs out

| القاعدة | التفصيل |
|---------|---------|
| **النص** | دوال Application Service تستقبل DTOs وتُعيد DTOs |
| **الاستثناء** | internal private methods قد تستخدم Domain Models |
| **التحقق** | Code Review |

---

## 6. قواعد الـ Domain Layer

### R-401: Pure TypeScript

| القاعدة | التفصيل |
|---------|---------|
| **النص** | Domain Layer لا يستورد أي مكتبة خارجية — TypeScript فقط |
| **الممنوع** | `import { createClient } from '@supabase/supabase-js'` في domain/ |
| **الممنوع** | `import { z } from 'zod'` في domain/ |
| **التحقق** | ESLint (منع حزم معينة من domain/) |

### R-402: No Side Effects

| القاعدة | التفصيل |
|---------|---------|
| **النص** | دوال Domain Services ليس لها Side Effects — Pure Functions |
| **الممنوع** | استدعاء API، كتابة ملف، تغيير Global State |
| **التحقق** | Code Review |

### R-403: Enums in Domain

| القاعدة | التفصيل |
|---------|---------|
| **النص** | كل Enums الأعمال (OrderStatus, UnitType, WorkdayStatus) في `domain/enums/` |
| **السبب** | لا تكرار للـ Enums — مصدر واحد |
| **التحقق** | `grep "enum.*Status"` للتأكد من عدم وجودها خارج domain/ |

---

## 7. قواعد الاختبار

### R-501: Unit Tests Required

| القاعدة | التفصيل |
|---------|---------|
| **النص** | كل Provider جديد + كل Application Service جديد له Unit Test |
| **التغطية الدنيا** | 70% للـ Providers, 80% للـ Domain Services |
| **التحقق** | CI/CD (Vitest coverage) |

### R-502: Mock Not Supabase in Unit Tests

| القاعدة | التفصيل |
|---------|---------|
| **النص** | Unit Tests تستخدم MockProvider — لا تستدعي Supabase حقيقي |
| **الاستثناء** | Integration Tests — مسموح بها لكن في ملف منفصل (`*.integration.test.ts`) |
| **التحقق** | Code Review + CI |

---

## 8. قواعد الـ Code Review

### R-601: Architecture Compliance Check

| القاعدة | التفصيل |
|---------|---------|
| **النص** | كل PR يحتوي بنود تحقق معماري في الـ Review Checklist |
| **البنود** | 1) التبعية صحيحة 2) لا مخالفات 3) التوثيق محدّث |
| **التحقق** | Review Template |

### R-602: No Shortcuts

| القاعدة | التفصيل |
|---------|---------|
| **النص** | لا يُسمح بـ "سأصلح العمارة لاحقاً" — أي خرق يُصلح فوراً أو يُرفض PR |
| **الاستثناء** | ADR عاجل معتمد من Architecture Lead |
| **التحقق** | Culture + Code Review |

---

## 9. قواعد التوثيق

### R-701: Canonical Only

| القاعدة | التفصيل |
|---------|---------|
| **النص** | يُرجع فقط للوثائق ذات الحالة **Canonical** في 24_DOCUMENT_STATUS.md |
| **السبب** | الوثائق Historical و Superseded قد تحتوي معلومات غير صحيحة |

### R-702: ADR for Every Change

| القاعدة | التفصيل |
|---------|---------|
| **النص** | أي تغيير في وثيقة Canonical يتطلب ADR جديد |
| **التحقق** | الـ ADR يُرفق بـ Commit message |
| **الممارسة** | Commit message: `feat: add Desktop provider (ref ADR-009)` |

### R-703: Document Before Implementation

| القاعدة | التفصيل |
|---------|---------|
| **النص** | لا تنفيذ لميزة معماريّة جديدة قبل توثيقها في وثيقة Canonical |
| **الاستثناء** | Prototype / Experiment (في branch منفصل، دون دمج) |

---

## 10. انتهاك القواعد (Violation Consequences)

| المستوى | المثال | العواقب |
|---------|--------|---------|
| **Violation** | استدعاء `supabase.rpc()` من Page | رفض PR + إصلاح إلزامي |
| **Pattern** | تكرار violation من نفس المطور | مراجعة + تدريب |
| **Systemic** | الـ Codebase يبتعد عن العمارة | Architecture Review + تحديث الـ ADRs |

---

## 11. الخلاصة

| البند | القيمة |
|-------|--------|
| عدد القواعد | 25 قاعدة |
| التقسيم | أساسية (6) + تطوير (4) + Provider (4) + Application (3) + Domain (3) + Testing (2) + Review (2) + Documentation (3) |
| النفاذ | فور اعتماد TASK-004 |
| التحديث | عبر ADR فقط |
| المرجع | هذه الوثيقة (25) + 23_ARCHITECTURE_GOVERNANCE.md |
