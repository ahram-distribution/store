# Weights Canonical Source — Final Decision Report

**حالة الخطة:** 📋 لا تنفيذ — تقرير تمهيدي  
**السؤال:** `performance_weights_config` هل ما زال يعتمد عليه؟  

---

## 1. إجابة السؤال: هل `performance_weights_config` ما زال مستخدمًا؟

### ✅ نعم — مستخدم بواسطة دالتين فقط (قراءة فقط، لا كتابة)

بعد فحص جميع الـ SQL في كل migrations (32 ملفًا)، ها هي الاستخدامات الفعلية (التعاريف النهائية التي تغلب):

| # | الدالة | الملف الأحدث | السطور | نوع الوصول |
|---|--------|-------------|-------|-----------|
| **1** | `get_governed_target_performance` (company weights) | `20261229_fix_company_target_source.sql` | 35, 47 | **READ** — `SELECT * INTO v_company_weights_record FROM public.performance_weights_config WHERE target_year = v_target_year` |
| **2** | `get_effective_weights` (employee fallback) | `20261201_phase_c1_dynamic_weights.sql` | 58, 92 | **READ** — `SELECT * INTO v_config FROM public.performance_weights_config WHERE target_year = p_target_year` |

### ❌ لا يُكتب فيه — لا توجد كتابة نشطة

`governed_upsert_company_monthly_target` (آخر إصدار: `20261228`) يكتب **فقط** في `company_monthly_targets`. لا يوجد سطر واحد من `performance_weights_config` في `20261228`.

### ❌ لا يُستخدم في:
- أي Trigger أو Event Trigger
- أي View
- أي Scheduled Job
- أي Frontend (TypeScript/React)
- أي شاشة UI مباشرة
- أي RPC آخر
- أي Service خارجي

### ما تم إلغاؤه (Overridden):

جميع الإشارات الأخرى في old migrations تم إلغاؤها بواسطة أحدث `CREATE OR REPLACE FUNCTION`:

| سابقًا في | ما كان يفعله | أُلغِي بواسطة |
|-----------|-------------|--------------|
| `20260612_phase4_targets_governance.sql:330` | `INSERT INTO performance_weights_config` (dual-write) | `20261228_fix_company_weights_rpc_6fields.sql` |
| `20260612_phase4_targets_governance.sql:265` | `SELECT FROM performance_weights_config` (في `get_governed_company_monthly_target`) | `20261228_fix_company_weights_rpc_6fields.sql` |

---

## 2. القرار: مصدر الحقيقة الوحيد للأوزان

| البند | القرار |
|-------|--------|
| **الجدول المعتمد** | `company_monthly_targets` |
| **المستوى** | شهري (target_month, target_year) |
| **الحقول** | 6 أوزان: `sales_weight_percent`, `visits_weight_percent`, `orders_weight_percent`, `new_customers_weight_percent`, `collections_weight_percent`, `attendance_weight_percent` |
| **لماذا؟** | WeightsTab يقرأ ويكتب فيه بالفعل. المستخدم يعدّل شهريًا. وهو الجدول الوحيد الذي يُكتب فيه حاليًا. |

### 2.1 مصير `performance_weights_config`

```
┌─────────────────────────────────────────────────┐
│          performance_weights_config              │
├─────────────────────────────────────────────────┤
│  ✅ تم إنشاؤه في 20260612                       │
│  ✅ أُضيف إليه orders_weight_percent في 20261201 │
│  ✅ آخر كتابة إليه: 2026-06-28 (قبل 6 أشهر)     │
│  ❌ لا يُكتب فيه منذ 20261228                    │
│  ❌ سيتوقف قراءته بعد التعديل                    │
├─────────────────────────────────────────────────┤
│  مصيره: LEGACY — يُوثق كجدول تاريخي              │
│  لا يُحذف — البيانات مفيدة للتدقيق (Audit Trail)  │
│  يتم إيقاف جميع القراءات منه                     │
│  يُضاف تعليق DOC إلى table + كل column: legacy    │
└─────────────────────────────────────────────────┘
```

---

## 3. التعديلات المطلوبة (بدون Dual Write)

### 3.1 تعديل `get_governed_target_performance` — قراءة أوزان الشركة

**حاليًا (20261229:35,47):**
```sql
v_company_weights_record public.performance_weights_config;
...
SELECT * INTO v_company_weights_record
FROM public.performance_weights_config
WHERE target_year = v_target_year;
```

