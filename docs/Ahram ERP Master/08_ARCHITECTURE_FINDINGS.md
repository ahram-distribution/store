# 08 – Architecture Findings & Recommendations

**التصنيف:** نتائج وتحليلات معمارية  
**الغرض:** توثيق النتائج، المشاكل، المخاطر، والتوصيات  
**تاريخ المسح:** 5 يوليو 2026

---

## 1. Findings Summary

| الرقم | النتيجة | المستوى | التأثير |
|-------|---------|---------|---------|
| F-01 | **لا توجد طبقة تجريد للبيانات** — 165+ استدعاء مباشر لـ `supabase.rpc()` | 🔴 عالي | صعوبة تغيير قاعدة البيانات، صعوبة الاختبار |
| F-02 | **قواعد الأعمال موزعة** — RPCs, Services, Pages (3 طبقات) | 🔴 عالي | تكرار المنطق، صعوبة الصيانة |
| F-03 | **المصادقة مخصصة** — لا Supabase Auth، token في localStorage | 🟡 متوسط | أمن أقل، تجربة مستخدم أقل (لا silent refresh) |
| F-04 | **التوثيق محدود للغاية** — لا JSDoc، لا README في الـ packages | 🟡 متوسط | صعوبة فهم الكود للمطورين الجدد |
| F-05 | **لا اختبارات** — 0 ملف اختبار (unit/integration/e2e) | 🔴 عالي | مخاطرة عالية عند التغيير |
| F-06 | **لا TypeScript strict mode** — أي `any` مسموح | 🟡 متوسط | فقدان فوائد TypeScript |
| F-07 | **التسعير معزول جزئياً** — Pricing Engine نظيف لكن الصفحات تكرر حساب الأسعار | 🟡 متوسط | تناقض في الأسعار أحياناً |
| F-08 | **حوكمة الوصول في طبقتين** — RPC + Frontend (useCapability) | 🟢 منخفض | مقبول أمنياً (defense in depth) |
| F-09 | **لا i18n Framework** — العربية ثابتة في codebase | 🟢 منخفض | الحالي كافٍ، لكن التوسع صعب |
| F-10 | **Capacitor بدون تكوين واضح** — لا `capacitor.config.ts` | 🟡 متوسط | شك في أن Capacitor غير نشط فعلاً |
| F-11 | **لا Monitoring/Logging** — لا Sentry، لا LogRocket، لا Application Insights | 🟡 متوسط | صعوبة تتبع الأخطاء في الإنتاج |
| F-12 | **التوجيه Hash vs Browser** — تبديل تلقائي حسب الجهاز (دقة جيدة) | 🟢 منخفض | مقبول |
| F-13 | **التخزين المحلي للـ Preference** — إعدادات متفرقة (localStorage, zustand persist) | 🟢 منخفض | مقبول |
| F-14 | **Service Worker + IndexedDB** — Offline queue للتتبع GPS | 🟢 منخفض | حل جيد للـ offline |
| F-15 | **الـ Form Validation** — معظمها يدوي (ليس react-hook-form أو Formik) | 🟡 متوسط | تكرار جهد، احتمالية أخطاء |
| F-16 | **استخدام Faker.js في الإنتاج؟** — موجود في `node_modules` | 🟡 متوسط | تحقق: هل يستخدم في build النهائي؟ |

---

## 2. Critical Issues

### 🔴 F-01: No Data Provider Layer

**المشكلة:**  
لا توجد طبقة بين الـ UI وقاعدة البيانات. كل صفحة أو Service تستدعي `supabase.rpc()` مباشرة.

**الخطر:**
- تغيير اسم RPC = تغيير في كل مكان يُستخدم
- تغيير قاعدة البيانات (Supabase → أخرى) = إعادة كتابة كاملة
- لا Mocking سهل → اختبارات صعبة

**الحل المقترح:**  
إنشاء **Data Provider Layer** — كل Service ينفذ واجهة `IDataProvider<T>` مع دوال: `getAll`, `getById`, `create`, `update`, `delete`.  
الـ UI يتعامل مع Provider فقط، ولا يعرف شيئاً عن Supabase.

### 🔴 F-05: No Tests

**المشكلة:**  
لا يوجد ملف اختبار واحد في المشروع.

**الخطر:**
- تغيير أي RPC أو منطق أعمال قد يكسر النظام دون اكتشاف
- إعادة بناء (refactoring) شبه مستحيلة
- وقت أطول لاكتشاف الأخطاء

**الحل المقترح:**
1. البدء بـ **Unit Tests** لـ `src/engine/pricing.ts` (معزول ولا يحتاج Mock)
2. **Integration Tests** لـ الـ Services بعد إنشاء Data Provider Layer
3. **E2E Tests** للـ flows الحرجة (تسجيل دخول → طلب → دفع)

---

## 3. Medium Issues

### 🟡 F-03: Custom Auth

**الحل المقترح:**
- إضافة silent refresh (check session validity كل 15 دقيقة بدون تدخل المستخدم)
- الانتقال لاحقاً لـ `httpOnly` cookies عبر API middleware بين Supabase و Frontend
- أو استخدام Supabase Auth مع `supabase.auth.onAuthStateChange()`

