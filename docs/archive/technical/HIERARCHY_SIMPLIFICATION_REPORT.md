# HIERARCHY SIMPLIFICATION REPORT

**التاريخ:** 2026-06-16  
**الهدف:** إلغاء نظام "منع الوصول للداتا" والتحول إلى "نظام يعرض نفس الداتا لكن بشكل مختلف حسب الدور فقط"

---

## 1. الخلاصة

تم إزالة **التعقيدات التالية** من النظام:

| التعقيد | الحالة |
|----------|--------|
| `supabaseProxy` — Proxy على Supabase client | ✅ تمت الإزالة |
| `registerGeolocationGuard` — منع navigator.geolocation | ✅ تمت الإزالة |
| `registerWindowOpenGuard` — منع whatsapp:// | ✅ تمت الإزالة |
| `createBlockedQuery` — رد كاذب للاستعلامات المحظورة | ✅ تمت الإزالة |
| `BLOCKED_TABLES` — قائمة الجداول المحظورة | ✅ تمت الإزالة |
| `checkDirectTableAccess` — فحص الجداول قبل الاستعلام | ✅ تمت الإزالة |
| Violation logging (`warnDeprecatedUsage`, `getViolationLog`, `reportViolations`) | ✅ تمت الإزالة |
| `useRef(guardsActivated)` في App.tsx | ✅ تمت الإزالة |

وتم **الاحتفاظ بـ:**

| المكون | السبب |
|--------|-------|
| `gpsEngine` | واجهة نظيفة لخدمة GPS — لا intercept، مجرد Aliases |

---

## 2. ما تم إنشاؤه

### `src/utils/hierarchyDataFilter.ts`

طبقة خفيفة وبسيطة تحدد دور المستخدم (executive / manager / rep / customer) بدون أي منع أو Proxy.

**الوظائف:**

| الدالة | الغرض |
|--------|-------|
| `getEffectiveRole(user)` | تحويل user إلى دور فعلي (executive/manager/rep/customer) |
| `canAccessAll(user)` | هل المستخدم يرى كل شيء؟ (executive) |
| `canAccessTeam(user)` | هل المستخدم يرى فريقه؟ (executive + manager) |
| `getRoleLabel(role)` | تسمية عربية للدور |
| `getRoleDescription(role)` | وصف ما يراه كل دور |

**مبدأ العمل:**
- **لا تمنع** أي شيء
- **لا تعترض** أي استعلام
- **لا تستخدم** Proxy
- مجرد دوال مساعدة في طبقة العرض

---

## 3. التسلسل الهرمي الجديد

```
الإدارة العليا (executive)
    ↓ يرى كل شيء
مدير البيع (manager)
    ↓ يرى مناديبه + عملاءهم + طلباتهم
مندوب المبيعات (rep)
    ↓ يرى عملاءه وطلباته فقط
العميل (customer)
    ↓ يرى بياناته وطلباته فقط
```

**ملاحظة:** الفلترة الفعلية تحدث في الـ backend عبر RPCs الـ `governed_*` التي تأخذ `p_token`. طبقة `hierarchyDataFilter` توفر وسيلة مساعدة للـ view layer إذا احتاج فلترة إضافية.

---

## 4. التغييرات على الملفات

### ملفات تم تعديلها

| الملف | قبل | بعد |
|-------|------|-----|
| `src/utils/systemOfTruthGuard.ts` | 308 سطر — Proxy، GPS guard، WhatsApp guard، Supabase blocking، Violation logging | 14 سطر — فقط `gpsEngine` (Aliases لخدمة GPS) |
| `src/lib/supabase.ts` | 14 سطر — يستورد `supabaseProxy` ويلف الـ client | 9 سطر — `createClient` مباشر بدون Proxy |
| `src/App.tsx` | يستورد `registerGeolocationGuard`, `registerWindowOpenGuard` ويسجلهم في useEffect | فقط `healthMonitor.start()` |

### ملفات تم إنشاؤها