**المطلوب:**
```sql
-- حذف v_company_weights_record
-- قراءة الأوزان الـ 6 من company_monthly_targets مباشرة
SELECT
    sales_weight_percent,
    visits_weight_percent,
    orders_weight_percent,
    new_customers_weight_percent,
    collections_weight_percent,
    attendance_weight_percent
INTO v_comp_sales_weight, v_comp_visits_weight, v_comp_orders_weight,
     v_comp_new_customers_weight, v_comp_collections_weight, v_comp_attendance_weight
FROM public.company_monthly_targets
WHERE target_month = v_target_month AND target_year = v_target_year;
```

لا حاجة لـ IF NOT FOUND — لأننا نعرف أن الـ target row موجود (تأكدنا منه في السطور 59-68).

### 3.2 تعديل `get_effective_weights` — قراءة أوزان الموظف

**حاليًا (20261201:58,92):**
```sql
v_config public.performance_weights_config;
...
SELECT * INTO v_config
FROM public.performance_weights_config
WHERE target_year = p_target_year;
```

**المطلوب:**
```sql
v_config_record record;  -- استبدال النوع بـ record
...
SELECT sales_weight_percent, visits_weight_percent, orders_weight_percent,
       new_customers_weight_percent, collections_weight_percent, attendance_weight_percent
INTO v_config_record
FROM public.company_monthly_targets
WHERE target_month = p_target_month AND target_year = p_target_year;

IF FOUND THEN
    v_result := jsonb_build_object(
        'source', 'config',
        'sales_weight_percent', v_config_record.sales_weight_percent,
        ...
    );
    RETURN v_result;
END IF;
```

### 3.3 هل يؤثر هذا على `employee_weight_overrides`؟

لا. `get_effective_weights` يقرأ الـ overrides أولاً:

```
employee_weight_overrides  (per employee-month)
  └── first check ✅ — لا يتغير
company_monthly_targets    (per month)  ← جديد
  └── second check ✅ — بدلاً من performance_weights_config
Hardcoded defaults         (fallback)
  └── third check ✅ — لا يتغير
```

---

## 4. الـ SQL الخام للتعديل

التعديلان مقتصران على ملفين فقط، لا حاجة لإنشاء ملف جديد — يمكن تعديل الملفين الحاليين:

| التعديل | الملف | الحجم التقريبي |
|---------|-------|---------------|
| 3.1 — تغيير قراءة أوزان الشركة | `20261229_fix_company_target_source.sql` | ~5 أسطر |
| 3.2 — تغيير قراءة أوزان الموظف | `20261201_phase_c1_dynamic_weights.sql` | ~10 أسطر |

لا تغيير في:
- `governed_upsert_company_monthly_target` ✅ (يكتب بالفعل في `company_monthly_targets`)
- `get_governed_company_monthly_target` ✅ (يقرأ بالفعل من `company_monthly_targets`)
- `WeightsTab.tsx` ✅ (يقرأ ويكتب من `company_monthly_targets`)
- `targets.ts` ✅ (يستخدم نفس الـ RPCs)

**لا Dual Write.** مصدر واحد: `company_monthly_targets`.

---

## 5. التأثير على Canonical System Spec

- **Canonical_System_Spec.md** سطر 175 و 202: تحديث الـ Single Source of Truth ليعكس أن `company_monthly_targets` هو مصدر الأوزان.
- **Canonical_System_Spec.md** سطر 101: `performance_weights_config` يُوسم كـ LEGACY.
- **Phase5_Implementation_Plan.md** يبدأ مباشرةً بالخطوات بعد هذا الإصلاح.

---

## 6. الخلاصة

| السؤال | الإجابة |
|--------|---------|
| هل هناك اعتماد فعلي على `performance_weights_config`؟ | ✅ نعم — دالتان تقرأان منه |
| هل هناك كتابة إليه؟ | ❌ لا — آخر كتابة 2026-06-28 |
| هل هو Legacy؟ | ✅ نعم — يمكن إيقاف القراءة منه وتحويله إلى مرجع تاريخي فقط |
| هل هناك حاجة لـ Dual Write؟ | ❌ لا — مصدر واحد: `company_monthly_targets` |
| هل التعديل خطير؟ | 🟢 منخفض — مقتصر على تغيير `FROM` clause في دالتين |
| هل يحتاج Migration جديد؟ | نعم — `CREATE OR REPLACE FUNCTION` للدالتين |
| هل يحتاج تغيير Frontend؟ | لا |

---

**بعد اعتمادك، سأعد ملف Migration واحدًا ينفذ التعديلين معًا، ثم نبدأ Phase 5 مباشرة.**
