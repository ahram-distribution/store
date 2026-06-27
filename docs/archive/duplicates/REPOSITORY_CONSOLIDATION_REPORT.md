# REPOSITORY CONSOLIDATION REPORT

> **التاريخ:** 2026-06-16  
> **الهدف:** اعتماد https://github.com/ahram-distribution/store.git كمصدر الحقيقة الوحيد  
> **النطاق:** تحليل وتقرير فقط — لا حذف، لا نقل، لا push

---

## 1. Git Remotes الموجودة

| الاسم | الـ URL | الفرع الرئيسي | آخر Commit |
|-------|---------|---------------|------------|
| `origin` | `https://github.com/joker-alahram/ahram-distribution.git` | `main` | `1e7a15581a9642ee12ede3424570168e9037c73b` |
| `store` | `https://github.com/ahram-distribution/store.git` | `main` | `3b7045f784d6ec275dbb019dc14959af03e91a2a` |

### العلاقة بين الـ Remotes

```
origin/main (1e7a15581)  ← merge base
     └── 9 commits ahead →
store/main (3b7045f78)   ← OFFICIAL (ahead of origin by 9 commits)
     └── 1 commit ahead →
local HEAD (0439d5849)
```

store `main` متقدم عن origin `main` بـ 9 Commits.  
local HEAD متقدم عن store `main` بـ 1 Commit واحد.

---

## 2. Repositories المرتبطة بالمشروع

| الـ Repository | العلاقة | آخر Commit | مصدر النشر الرسمي |
|----------------|---------|-------------|-------------------|
| `joker-alahram/ahram-distribution` (origin) | Fork شخصي — مستودع سابق | `1e7a15581` | ❌ لا |
| **`ahram-distribution/store`** (store) | **المستودع الرسمي المعتمد** | `3b7045f78` | ✅ **https://ahram-distribution.github.io/store/** |
| Clone محلي (هذا الجهاز) | متصل بـ store + origin | `0439d5849` | ⏳ يحتاج push إلى store/main |

---

## 3. آخر Commit في كل Repository

| الموقع | Commit Hash | الرسالة |
|--------|-------------|---------|
| **local HEAD** | `0439d58499632eccb56848560a04c29c9ce5f746` | `fix: attendance RPCs - array visibility operator and remove invalid outer ORDER BY` |
| **store/main** | `3b7045f784d6ec275dbb019dc14959af03e91a2a` | `fix: auto-link new employee/customer to manager's team` |
| **origin/main** | `1e7a15581a9642ee12ede3424570168e9037c73b` | (merge base — أقدم commit) |

---

## 4. Commits محلية غير مرفوعة إلى store

**Commit واحد** (`0439d58`) موجود محلياً وغير مرفوع إلى `store/main`:

```
0439d58 fix: attendance RPCs - array visibility operator and remove invalid outer ORDER BY
```

يضيف هذا الـ commit ملفين غير موجودين في store:
- `supabase/migrations/20260722_fix_attendance_rpcs_visibility.sql`
- `_extract_rpcs.ps1`

---

## 5. تعديلات Uncommitted

### ملفات Tracked معدّلة (5 ملفات، +43/-26 سطر)

| الملف | التغيير |
|-------|---------|
| `src/App.tsx` | +10 lines — Bootstrap guards (System of Truth Phase 2) |
| `src/lib/supabase.ts` | +5/-1 lines — supabaseProxy wrapping |
| `src/pages/account/AccountPage.tsx` | +8/-3 lines — V-001: governed RPC بدلاً من direct access |
| `src/pages/attendance/EmployeeWorkdayDetailPage.tsx` | +33/-13 lines — route_polyline fix (سابق، ليس من Phase 2) |
| `src/pages/companies/CompanyManagerPage.tsx` | +13/-5 lines — V-002: governed data بدلاً من direct query |

### ملفات Untracked جديدة (15 ملفاً)

| الملف | الحجم |
|-------|-------|
| `.opencode/AGENTS.md` | 2.0 KB — قواعد OpenCode |
| `ACTIVE_DATABASE_USAGE.md` | — تحليل قاعدة البيانات |
| `ACTIVE_ROLE_MODEL.md` | — نموذج الصلاحيات |
| `ACTIVE_RPC_CATALOG.md` | — كتالوج RPCs |
| `ACTIVE_RUNTIME_ONLY.md` | — التحليل التشغيلي |
| `ACTIVE_SCREEN_CATALOG.md` | — كتالوج الشاشات |
| `FIX_HISTORY.md` | 8.9 KB — 15 مشكلة موثقة |
| `PROJECT_TRUTH_AUDIT.md` | — تدقيق الحقيقة |
| `REGRESSION_ENFORCEMENT_REPORT.md` | 5.3 KB — تقرير الإنفاذ النهائي |
| `REGRESSION_GUARD.md` | — 65 fix records |
| `REGRESSION_RISK_REPORT.md` | — تقييم المخاطر |
| `REMOVAL_CANDIDATES.md` | — المرشحون للإزالة |
| `SYSTEM_OF_TRUTH_ENFORCEMENT_REPORT.md` | — تقرير المخالفات |
| `SYSTEM_OF_TRUTH_MAP.md` | — المرجع الإلزامي للمعمارية |
| `src/utils/systemOfTruthGuard.ts` | 5.4 KB — طبقة الإنفاذ |

