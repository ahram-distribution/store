# Verification Report — Phase 0: Weights Canonical Source Fix

**تاريخ التنفيذ:** 2026-12-31  
**الميغرايشن:** `20261231_fix_weights_canonical_source.sql`  
**الحالة:** ✅ **معتمد — جميع الاختبارات تمر**

---

## 1. ما تم تغييره

| المكوّن | قبل | بعد |
|---------|-----|-----|
| `governed_upsert_company_monthly_target` | يكتب في `company_monthly_targets` ✅ | لا تغيير ✅ |
| `get_governed_company_monthly_target` | يقرأ من `company_monthly_targets` ✅ | لا تغيير ✅ |
| `get_effective_weights` | يقرأ من **`performance_weights_config`** ❌ | يقرأ من **`company_monthly_targets`** ✅ |
| `get_governed_target_performance` | يقرأ من **`performance_weights_config`** ❌ | يقرأ من **`company_monthly_targets`** ✅ |
| `performance_weights_config` | مصدر نشط | **LEGACY** — معلم بـ COMMENT |

**مصدر الحقيقة الوحيد:** `company_monthly_targets`  
**لا Dual Write.** لا كتابة إلى `performance_weights_config`.

---

## 2. التحقق: التعديلات في الكود

### ✅ 2.1 جدول `performance_weights_config` — تم وسمه كـ Legacy

```
COMMENT ON TABLE public.performance_weights_config IS
  'LEGACY TABLE — DO NOT USE in new development. ...'
```

### ✅ 2.2 `get_effective_weights`

| المعيار | النتيجة |
|---------|--------|
| يقرأ من `company_monthly_targets` | ✅ نعم |
| يقرأ من `performance_weights_config` | ❌ لا |
| متغير `v_monthly_targets` موجود | ✅ نعم |

### ✅ 2.3 `get_governed_target_performance`

| المعيار | النتيجة |
|---------|--------|
| يقرأ من `company_monthly_targets` | ✅ نعم |
| يقرأ من `performance_weights_config` | ❌ لا |
| متغير `v_company_weights_record` موجود | ❌ أُزيل |

---

## 3. التحقق: سلوك الإنتاج

### ✅ 3.1 Company Weights — قبل التعديل

```
performance_weights_config (2026):   sales=75  visits=10   orders=7.5   new_cust=7.5  coll=0  att=0
company_monthly_targets    (June):   sales=75  visits=7.5  orders=10    new_cust=7.5  coll=0  att=0
```

**غير متطابقين** — visits و orders مقلوبان. هذا يُثبت أن المحرك كان يقرأ من جدول مختلف.

### ✅ 3.2 Company Weights — بعد التعديل

```
get_governed_target_performance تعيد:
  sales_weight: 75
  visits_weight: 7.5   ← تطابق company_monthly_targets ✅
  orders_weight: 10    ← تطابق company_monthly_targets ✅
  new_cust_weight: 7.5
  coll_weight: 0
  att_weight: 0
```

**المحرك الآن يقرأ من `company_monthly_targets`** — نفس الجدول الذي يكتب فيه WeightsTab.

### ✅ 3.3 تعديل وزن → تغيير Overall Score

| الخطوة | النتيجة |
|--------|---------|
| Overall Score قبل التعديل | **2.83%** |
| تغيير sales_weight 75 → 50, visits_weight 7.5 → 25 | تم |
| Overall Score بعد التعديل | **3.65%** |
| هل تغير؟ | **✅ نعم** — الوزن الجديد أثّر على الحساب |

**الدليل القاطع:** تغيير الوزن في `company_monthly_targets` غيّر Overall Score.

### ✅ 3.4 Employee Weight Overrides لا تزال تعمل

| الموظف | المصدر | النتيجة |
|--------|--------|---------|
| عمر محسن (REP003) | `override` | **15.44%** — أوزان مخصصة (40/25/10/7.5/15/10) ✅ |
| حسين علي (EMP-2026--000012) | `config` | **2.32%** — أوزان الشركة القياسية ✅ |
| محمد حافظ (REP002) | `config` | **2.00%** — أوزان الشركة القياسية ✅ |

**الترتيب:** override → `company_monthly_targets` → defaults. يعمل كما هو متوقع.

### ✅ 3.5 No Override → Company Weights

عندما لا يوجد override، `get_effective_weights` يقرأ من `company_monthly_targets` (خلال الاستعلام: `WHERE target_month=p_target_month AND target_year=p_target_year`) ويعيد `source: "config"` مع أوزان الشركة الصحيحة.

---

## 4. مصير `performance_weights_config`

| السؤال | الإجابة |
|--------|---------|
| هل يُكتب فيه؟ | ❌ لا (آخر كتابة 2026-06-28) |
| هل يُقرأ منه؟ | ❌ لا (بعد التعديل) |
| هل سيُحذف؟ | ❌ لا — يُحتفظ به كـ Legacy/Audit Trail |
| هل مسموح استخدامه في تطوير جديد؟ | ❌ ممنوع — موثّق في COMMENT و Canonical System Spec |

---

## 5. الخلاصة

| الاختبار | النتيجة |
|----------|---------|
| الـ Migration نُفذ بدون أخطاء | ✅ |
| `performance_weights_config` وُسم كـ Legacy | ✅ |
| `get_effective_weights` يقرأ من `company_monthly_targets` | ✅ |
| `get_governed_target_performance` يقرأ من `company_monthly_targets` | ✅ |
| Overall Score يستجيب لتعديل الوزن | ✅ |
| Employee Overrides تعمل | ✅ |
| No Override → Company Weights الصحيحة | ✅ |
| **مصدر حقيقة واحد للأوزان** | ✅ **مُعتمد** |

---

**Phase 0 — مكتملة.**  
**جاهزون لـ Phase 5: Activity Screen Unification.**
