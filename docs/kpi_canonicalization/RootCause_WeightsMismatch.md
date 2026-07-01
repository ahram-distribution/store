# Root Cause Analysis — Weights Source Mismatch

**التصنيف النهائي:** ✅ **Bug — Loss of Dual-Write**  
**الأولوية:** 1 — المستخدم يغيّر أوزانًا لا تؤثر على الحساب الفعلي  
**السبب المباشر:** إزالة dual-write في `20261228_fix_company_weights_rpc_6fields.sql`

---

## 1. دورة حياة الأوزان الكاملة

### 1.1 عند تعديل الأوزان من WeightsTab

```
WeightsTab.tsx:83 → targetService.upsertCompanyTarget()
                      ↓
targets.ts:41     → supabase.rpc('governed_upsert_company_monthly_target', {...})
                      ↓
20261228_fix_company_weights_rpc_6fields.sql:67-83
                      ↓
         INSERT INTO public.company_monthly_targets (...) VALUES (...)
         ON CONFLICT DO UPDATE SET sales_weight_percent = EXCLUDED.sales_weight_percent,
                                   visits_weight_percent = EXCLUDED.visits_weight_percent,
                                   orders_weight_percent = EXCLUDED.orders_weight_percent,
                                   ...
```

**يُكتب في:** `company_monthly_targets` فقط.  
**لا يُكتب في:** `performance_weights_config`.  
**دليل (`20261228_fix_company_weights_rpc_6fields.sql:42-96`):** لا يوجد أي سطر يشير إلى `performance_weights_config` في هذا الملف.

---

### 1.2 عند حساب Overall Score داخل Canonical Engine

```
get_governed_target_performance()  ← 20261229_fix_company_target_source.sql:4-466
         ↓  line 46-48
    SELECT * INTO v_company_weights_record
    FROM public.performance_weights_config
    WHERE target_year = v_target_year;
         ↓  lines 50-57
    IF FOUND THEN
        v_comp_sales_weight := v_company_weights_record.sales_weight_percent;
        v_comp_visits_weight := v_company_weights_record.visits_weight_percent;
        v_comp_orders_weight := v_company_weights_record.orders_weight_percent;
        ...
    END IF;
         ↓  lines 59-68
    -- Company targets (عنا) read from company_monthly_targets ✅
    SELECT sales_target, visits_target::int, ... FROM public.company_monthly_targets
    WHERE target_month = v_target_month AND target_year = v_target_year;
```

**يُقرأ من:** `performance_weights_config` (للأوزان) ← جدول مختلف عن الذي يُكتب فيه.  
**يُقرأ من:** `company_monthly_targets` (للأهداف فقط) ← الهدف يُقرأ من الجدول الصحيح، الوزن لا.

---

### 1.3 دوال وسيطة

| الدالة | ماذا تفعل | أين تُقرأ الأوزان |
|--------|----------|-----------------|
| `get_effective_weights(employee_id, month, year)` | حل أوزان الموظف الفردي | `employee_weight_overrides` → `performance_weights_config` → hardcoded defaults |
| لا توجد View أو Trigger أو Sync ينقل البيانات بين الجدولين | — | — |

---

## 2. هل الجدولان يحتويان نفس البيانات؟

**لا. الأدلة من الإنتاج:**

| المصدر | sales | visits | orders | new_cust | coll | att |
|--------|-------|--------|--------|----------|------|-----|
| `performance_weights_config` (2026) | 75 | **10** | **7.5** | 7.5 | 0 | 0 |
| `company_monthly_targets` (June 2026) | 75 | **7.5** | **10** | 7.5 | 0 | 0 |
| **مطابقة؟** | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |

الفرق: **visits و orders مقلوبان** بين الجدولين.

---

## 3. التصنيف

| السؤال | الإجابة | الدليل |
|--------|---------|--------|
| **تصميم مقصود؟** | ❌ لا | `20260612_phase4_targets_governance.sql:329-371` كُتب عمدًا بـ dual-write ليبقى الجدولان متزامنين. إزالة الـ dual-write في `20261228` كانت سهوًا أثناء إعادة كتابة الـ RPC لإصلاح 6 حقول. |
| **Technical Debt؟** | ❌ لا | Technical Debt هو ما نعرفه ونؤجله. هذا **غير معروف** حتى الآن. لا يوجد TODO أو FIXME أو comment يشير إلى أن هذا متعمد. |
| **Bug؟** | ✅ **نعم** | المستخدم يعدّل أوزانًا في واجهة WeightsTab ← تُكتب في `company_monthly_targets` ← لكن `get_governed_target_performance` يقرأها من `performance_weights_config` ← **التعديلات لا تؤثر على الحساب الفعلي.** |

### 3.1 شجرة السبب الجذري

```
20261228_fix_company_weights_rpc_6fields.sql
  └── أُعيد كتابة governed_upsert_company_monthly_target
       └── نُسِيَ dual-write إلى performance_weights_config
            └── company_monthly_targets يُحدَّث (ما يراه المستخدم)
            └── performance_weights_config متجمد (ما يستخدمه المحرك)
                 └── Overall Score يحسب بأوزان قديمة
                      └── المستخدم يغيّر أوزانًا لا تؤثر على النتيجة
```

---

## 4. خطة الإصلاح المقترحة (Phase 0.1)

| الخطوة | الإجراء | الخطر |
|--------|---------|-------|
| 1 | إعادة dual-write في `governed_upsert_company_monthly_target` ليكتب أيضًا `performance_weights_config` | 🟢 منخفض — يعيد السلوك الأصلي |
| 2 | بعد الإصلاح، مسح `performance_weights_config` وإعادة كتابته بآخر أوزان من `company_monthly_targets` لأحدث شهر | 🟡 متوسط — قد يغيّر Overall Score الحالي |
| 3 | إضافة CHECK constraint على `company_monthly_targets.weights` = 100% | 🟢 منخفض — يمنع الأوزان الخاطئة مستقبلًا |

**البديل الأبسط:** بدلاً من الـ dual-write (الذي يعقّد الصيانة)، **توحيد المصدر**: جعل `get_governed_target_performance` يقرأ الأوزان من `company_monthly_targets` (حيث يكتب المستخدم) وإزالة الاعتماد على `performance_weights_config` للأوزان. `performance_weights_config` يبقى للـ fallback السنوي فقط.

---

**ملف التقرير الكامل:** `docs/kpi_canonicalization/RootCause_WeightsMismatch.md`
