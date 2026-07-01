# Implementation Roadmap — Architecture-Driven

> هذا المستند يحدد ترتيب التنفيذ حسب الأولوية المعمارية، وليس حسب الأولوية الزمنية.
>
> كل Phase تُبنى على foundation الـ Phase التي سبقتها — ولا تُعاد كتابة أي كتلة.

---

## Principles

ترتيب التنفيذ ليس "أسهل أولاً" ولا "أسرع أولاً" ولا "bug أولاً".

ترتيب التنفيذ هو:

**ما هو minimum platform foundation الذي يضمن أن كل Phase لاحقة تُنفذ مرة واحدة فقط ولا تُعاد كتابتها؟**

كل Phase تبني foundation. الـ Phase التالية تبني فوقها. لا يوجد rewrite.

### Execution Principles (permanent)

1. **Domain-first, not report-first.** The product of every phase is a reusable Module. The report is only a consumer used for verification.

2. **Every phase produces a reusable artifact.** Module Contracts, BusinessActivityModule, KpiDrillDownModal, Navigation Contract — these are permanent. Reports consume them.

3. **No business logic leakage.** Business logic must never live inside a report page. If logic appears in a report page, it belongs in a module.

4. **Production stability is mandatory.** Every deployment must include regression verification. Existing values must remain identical.

5. **Reuse verification is an acceptance criterion.** Every phase must prove its artifact can be consumed by another report without modification. A temporary demo page may be created for this purpose (not deployed).

6. **One phase at a time.** Build exactly what the phase defines. No optimization, no refactoring beyond scope, no chasing perfection.

---

## Phase Map

```
P1 — Module Foundation + BusinessActivityModule
 │
 ├──→ P2 — AttendanceModule
 │
 ├──→ P3 — AchievementModule
 │
 ├──→ P4 — ExecutiveSummaryModule
 │
 ├──→ P5 — Export Contracts (Excel + PDF)
 │
 ├──→ P6 — Provenance + Data Quality
 │
 ├──→ P7 — Second Consumer (new report)
 │
 └──→ P8 — UI Polish
```

كل Phase مستقلة. لا تعتمد على Phase أخرى غير foundation.

---

## P1 — Module Foundation + BusinessActivityModule

### Why first?

BusinessActivityModule هو أغنى module (5 KPIs, 4 entity types, أكثر drill-down targets). إذا بنيناه بشكل صحيح، فإن AttendanceModule و AchievementModule يتبعان نفس النمط بدون إعادة اختراع.

أيضًا: الـ Sales rendering bug (الموجود حاليًا) يُحل تلقائيًا لأن BusinessActivityModule يعامل Sales = Orders — لا حاجة لـ hotfix منفصل.

### Objective

بناء Foundation الذي ستعمل عليه كل الـ Phases اللاحقة:

1. **Module Contract** — تعريف TypeScript لواجهة كل module
2. **BusinessActivityModule** — أول concrete module (Orders, Sales, Customers, Visits, Collections)
3. **KpiDrillDownModal** — مكون Drill-down عام، غير مرتبط بأي صفحة
4. **Navigation Contract** — آلية تحويل record إلى navigate() إلى صفحة التفاصيل الموجودة
5. **دمج BusinessActivityModule في ManagerReportsPage** — بدلاً من الـ inline code الحالي

### What gets built (not rewritten later)

| Building Block | Why it stays |
|----------------|-------------|
| Module Contract (interfaces) | Foundation لكل الـ Phases — لا يُعاد تعريفه |
| BusinessActivityModule | يبقى كما هو — AttendanceModule ينسخ النمط فقط |
| KpiDrillDownModal | تستخدمه كل الـ Phases — لا يُعاد كتابته |
| Navigation wiring | كل module يستخدم نفس الآلية — لا تُعاد كتابتها |

### What changes in ManagerReportsPage

| Section | Current | After P1 |
|---------|---------|----------|
| Activity KPIs (Orders, Sales, Customers, Visits, Collections) | Inline cards + inline DetailModal | BusinessActivityModule + KpiDrillDownModal |
| Sales drill-down | Bug: opens empty | Fixed naturally (Sales = Orders in module) |
| Attendance section (start, end, hours, distance, points) | Inline cards | Kept as-is (refactored in P2) |
| Achievement section (bars, %) | Inline | Kept as-is (refactored in P3) |
| Sessions table | Mixed columns | Kept as-is (refactored in P2/P3) |
| Excel export | Inline | Kept as-is (refactored in P5) |

### Files affected

| File | Change |
|------|--------|
| `src/modules/ModuleContract.ts` (NEW) | TypeScript interfaces: ModuleData, Provenance, HealthState, DrillDownTarget, etc. |
| `src/modules/BusinessActivityModule.tsx` (NEW) | Data provider + KPI cards + state management + health |
| `src/components/KpiDrillDownModal.tsx` (NEW) | Generic modal: receives records + entity type + onRecordClick |
| `src/pages/reports/ManagerReportsPage.tsx` | Replace inline activity section with BusinessActivityModule + KpiDrillDownModal |

### Database impact

**None.** BusinessActivityModule uses the existing RPC (`get_employee_detail_data` or equivalent). The RPC already returns correct data.

### Acceptance criteria

| # | Criterion | How to verify |
|---|-----------|--------------|
| 1 | Orders KPI shows correct value, click opens order list | Same as today, but driven by module |
| 2 | Sales KPI shows correct value, click opens same order list (NOT empty) | Bug fix verified |
| 3 | Customers KPI shows correct value, click opens customer list | Same as today |
| 4 | Visits KPI shows correct value, click opens visit list | Same as today |
| 5 | Collections KPI shows correct value, click opens collection list | Same as today |
| 6 | Click any record in modal → navigates to existing detail page | New: Level 2 drill-down works |
| 7 | All attendance values unchanged | Side-by-side comparison |
| 8 | All achievement values unchanged | Side-by-side comparison |
| 9 | Excel export still works with same columns | Compare exports before/after |