### 🟡 F-04: No Documentation

**الحل المقترح:**
- إضافة JSDoc لـ 3 ملفات أساسية كبداية: `src/engine/pricing.ts`, `src/store/auth.ts`, `src/services/auth.ts`
- توثيق RPC functions في قاعدة البيانات (comment على كل function)

### 🟡 F-06: No strict mode

**الحل المقترح:**
- تفعيل `strict: true` في `tsconfig.json` تدريجياً
- إضافة `noImplicitAny` أولاً، ثم `strictNullChecks`

### 🟡 F-07: Duplicate Pricing Logic

**الحل المقترح:**
- توحيد حساب السعر في **Pricing Engine فقط**
- كل صفحة تستخدم pricing engine لحساب الأسعار
- إزالة logic المكرر من الصفحات

### 🟡 F-10/F-16: Capacitor & Faker

**الحل المقترح:**
- إنشاء `capacitor.config.ts` إذا كان Capacitor مستهدفاً
- إزالة `faker-js` من dependencies إذا كان للـ dev فقط

---

## 4. Recommendations Priority Matrix

| الأولوية | المهمة | الجهد | الأثر | الرابط |
|----------|--------|-------|-------|--------|
| 1 | Data Provider Layer | كبير | **عالي جداً** | F-01 |
| 2 | Unit Tests للـ Pricing Engine | صغير | **عالي** | F-05, F-07 |
| 3 | تفعيل strict mode (noImplicitAny) | وسط | **متوسط** | F-06 |
| 4 | Silent Refresh / Session Management | وسط | **متوسط** | F-03 |
| 5 | Pricing Logic توحيد | صغير | **متوسط** | F-07 |
| 6 | JSDoc للملفات الأساسية | صغير | **منخفض** | F-04 |
| 7 | Monitoring (Sentry or similar) | وسط | **متوسط** | F-11 |
| 8 | إزالة Faker من الإنتاج | صغير | **منخفض** | F-16 |

---

## 5. Deferred Recommendations (Long Term)

| المقترح | السبب |
|---------|-------|
| i18n (إضافة English) | لا حاجة ماسّة حالياً |
| Supabase Auth بدل المخصص | إعادة كتابة كبيرة للمصادقة |
| E2E Tests | يحتاج CI/CD pipeline |
| Capacitor Mobile Build | غير مؤكد أن Capacitor مستخدم |
| Form Library (react-hook-form) | تحسين تجربة المطور لكن غير ضروري الآن |

---

## 6. Architecture Health Score

| المعيار | الدرجة | التعليق |
|---------|--------|---------|
| فصل الاهتمامات (Separation of Concerns) | ⭐⭐⭐ | طبقات Pages/Services/Engine واضحة لكن Services تعمل 3 أدوار |
| قابلية التوسع (Scalability) | ⭐⭐⭐⭐ | التطبيق صغير — الهيكل الحالي مناسب لحجمه |
| قابلية الاختبار (Testability) | ⭐⭐ | لا اختبارات + اقتران بقاعدة البيانات |
| قابلية الصيانة (Maintainability) | ⭐⭐⭐ | منطق موزع لكنه منظم في ملفات معقولة |
| الأمان (Security) | ⭐⭐⭐⭐ | Defense in depth (RPC + Frontend) لكن token في localStorage |
| الأداء (Performance) | ⭐⭐⭐⭐ | تطبيق صغير — Supabase RPC سريع |
| التوثيق (Documentation) | ⭐ | **هذا المستند أكبر إنجاز توثيقي في المشروع** |

**الدرجة الإجمالية: ⭐⭐⭐ (متوسط — يحتاج تحسينات أساسية)**

---

## 7. Next Steps

1. ✅ **Data Provider Layer** — القرار للـ Product Owner (تأجيل أم بدء فوري)
2. ✅ **إضافة Unit Tests** للـ Pricing Engine (بدء فوري، جهد صغير)
3. ✅ **تفعيل `noImplicitAny`** (جهد نصف يوم)
4. ✅ **توثيق** Pricing Engine + Auth Service (جهد يوم واحد)
5. ✅ **مراجعة** Capacitor و Faker (جهد ساعتين)

---

## 8. Appendix: طبقة Data Provider — النموذج المقترح

```typescript
// src/providers/interfaces.ts
interface IDataProvider<T> {
  getAll(filter?: Filter): Promise<T[]>
  getById(id: string): Promise<T | null>
  create(data: Partial<T>): Promise<T>
  update(id: string, data: Partial<T>): Promise<T>
  delete(id: string): Promise<void>
}

// src/providers/orderProvider.ts
class OrderProvider implements IDataProvider<Order> {
  private client = supabase

  async getAll(filter?: Filter): Promise<Order[]> {
    return this.client.rpc('get_governed_orders', { p_token, p_filter: filter })
  }
  // ...
}
```

الفائدة: تغيير قاعدة البيانات لاحقاً (مثلاً إلى PostgreSQL مباشر) يتطلب فقط Provider جديد — بدون تغيير في الـ UI أو Services.
