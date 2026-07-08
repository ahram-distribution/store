# 14 – Implementation Strategy

**التصنيف:** تصميم معماري — استراتيجية التنفيذ  
**الغرض:** توثيق خطوات البدء الفوري لتنفيذ Data Provider Architecture  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** مسودة للاعتماد

---

## 1. المبادئ الأساسية

| المبدأ | الشرح |
|--------|-------|
| **البدء بالهيكل** | المجلدات والمجلدات الفارغة والـ Contracts أولاً |
| **قبل أي كود تنفيذي** | الـ Interfaces تُعتمد قبل أي Provider Implementation |
| **اختبار منذ اليوم الأول** | كل سطر كود جديد له اختبار |
| **القديم يبقى** | لا حذف للـ services القديمة حتى استكمال الترحيل |
| **التوثيق الموازي** | كل خطوة توثق — لا ترحيل دون توثيق |

---

## 2. أولويات التنفيذ

### الأولوية الأولى: الهيكل والـ Contracts

```
أهم 5 ملفات يجب إنشاؤها أولاً:
1. IProvider.ts          — القاعدة لكل Provider
2. ICrudProvider.ts      — الـ CRUD القياسي
3. IProviderRegistry.ts  — تسجيل واستعلام الـ Providers
4. exceptions.ts         — نظام الأخطاء
5. IOrderProvider.ts     — أول Interface خاص بكيان
```

**السبب:** هذه الملفات تحدد العلاقة بين كل الطبقات. بدونها لا يمكن البدء بأي تنفيذ.

### الأولوية الثانية: بُنية تحتية (Infrastructure)

```
1. ProviderRegistry.ts   — التنفيذ الملموس (Singleton)
2. MockDataStore.ts      — بيانات وهمية للتطوير
3. bootstrap.ts          — ربط كل شيء
```

### الأولوية الثالثة: أول Provider حقيقي

```
MockOrderProvider.ts — أول Provider يعمل
  → يسمح بإجراء اختبارات فورية
  → يسمح باختبار Application Layer دون Supabase
```

### الأولوية الرابعة: أول Application Service

```
OrderQueryService.ts — أول استخدام فعلي
  → ربط UI → Application → Provider
  → اختبار التدفق الكامل
```

---

## 3. خطة البدء الفوري (الأسبوع الأول)

### اليوم 1-2: التأسيس

| المهمة | التفاصيل | الملفات |
|--------|----------|---------|
| إنشاء مجلدات | `providers/`, `application/`, `domain/` مع مجلداتها الفرعية | ~15 مجلداً |
| إنشاء `IProvider.ts` | الـ Base Interface | 1 |
| إنشاء `ICrudProvider.ts` | CRUD مع Pagination و Filtering | 1 |
| إنشاء `IReadOnlyProvider.ts` | للقراءة فقط | 1 |
| إنشاء `IProviderRegistry.ts` | واجهة التسجيل | 1 |
| إنشاء `exceptions.ts` | ProviderException + مشتقاته | 1 |
| إنشاء `IUnitOfWork.ts` | واجهة المعاملات | 1 |

**المخرجات:** 7 ملفات واجهات، ~15 مجلداً جاهزاً

### اليوم 3-4: التنفيذ الأساسي

| المهمة | التفاصيل | الملفات |
|--------|----------|---------|
| تنفيذ `ProviderRegistry.ts` | Singleton مع تسجيل/استعلام/افتراضي | 1 |
| إنشاء `MockDataStore.ts` | بيانات وهمية في الذاكرة (قابلة للتوسعة) | 1 |
| تنفيذ `MockOrderProvider.ts` | كامل — جميع دوال IOrderProvider | 1 |
| تنفيذ `MockProductProvider.ts` | كامل — جميع دوال IProductProvider | 1 |
| إنشاء `IOrderProvider.ts` | أول Interface خاص لكيان | 1 |
| إنشاء `IProductProvider.ts` | Interface للمنتجات | 1 |