### Production verification plan

1. Open `https://ahram-distribution.github.io/store`
2. Log in as ياسر توفيق
3. Manager Reports → select a manager → select خالد سعيد
4. Verify all KPI values unchanged (compare with database truth: Orders=1, Sales=110,081.67, Customers=1)
5. Click **المبيعات** → modal opens with ORD-2026-000127 (not empty) ✅
6. Click **الطلبات** → same order ✅
7. Click **عملاء جدد** → إسلام عاطف الصعيدى ✅
8. Click **الزيارات** → "لا توجد سجلات" ✅
9. Click **التحصيل** → "لا توجد سجلات" ✅
10. Click order row → navigate to Order Detail page ✅
11. Click customer row → navigate to Customer Profile page ✅
12. Click visit row (if exists) → navigate to Visit Detail page ✅
13. Verify attendance section values match previous behavior
14. Verify achievement section values match previous behavior
15. Export Excel → verify same columns and values

### Rollback plan

```
git revert <P1 commit SHA>
git push
```

GitHub Actions deploys the revert within ~3 minutes. All functionality returns to pre-P1 state.

---

## P2 — AttendanceModule

### Objective
بناء AttendanceModule بنفس نمط BusinessActivityModule وفصل قسم الحضور في ManagerReportsPage.

### What gets built
- `AttendanceModule.tsx` — data provider + KPI cards (start, end, hours, distance, points)
- `AttendanceTimeline` — optional: daily breakdown
- استخدام `KpiDrillDownModal` الموجود (بدون إعادة بناء)

### Acceptance
- Attendance values unchanged
- AttendanceModule يحل محل الـ inline section
- Click on any attendance metric → opened to existing attendance detail page

---

## P3 — AchievementModule

### Objective
بناء AchievementModule وفصل قسم الإنجاز.

### What gets built
- `AchievementModule.tsx` — data provider + progress bars + overall score
- استخدام نفس نمط BusinessActivityModule

### Acceptance
- Achievement values unchanged
- AchievementModule يحل محل الـ inline section

---

## P4 — ExecutiveSummaryModule

### Objective
بناء Executive Summary كـ Decision Engine. هذا الـ module يركّب الـ modules الثلاثة ويكتشف الـ anomalies.

### What gets built
- `ExecutiveSummaryModule.tsx` — health state aggregation + anomaly detection + warning badges
- لا يعيد بناء KPIs — يقرأها من الـ modules الموجودة

### Acceptance
- Summary يعرض أولاً قبل الـ modules
- Warnings تظهر عند وجود anomalies
- كل warning يقود إلى drill-down

---

## P5 — Export Contracts

### Objective
كل module ينفذ `toExcel()` و `toPdf()`. Composition layer يدمجها في مستند واحد.

### What gets built
- `ExcelFormatter` لكل module
- `PdfFormatter` لكل module
- Composition layer collection
- لا يُعاد بناء Excel الموجود — يُعاد هيكلته لاستخدام formatters الـ modules

### Acceptance
- Excel يحافظ على نفس الهierarchy
- PDF بنفس الهierarchy
- أي module جديد يحصل على export تلقائيًا

---

## P6 — Provenance + Data Quality

### Objective
كل رقم يعرض Provenance object. Data Quality signals تظهر لكل module.

### Acceptance
- كل KPI card عنده info icon → يظهر Provenance
- Data Quality warnings تظهر في Executive Summary

---

## P7 — Second Consumer

### Objective
بناء consumer ثاني (مثلاً Sales Rep Report) باستخدام نفس الـ modules — بدون إعادة كتابة أي منطق.

### Acceptance
- الـ report الجديد يستخدم BusinessActivityModule + AttendanceModule + AchievementModule
- نفس الأرقام تظهر في Manager Reports و Rep Report لنفس الموظف ونفس الفترة
- Zero new business logic

---

## P8 — UI Polish

### Objective
تحسين visual design ليكون Premium Executive application — ليس Excel.

### Acceptance
- Design متسق مع المبادئ المعمارية (قسم attendance رمادي هادئ، activity أبيض مع hover، achievement مع progress bars)
- المسافات، الألوان، الخطوط، transitions

---

## Production Review Observations — Reporting Redesign Roadmap

> سُجلت أثناء مراجعة الإنتاج لـ P1 — ليست جزءاً من fix الحالي. تُمهّد لـ redesign التقارير القادم.

1. **Monthly reports** — لا ينبغي إظهار "Today's Start" و "Today's End" في تقرير شهري، بل بيانات الشهر فقط.
2. **Achievement domain missing** — الـ report يفتقر إلى (Target, Actual, Remaining, Progress) لكل KPI.
3. **Session activity → drill-down entry points** — أرقام نشاط الجلسة الحالية يجب أن تصبح نقاط دخول للـ drill-down (كما في تقارير المدير).
4. **Tracking Points → map exploration** — نقاط التتبع يجب أن تتطور إلى استكشاف خريطي بمواقع قابلة للقراءة، وليس مجرد عدد رقمي.
5. **Timeline ("Business Story")** — سيتم إضافة Timeline يعرض تسلسل أحداث يوم البائع كنشاط تجاري متكامل.
6. **Navigation context preservation** — عند الانتقال من التقرير إلى صفحة التفاصيل والعودة، يجب الحفاظ على context التقرير (الفلاتر، الموظف المحدد، موضع التمرير).
