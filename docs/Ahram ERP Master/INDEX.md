# Ahram ERP – Canonical Documentation Index

**المسار:** `D:\Projects\store\docs\Ahram ERP Master\`  
**الغرض:** المرجع الوحيد (Single Source of Truth) لجميع وثائق التطوير  
**تاريخ التأسيس:** 5 يوليو 2026  
**الحالة:** معتمد

---

## القواعد

- جميع الوثائق المعمارية والوظيفية والتقنية والتشغيلية تُحفظ داخل هذا المجلد فقط.
- أي نسخة خارج هذا المسار تعتبر **Deprecated** ولا يُعتمد عليها.
- قبل إنشاء أي وثيقة جديدة، تُراجع الوثائق الموجودة أولاً.
- أي تعديل على وثيقة موجودة يُحدث الأصل داخل هذا المسار.

---

## فهرس الوثائق

| الوثيقة | الحالة | التاريخ | الإصدار | الوصف |
|---------|--------|---------|---------|-------|
| [Ahram ERP Master.md](./Ahram%20ERP%20Master.md) | 🟢 Canonical | 2026-07-05 | 1.0 | الوثيقة المعمارية والتنفيذية الرسمية للمشروع |
| [01_CURRENT_ARCHITECTURE.md](./01_CURRENT_ARCHITECTURE.md) | 🔴 Historical | 2026-07-05 | 1.0 | خريطة العمارة الحالية — الـ Stack، الطبقات، الأنماط |
| [02_DATABASE_BASELINE.md](./02_DATABASE_BASELINE.md) | 🔴 Historical | 2026-07-05 | 1.0 | قاعدة البيانات — 51 جدول، 14 enum، 150+ RPC |
| [03_DATA_ACCESS_MAP.md](./03_DATA_ACCESS_MAP.md) | 🔴 Historical | 2026-07-05 | 1.0 | خريطة الوصول للبيانات — 165+ نقطة وصول موثقة |
| [04_BUSINESS_RULES_MAP.md](./04_BUSINESS_RULES_MAP.md) | 🔴 Historical | 2026-07-05 | 1.0 | خريطة قواعد الأعمال — 4 طبقات، مواقع، تكرار |
| [05_MODULE_MAP.md](./05_MODULE_MAP.md) | 🔴 Historical | 2026-07-05 | 1.0 | خريطة الوحدات — التبعيات، الاقتران، قابلية إعادة الاستخدام |
| [06_RUNTIME_FLOW.md](./06_RUNTIME_FLOW.md) | 🔴 Historical | 2026-07-05 | 1.0 | تدفق التشغيل — Startup, Auth, Routing, GPS, SW |
| [07_DEPENDENCY_MAP.md](./07_DEPENDENCY_MAP.md) | 🔴 Historical | 2026-07-05 | 1.0 | خريطة التبعيات — خارجية، داخلية، build chain |
| [08_ARCHITECTURE_FINDINGS.md](./08_ARCHITECTURE_FINDINGS.md) | 🔴 Historical | 2026-07-05 | 1.0 | النتائج والتوصيات — 16 مشكلة، أولويات، خطة تحسين |
| [09_DATA_PROVIDER_ARCHITECTURE.md](./Architecture/09_DATA_PROVIDER_ARCHITECTURE.md) | ⚠️ Superseded | 2026-07-05 | 1.0 | عمارة مزود البيانات — مستبدلة بـ 21 |
| [10_PROVIDER_INTERFACES.md](./Architecture/10_PROVIDER_INTERFACES.md) | ⚠️ Superseded | 2026-07-05 | 1.0 | واجهات مزود البيانات — مستبدلة بـ 21 (§8.2) |
| [11_APPLICATION_LAYER.md](./Architecture/11_APPLICATION_LAYER.md) | ⚠️ Superseded | 2026-07-05 | 1.0 | طبقة التطبيق — مستبدلة بـ 21 (§3.2) |
| [12_FOLDER_STRUCTURE_V2.md](./Architecture/12_FOLDER_STRUCTURE_V2.md) | ⚠️ Superseded | 2026-07-05 | 1.0 | هيكل المجلدات — مستبدلة بـ 21 (§13) |
| [13_PROVIDER_MIGRATION_PLAN.md](./Architecture/13_PROVIDER_MIGRATION_PLAN.md) | 🔴 Historical | 2026-07-05 | 1.0 | خطة الترحيل — 5 مراحل، 43 يوم عمل |
| [14_IMPLEMENTATION_STRATEGY.md](./Architecture/14_IMPLEMENTATION_STRATEGY.md) | 🔴 Historical | 2026-07-05 | 1.0 | استراتيجية التنفيذ — أسابيع 1-3 |
| [15_BUSINESS_CAPABILITIES.md](./Architecture/15_BUSINESS_CAPABILITIES.md) | 🟢 Canonical | 2026-07-05 | 1.0 | قدرات الأعمال — 23 قدرة |
| [16_DOMAIN_MODEL.md](./Architecture/16_DOMAIN_MODEL.md) | 🟢 Canonical | 2026-07-05 | 1.0 | نماذج النطاق — 30+ Domain Model |
| [17_AGGREGATE_DESIGN.md](./Architecture/17_AGGREGATE_DESIGN.md) | 🟢 Canonical | 2026-07-05 | 1.0 | تصميم التجميعات — 10 Aggregates |
| [18_DEPENDENCY_DIRECTION.md](./Architecture/18_DEPENDENCY_DIRECTION.md) | 🟢 Canonical | 2026-07-05 | 1.0 | قواعد التبعيات لكل طبقة |
| [19_ARCHITECTURE_REVIEW_TASK2.md](./Architecture/19_ARCHITECTURE_REVIEW_TASK2.md) | 🟢 Canonical | 2026-07-05 | 1.0 | مراجعة TASK-002 — 7 تغييرات |
| [20_ARCHITECTURE_DECISIONS.md](./Architecture/20_ARCHITECTURE_DECISIONS.md) | 🟢 Canonical | 2026-07-05 | 1.0 | سجل ADRs — 8 قرارات |
| [21_ARCHITECTURE_SPECIFICATION_V1.md](./Architecture/21_ARCHITECTURE_SPECIFICATION_V1.md) | 🟢 **Canonical (Primary)** | 2026-07-05 | 1.2 | المواصفة المعمارية الرسمية — المرجع الأول |
| [22_ARCHITECTURE_FREEZE.md](./Architecture/22_ARCHITECTURE_FREEZE.md) | 🟢 Canonical | 2026-07-05 | 1.0 | إعلان تجميد العمارة |
| [23_ARCHITECTURE_GOVERNANCE.md](./Architecture/23_ARCHITECTURE_GOVERNANCE.md) | 🟢 Canonical | 2026-07-05 | 1.0 | قواعد الحوكمة المعمارية |
| [24_DOCUMENT_STATUS.md](./Architecture/24_DOCUMENT_STATUS.md) | 🟢 Canonical | 2026-07-05 | 1.0 | حالة جميع الوثائق |
| [25_IMPLEMENTATION_RULES.md](./Architecture/25_IMPLEMENTATION_RULES.md) | 🟢 Canonical | 2026-07-05 | 1.0 | 25 قاعدة تنفيذ ملزمة |
| [26_PRESENTATION_ARCHITECTURE.md](./Architecture/26_PRESENTATION_ARCHITECTURE.md) | 🟢 Canonical | 2026-07-05 | 1.0 | عمارة Presentation ثنائي المسار — Mobile + Desktop |
| [27_DESKTOP_RUNTIME_STRATEGY.md](./Architecture/27_DESKTOP_RUNTIME_STRATEGY.md) | 🟢 Canonical | 2026-07-05 | 1.0 | استراتيجية Electron Desktop — IPC، أمان، خدمات خلفية |

---

## الهيكل التنظيمي (مقترح)

```text
docs/Ahram ERP Master/
├── INDEX.md                         # هذا الملف — فهرس الوثائق والقواعد
├── Ahram ERP Master.md              # الوثيقة الأم — العمارة والرؤية
├── Architecture/                    # قرارات معمارية
├── Business/                        # قواعد الأعمال و KPI
├── Technical/                       # وثائق تقنية وتنفيذية
├── Roadmap/                         # خرائط الطريق والمراحل
└── References/                      # مراجع خارجية
```

---

## الصلاحيات

- **Product Owner** — إضافة أو تعديل أو حذف أي وثيقة.
- **Architecture/Review** — مراجعة المحتوى التقني والمعماري.
- **Implementation Engine** — قراءة الوثائق للتنفيذ فقط.

---

## التحديثات

| التاريخ | الوثيقة | التغيير |
|---------|---------|---------|
| 2026-07-05 | INDEX.md | إنشاء فهرس الوثائق والقواعد |
| 2026-07-05 | INDEX.md | إضافة 8 وثائق خريطة الأساس المعماري (TASK-001) |
| 2026-07-05 | 01_CURRENT_ARCHITECTURE.md | إنشاء وثيقة العمارة الحالية |
| 2026-07-05 | 02_DATABASE_BASELINE.md | إنشاء وثيقة قاعدة البيانات |
| 2026-07-05 | 03_DATA_ACCESS_MAP.md | إنشاء خريطة الوصول للبيانات |
| 2026-07-05 | 04_BUSINESS_RULES_MAP.md | إنشاء خريطة قواعد الأعمال |
| 2026-07-05 | 05_MODULE_MAP.md | إنشاء خريطة الوحدات |
| 2026-07-05 | 06_RUNTIME_FLOW.md | إنشاء وثيقة تدفق التشغيل |
| 2026-07-05 | 07_DEPENDENCY_MAP.md | إنشاء خريطة التبعيات |
| 2026-07-05 | 08_ARCHITECTURE_FINDINGS.md | إنشاء النتائج والتوصيات |
| 2026-07-05 | INDEX.md | إضافة 6 وثائق عمارة مزود البيانات (TASK-002) |
| 2026-07-05 | 09_DATA_PROVIDER_ARCHITECTURE.md | إنشاء عمارة مزود البيانات |
| 2026-07-05 | 10_PROVIDER_INTERFACES.md | إنشاء واجهات مزود البيانات |
| 2026-07-05 | 11_APPLICATION_LAYER.md | إنشاء طبقة التطبيق |
| 2026-07-05 | 12_FOLDER_STRUCTURE_V2.md | إنشاء هيكل المجلدات الجديد |
| 2026-07-05 | 13_PROVIDER_MIGRATION_PLAN.md | إنشاء خطة الترحيل |
| 2026-07-05 | 14_IMPLEMENTATION_STRATEGY.md | إنشاء استراتيجية التنفيذ |
| 2026-07-05 | INDEX.md | إضافة 6 وثائق قدرات الأعمال والمراجعة (TASK-003) |
| 2026-07-05 | 15_BUSINESS_CAPABILITIES.md | إنشاء قدرات الأعمال |
| 2026-07-05 | 16_DOMAIN_MODEL.md | إنشاء نماذج النطاق |
| 2026-07-05 | 17_AGGREGATE_DESIGN.md | إنشاء تصميم التجميعات |
| 2026-07-05 | 18_DEPENDENCY_DIRECTION.md | إنشاء قواعد اتجاه التبعيات |
| 2026-07-05 | 19_ARCHITECTURE_REVIEW_TASK2.md | إنشاء مراجعة TASK-002 |
| 2026-07-05 | 20_ARCHITECTURE_DECISIONS.md | إنشاء سجل القرارات المعمارية |
| 2026-07-05 | INDEX.md | إضافة 5 وثائق تجميد العمارة (TASK-004) — تصنيف حالات الوثائق |
| 2026-07-05 | INDEX.md | تصنيف 01-08 كـ Historical، 09-12 كـ Superseded |
| 2026-07-05 | 21_ARCHITECTURE_SPECIFICATION_V1.md | إنشاء المواصفة المعمارية الرسمية (تحل محل 09-11) |
| 2026-07-05 | 22_ARCHITECTURE_FREEZE.md | إنشاء إعلان تجميد العمارة v1.0 |
| 2026-07-05 | 23_ARCHITECTURE_GOVERNANCE.md | إنشاء قواعد الحوكمة المعمارية |
| 2026-07-05 | 24_DOCUMENT_STATUS.md | إنشاء سجل حالة الوثائق |
| 2026-07-05 | 25_IMPLEMENTATION_RULES.md | إنشاء 25 قاعدة تنفيذ ملزمة |
| 2026-07-05 | 21_ARCHITECTURE_SPECIFICATION_V1.md | تحديث إلى v1.1 — إضافة Dual Presentation |
| 2026-07-05 | 20_ARCHITECTURE_DECISIONS.md | إضافة ADR-009 — Dual Presentation |
| 2026-07-05 | 26_PRESENTATION_ARCHITECTURE.md | إنشاء عمارة Presentation — Mobile + Desktop |
| 2026-07-05 | 21_ARCHITECTURE_SPECIFICATION_V1.md | تحديث إلى v1.2 — إضافة Desktop Runtime (Electron) |
| 2026-07-05 | 20_ARCHITECTURE_DECISIONS.md | إضافة ADR-010 — Desktop Runtime Strategy (Electron) |
| 2026-07-05 | 27_DESKTOP_RUNTIME_STRATEGY.md | إنشاء استراتيجية Electron Desktop |