**المخرجات:** Registry + 2 Mock Providers + 2 Interfaces للكيانات

### اليوم 5: الربط والاختبار

| المهمة | التفاصيل | الملفات |
|--------|----------|---------|
| إنشاء `bootstrap.ts` | تسجيل MockOrderProvider + MockProductProvider | 1 |
| تعديل `main.tsx` | استدعاء `bootstrap()` | تعديل بسيط |
| كتابة اختبار | `MockOrderProvider.test.ts` — كل الدوال | 1 |
| كتابة اختبار | `ProviderRegistry.test.ts` — تسجيل + استعلام + افتراضي | 1 |

**المخرجات:** النظام الأساسي يعمل — `registry.resolve<IOrderProvider>('order')` يعيد بيانات وهمية

---

## 4. الأسبوع الثاني: First Application Service

### اليوم 6-7

| المهمة | التفاصيل |
|--------|----------|
| إنشاء `domain/models/Order.ts` | نقل Order types من `types/` |
| إنشاء `domain/models/Product.ts` | نقل Product types |
| إنشاء `application/dto/order/` | CreateOrderRequest, OrderResponse, OrderFilter |
| إنشاء `application/mappers/OrderMapper.ts` | Order → OrderResponse + CreateOrderRequest → Order |
| إنشاء `application/validators/CreateOrderValidator.ts` | التحقق من صحة المدخلات |

### اليوم 8-9

| المهمة | التفاصيل |
|--------|----------|
| إنشاء `OrderQueryService.ts` | getById, listOrders, getStats |
| إنشاء `OrderCommandService.ts` | create, update, delete |
| كتابة اختبارات لكل Application Service | استخدام MockOrderProvider |

### اليوم 10

| المهمة | التفاصيل |
|--------|----------|
| ترحيل **صفحة واحدة** (مقترح: OrderListPage) لاستخدام `OrderQueryService` | تعديل الصفحة |
| اختبار A/B: نفس الطلب ← Provider قديم = Provider جديد | سكريبت مقارنة |
| **اعتماد أو رفض** النهج من Product Owner | اجتماع |

**القرار الحاسم:** بعد ترحيل أول صفحة وتجربتها → إما اعتماد النهج والاستمرار، أو تعديل النهج قبل التوسع.

---

## 5. الأسبوع الثالث: Core Supabase Providers

### اليوم 11-13

| المهمة | التفاصيل |
|--------|----------|
| إنشاء `SupabaseProvider.ts` | Base class — connect, disconnect, healthCheck |
| تنفيذ `SupabaseOrderProvider.ts` | ترحيل RPCs من `services/orders.ts` |
| تنفيذ `SupabaseProductProvider.ts` | ترحيل RPCs من `services/products.ts` |
| تنفيذ `SupabaseUserProvider.ts` | ترحيل RPCs من `services/auth.ts` |
| تنفيذ `SupabaseUnitOfWork.ts` | استخدام PostgreSQL transactions |

### اليوم 14-15

| المهمة | التفاصيل |
|--------|----------|
| إنشاء `ICustomerProvider.ts` | Interface + تنفيذ SupabaseCustomerProvider |
| إنشاء `ICreditProvider.ts` | Interface + تنفيذ SupabaseCreditProvider |
| ربط SupabaseProviders في `bootstrap.ts` | تسجيلها مع الاحتفاظ بـ Mock للاختبار |
| اختبارات تكامل (Integration Tests) | Supabase حقيقي + بيانات اختبار |

---

## 6. توزيع الملفات حسب الأسبوع