**إجمالي الـ uncommitted:** 20 ملفاً (5 معدّلة + 15 جديدة)

---

## 6. ملفات موجودة خارج المستودع الرسمي

### ملفات في `local HEAD` لكنها غير موجودة في `store/main`

| الملف | النوع | ملاحظات |
|-------|-------|---------|
| `supabase/migrations/20260722_fix_attendance_rpcs_visibility.sql` | SQL migration | مطلوب لتطبيق fix attendance RPCs |
| `_extract_rpcs.ps1` | PowerShell script | Script استخراج |

### ملفات Uncommitted غير موجودة في `store/main`

جميع الـ 20 ملفاً المذكورة في القسم 5 أعلاه غير موجودة في `store/main`.  
أهمها:

| الأولوية | الملف | السبب |
|----------|-------|-------|
| 🔴 | `src/utils/systemOfTruthGuard.ts` | طبقة الإنفاذ الأساسية — بدونها لا يوجد Hard Enforcement |
| 🔴 | `src/App.tsx` (modified) | Bootstrap guards — بدونها لا يتم تفعيل enforcement |
| 🔴 | `src/lib/supabase.ts` (modified) | supabaseProxy — بدونها لا يتم منع direct access |
| 🔴 | `src/pages/account/AccountPage.tsx` (modified) | V-001 Fix — بدونها تبقى مخالفة أمنية |
| 🔴 | `src/pages/companies/CompanyManagerPage.tsx` (modified) | V-002 Fix — بدونها تبقى مخالفة أمنية |

### ملفات في `store/main` غير موجودة في `local HEAD`

**لا يوجد.** `store/main` لا يحتوي أي ملف غير موجود في `local HEAD`.

---

## 7. هل المستودع الرسمي يحتوي 100% من العمل الحالي؟

**لا.** `store/main` لا يحتوي على:

- ❌ 1 commit محلي (`0439d58` — migration + script)
- ❌ 5 تعديلات Hard Enforcement على source files
- ❌ 15 ملفاً تحليلياً جديداً

**نسبة التغطية (ملفات فقط):**

| المقياس | القيمة |
|---------|--------|
| ملفات في `local HEAD` | ~300+ |
| ملفات مفقودة من `store/main` | 2 (من HEAD) + 20 (uncommitted) |
| ملفات زائدة في `store/main` | 0 |
| **نسبة تطابق HEAD مع store** | **~99%** (باستثناء ملفين) |
| **نسبة تطابق WORKING TREE مع store** | **~93%** (بسبب 20 ملف uncommitted) |

---

## 8. القرار

### ❌ NOT SAFE TO DELETE OTHER REPOSITORIES

**السبب:** المستودع الرسمي (`ahram-distribution/store`) لا يحتوي على 100% من العمل الحالي. هناك 22 ملفاً/تعديلاً غير موجودة فيه:

1. **1 commit غير مرفوع** (`0439d58`) — يحتوي على migration مطلوب + script
2. **5 ملفات مصدرية معدّلة** — Hard Enforcement Layer بالكامل غير موجود في store
3. **15 ملفاً تحليلياً جديداً** — جميع تقارير Phase 1 و Phase 2 غير موجودة في store

### الشرط اللازم للـ SAFE TO DELETE

لجعل `joker-alahram/ahram-distribution` (origin) آمناً للحذف:

1. `git add` و `git commit` لجميع التغييرات الحالية
2. `git push store main` لرفع الـ commit والملفات إلى المستودع الرسمي
3. `git push origin main` (اختياري — للمزامنة)
4. بعد التأكد أن `store/main` == `local HEAD`، يصبح origin آمناً للحذف

### ملاحظات إضافية

- `origin` (joker-alahram/ahram-distribution) متأخر بـ 9 commits عن `store/main` — أي أن العمل كان يتم على `store` بشكل أساسي
- لا يوجد fork حقيقي هنا؛ `store` هو المستودع الرسمي و `origin` هو مستودع سابق أو اختباري
- جميع ملفات `store/main` موجودة في `local HEAD` — لا يوجد فقدان بيانات عند التبديل إلى store

---

*تاريخ الإنشاء: 2026-06-16*  
*المرجع: git remotes، git log، git diff، git ls-tree*