| الملف | المحتوى |
|-------|---------|
| `src/utils/hierarchyDataFilter.ts` | دوال تحديد الدور والفلترة المساعدة |
| `docs/archive/technical/HIERARCHY_SIMPLIFICATION_REPORT.md` | هذا التقرير |

### ملفات تم حذف محتوى منها (إزالة استيرادات)

| الملف | المحتوى المحذوف |
|-------|-----------------|
| `src/App.tsx` | استيراد `registerGeolocationGuard`, `registerWindowOpenGuard` |
| `src/App.tsx` | متغير `guardsActivated` و useEffect الخاص به |
| `src/lib/supabase.ts` | استيراد `supabaseProxy` |

---

## 5. أسباب الـ Crashes السابقة التي أُزيلت

| المشكلة | السبب | الإجراء |
|---------|-------|---------|
| White screen في `/store/storefront` | `createBlockedQuery` تستخدم Proxy على Promise بدون bind | تمت إزالة `createBlockedQuery` بالكامل |
| `Promise.prototype.then called on incompatible receiver` | Proxy يرجع `.then` بدون `.bind(target)` | تمت إزالة الـ Proxy بالكامل |
| صفحات تستخدم `supabase.from()` ترجع response فارغ | `supabaseProxy` يعترض ويعيد `{ data: null, error }` | تمت إزالة الـ supabaseProxy — الآن الاستعلامات المباشرة تعمل طبيعياً |
| CompaniesPage يظهر "لا توجد شركات" دائماً | `supabase.from('companies')` كان محظوراً | الآن يعمل الاستعلام ويعرض البيانات الحقيقية |

---

## 6. Build Status

| المؤشر | القيمة |
|--------|--------|
| أخطاء جديدة من التعديلات | **0** |
| أخطاء pre-existing (لم تتأثر) | 27 |
| الفرق من قبل | -4 errors (تمت إزالة systemOfTruthGuard.ts errors) |

---

## 7. بنية النظام بعد التبسيط

```
src/lib/supabase.ts
    └── createClient() مباشر — لا Proxy، لا intercept

src/utils/systemOfTruthGuard.ts
    └── gpsEngine — Aliases فقط لخدمات GPS

src/utils/hierarchyDataFilter.ts  ← NEW
    └── getEffectiveRole()
    └── canAccessAll()
    └── canAccessTeam()
    └── getRoleLabel()
    └── getRoleDescription()

جميع الصفحات:
    └── تستخدم supabase.rpc('governed_*', { p_token }) — نفس ما كانت تستخدمه
    └── أو supabase.from() مباشر — الآن يعمل دون منع
    └── الفلترة حسب الدور: اختيارية عبر hierarchyDataFilter في طبقة العرض
```

---

## 8. مقارنة قبل/بعد

| الجانب | قبل (Enforcement Layer) | بعد (Hierarchy Filter) |
|--------|------------------------|------------------------|
| Data layer | يعترض ويعيد response كاذب | لا يتدخل — يمرر الاستعلامات |
| view layer | يتعامل مع response محظور | يستخدم الفلترة إذا لزم الأمر |
| Runtime interference | عالٍ (Proxy, blocking, interception) | صفر |
| Debugging | صعب (response كاذب يخفي المشاكل) | سهل (الاستعلامات الحقيقية تظهر) |
| White screen | نعم (من Proxy) | لا |
| Flexibility | منخفض (قواطع صلبة) | عالي (اختياري) |

---

## 9. الخلاصة النهائية

تم تحويل النظام من:

> ❌ **"نظام يمنع الوصول للداتا"**

إلى:

> ✅ **"نظام يعرض نفس الداتا لكن بشكل مختلف حسب الدور فقط"**

كل الصفحات تفتح الآن، لا White screen، لا Crashes، ولا تعقيدات Proxy.
الاختلاف الوحيد هو في البيانات المعروضة حسب دور المستخدم — وتلك الفلترة تحدث في الـ backend عبر governed RPCs، مع أدوات مساعدة اختيارية في الـ view layer عبر `hierarchyDataFilter.ts`.