```
الأسبوع 1: الهيكل والـ Contracts
  src/providers/contracts/*.ts       (7 ملفات)
  src/providers/registry/*.ts        (2 ملفات)
  src/providers/implementations/mock/*.ts  (3 ملفات)
  src/bootstrap.ts

الأسبوع 2: Application Layer + أول صفحة
  src/domain/models/*.ts             (3-4 ملفات)
  src/application/dto/order/*.ts     (4-5 ملفات)
  src/application/mappers/*.ts       (1-2 ملفات)
  src/application/validators/*.ts    (1-2 ملفات)
  src/application/services/order/*.ts (2 ملفات)
  src/application/factories/*.ts     (1 ملف)

الأسبوع 3: Supabase Providers
  src/providers/implementations/supabase/*.ts (6-7 ملفات)
  تحديث bootstrap.ts

الأسبوع 4+: ترحيل بقية الصفحات
  (حسب جدول المراحل في 13_PROVIDER_MIGRATION_PLAN.md)
```

---

## 7. قائمة المراجعة (Checklist) لكل خطوة

قبل اعتبار أي خطوة "مكتملة":

| ✅ | المعيار |
|----|---------|
| ☐ | الـ Interface معتمد (لا تغييرات متوقعة) |
| ☐ | التنفيذ موجود |
| ☐ | اختبار يمر (unit على الأقل) |
| ☐ | النظام القديم لا يزال يعمل |
| ☐ | لا أخطاء TypeScript (`npm run typecheck`) |
| ☐ | التوثيق محدّث (إذا لزم) |

---

## 8. متطلبات النجاح (Prerequisites)

| المتطلب | الحالة | ملاحظات |
|---------|--------|---------|
| اعتماد Product Owner على الـ Architecture | 🔴 مطلوب | هذه الوثائق تحتاج موافقة |
| إعداد Vitest للاختبارات | 🔴 مطلوب | قد لا يكون مثبتاً |
| تفعيل `strict: true` في tsconfig | 🟡 اختياري | مفضّل لكن ليس ضرورياً للبدء |
| Supabase Local للتطوير | 🟡 اختياري | للتكامل (Integration Tests) |
| فهم الفريق للـ Architecture | 🟡 اختياري | يمكن ورشة عمل عند البدء |

---

## 9. مؤشرات التقدم (KPIs)

| الـ KPI | الهدف | كيف يُقاس |
|---------|-------|-----------|
| عدد الـ Providers المنفذة | 8+ بعد 3 أسابيع | عد الملفات في `providers/implementations/` |
| عدد الـ Application Services | 6+ بعد 4 أسابيع | عد الملفات في `application/services/` |
| عدد الصفحات المترحلة | 3+ بعد 4 أسابيع | عد الصفحات التي لا تستورد من `services/` |
| تغطية الاختبارات | 50%+ للـ Providers | Vitest coverage |
| لا استدعاء supabase.rpc() في الصفحات | 100% | grep نتائج |

---

## 10. الخلاصة — ماذا الآن؟

| الخطوة | المسؤول | التوقيت |
|--------|---------|---------|
| تقديم وثائق الـ Architecture للمراجعة | أنت | الآن |
| مراجعة واعتماد الـ Architecture | Product Owner | خلال 2-3 أيام |
| إنشاء `src/providers/contracts/IProvider.ts` | Implementation | اليوم الأول بعد الاعتماد |
| إنشاء `src/bootstrap.ts` | Implementation | اليوم الأول |
| ترحيل أول صفحة | Implementation | خلال أسبوعين من الاعتماد |
| اجتماع المراجعة الأول | أنت + Product Owner | بعد أول صفحة مترحلة |

---

## 11. ملاحظات ختامية

1. **لا تنتظر الكمال** — ابدأ بالحد الأدنى القابل للتطبيق (MVP): Interface + Mock + Application Service + صفحة واحدة
2. **الاختبارات ليست ترفاً** — بدون اختبارات، الترحيل إلى Provider جديد سيكون صعباً (وهذا بالضبط ما نريد حله)
3. **التوثيق هو الخريطة** — وثائق TASK-002 الـ 6 يجب أن تكون مرجعاً لكل قرار تنفيذي تالٍ
4. **التغيير الأكبر ليس في الشيفرة** — التغيير الأكبر هو في **طريقة التفكير**: كل قطعة بيانات تأتي من Provider، وكل Provider ينفذ Interface
