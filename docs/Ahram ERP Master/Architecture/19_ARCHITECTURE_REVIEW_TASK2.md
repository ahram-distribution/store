# 19 – Architecture Review: TASK-002

**التصنيف:** مراجعة معمارية  
**الغرض:** مراجعة نقدية لتصميم TASK-002 (Data Provider Architecture) بعد تحديد قدرات الأعمال والتجميعات  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** مسودة للاعتماد

---

## 1. خلفية المراجعة

TASK-002 صمم Data Provider Architecture قبل تحديد قدرات الأعمال (TASK-003).

هذه المراجعة تقيم توافق TASK-002 مع مبادئ Business Capability Architecture.

---

## 2. ملخص المراجعة

| المجال | التقييم | التفاصيل |
|--------|---------|----------|
| **Provider Interfaces** | ⚠️ تحتاج تعديل | معظمها يركز على الجداول وليس القدرات |
| **Application Layer** | ✅ جيد | الهيكل سليم — يحتاج توافق مع القدرات |
| **Dependency Direction** | ⚠️ جزئياً | Registry يحتاج توضيح |
| **ProviderRegistry** | ❌ مشكلة | Global Singleton — لا يصلح للـ Desktop/Offline |
| **Factory Strategy** | ⚠️ محدود | لا يغطي Mirror + Multi-Provider |
| **UnitOfWork** | ⚠️ غير واقعي | لا يناسب Supabase ولا PostgreSQL العادي |
| **DTO Strategy** | ✅ جيد | لكن يحتاج توجيهاً أكثر حسب القدرات |

---

## 3. المراجعة التفصيلية

### 3.1 Provider Interfaces — تتبع الجداول وليس القدرات

| المشكلة | التوضيح |
|---------|---------|
| `IOrderProvider` | يوحي بأن الـ Provider يعكس جدول `orders`. الصحيح: `ISalesOrderProvider` — يعكس قدرة إدارة أوامر البيع |
| `IProductProvider` | يوحي بجدول `products`. الصحيح: `IProductCatalogProvider` — يعكس قدرة كتالوج المنتجات |
| `ICreditProvider` | واسع جداً — يمزج Credit Management مع Collections. الصحيح: `ICreditManagementProvider` + `ICollectionProvider` |
| `IUserProvider` | يمزج Auth + User Management. الصحيح: `IIdentityProvider` + `IAuthorizationProvider` + `IAdministrationProvider` |
| `IAttendanceProvider` | مقبول (قريب من قدرة Attendance & Time) |
| `ITrackingProvider` | مقبول (قريب من قدرة Employee Tracking) |

**التصحيح المطلوب:** إعادة تسمية وتوزيع الـ Provider Interfaces حسب Business Capabilities (15_BUSINESS_CAPABILITIES.md).

### 3.2 Application Layer — جيد لكن يحتاج توجيهاً

**ما هو جيد:**
- تقسيم Services إلى Query + Command + Use Case
- DTOs منفصلة للقراءة والكتابة
- Mappers خارج الـ Services
- Validators منفصلون

**ما يحتاج تعديل:**
- Application Services يجب أن تنظم حسب Business Capability وليس حسب الكيان
- بعض الـ Services في `11_APPLICATION_LAYER.md` لا تزال مركزة على الكيان (OrderService) بدل القدرة (SalesOrder)
- الـ Service Factory يحتاج أن يدعم تبديل Provider في Runtime

### 3.3 Dependency Direction — صحيح لكنه غير كافٍ

TASK-002 يقول أن الـ Presentation لا يستدعي Providers مباشر — وهذا صحيح.

**ما فاته:**
- لم يحدد أن **Domain لا يعرف أي شيء عن Providers**
- لم يحدد أن **Providers لا يعرفون بعضهم البعض**
- لم يذكر **Dependency Inversion Principle** صراحة
- لم يتطرق لتبعيات **القدرات** (فقط تبعيات الطبقات)

**التصحيح:** يُطبق القواعد من `18_DEPENDENCY_DIRECTION.md`.

### 3.4 ProviderRegistry — Global Singleton (مشكلة)

| الادعاء في TASK-002 | الواقع |
|--------------------|--------|
| "Singleton يصلح للتطبيق الصغير" | التطبيق ليس صغيراً — هو ERP سيستخدم Desktop + Offline + Mirror |
| "لا حاجة لـ DI Framework" | صحيح — لكن الـ Registry نفسه يحتاج إعادة تصميم |
| "سهل الفهم" | Global State يصعب اختباره ويدخل تعقيداً في السيناريوهات المتعددة |

**المشاكل:**
1. **اختبار (Testing):** إذا Registry كان Singleton، كل الاختبارات تشارك نفس الـ Providers
2. **Multi-Tenant:** إذا كان هناك شركتان بنفس التطبيق (نادِر لكن وارد)
3. **Desktop + Offline:** التطبيق المكتبي قد يحتاج Providerين في نفس الوقت (Local + Remote)
4. **تبديل في Runtime:** لا يمكن تغيير الـ Provider دون إعادة تشغيل

**الحل المقترح:** 
- `ProviderRegistry` يبقى لكن **ليس Singleton**
- يتم إنشاؤه في Bootstrap ويمرر إلى الـ Services عبر **Manual DI (Constructor)**
- لكل سياق (Web / Desktop / Test) يتم إنشاء Registry منفصل
- الـ Registry غير قابل للتغيير بعد الإنشاء (Immutable after build)

### 3.5 Factory Strategy — لا يغطي Mirror + Multi-Provider

TASK-002 يقترح:

```typescript
function createOrderQueryService(): OrderQueryService {
  const registry = ProviderRegistry.getInstance()
  return new OrderQueryService(registry.resolve<IOrderProvider>('order'))
}
```

**المشكلة:** 
- للتطبيق المكتبي (Desktop) بنسخة محلية + نسخة عن بعد — نحتاج Providerين
- للـ Offline مع Queue — نحتاج LocalProvider يكتب في IndexedDB ويرسل للخادم لاحقاً
- للـ Mirror للقراءة — نحتاج أن يقرأ من Mirror ويكتب على Master

**الحل المقترح:**
```typescript
// Factory تستقبل Config يحدد أي Provider يستخدم
function createOrderServices(config: DeploymentConfig): OrderServices {
  if (config.deployment === 'desktop-mirror') {
    return new OrderServices(
      new CachedQueryProvider(mirrorProvider, localCache),
      new SyncCommandProvider(supabaseProvider, localQueue)
    )
  }
  //...
}
```

### 3.6 UnitOfWork — لا يناسب Supabase ولا PostgreSQL العادي

| الادعاء في TASK-002 | المشكلة |
|--------------------|---------|
| `IUnitOfWork.begin/commit/rollback` مع `registerProvider` | Supabase RPC لا يدعم المعاملات عبر استدعاءات متعددة |
| معاملة تشمل OrderProvider + CreditProvider | كل Provider يستدعي RPC منفصل — لا يمكن لفها في معاملة PostgreSQL |

**الواقع:**
- Supabase هو API REST. كل `rpc()` هو طلب HTTP مستقل
- PostgreSQL transactions تحتاج اتصال SQL مباشر — وليس REST
- حالياً، كل عملية مركبة (Order + Credit) إما:
  - تُدار داخل RPC واحد (PostgreSQL Function)
  - أو تُدار تعويضياً (تعويض يدوي إذا فشلت إحدى الخطوات)

**الحل المقترح:**
1. **للمعاملات البسيطة:** كل شيء في RPC واحد (كما هو الحال الآن في بعض العمليات)
2. **للمعاملات المركبة:** نمط **Saga** (تعويض يدوي أو آلي)
3. **للمستقبل (PostgreSQL مباشر):** `IUnitOfWork` حقيقي مع `BEGIN/COMMIT/ROLLBACK`
4. **`IUnitOfWork` يبقى كواجهة** — لكن تنفيذ Supabase يكون Saga-based وليس Transaction-based

### 3.7 DTO Strategy — جيد لكن يحتاج توجيهاً

**ما هو جيد:**
- DTOs منفصلة للقراءة والكتابة
- تنظيمها حسب الكيان

**ما يحتاج تعديل:**
- الـ DTOs يجب أن تنظم حسب **Business Capability** وليس حسب الكيان
- بعض الـ DTOs العامة (مثل `PaginatedResponse`) جيدة كما هي
- إضافة `RequestContext` (الـ companyId الحالي، الـ token، الجهاز) لكل طلب — هذا مهم لـ Multi-Tenant

---

## 4. تغييرات يجب تطبيقها على TASK-002

### 4.1 على 09_DATA_PROVIDER_ARCHITECTURE.md

| البند | التغيير |
|-------|---------|
| Layer Diagram | إضافة `Infrastructure Layer` جديدة (لـ SW, GPS, Heartbeat, TrackingEngine) |
| Provider Lifecycle | إضافة حالة `Syncing` للمزامنة مع Local |
| DI Strategy | Registry ليس Singleton — يُمرر عبر Constructor |
| Transaction Strategy | إزالة ادعاء Multi-Provider Transaction الحقيقية — استبدالها بـ Saga |
| Future Providers | إضافة `MirrorProvider`, `CachedProvider` |
| القواعد الصارمة | إضافة قاعدة: لا Provider يستدعي Provider آخر |

### 4.2 على 10_PROVIDER_INTERFACES.md

| البند | التغيير |
|-------|---------|
| `IOrderProvider` | ← `ISalesOrderProvider` |
| `IProductProvider` | ← `IProductCatalogProvider` |
| `ICreditProvider` | ← `ICreditManagementProvider` |
| `IUserProvider` | ← `IIdentityProvider` + `IAuthorizationProvider` |
| إضافة | `ICollectionProvider` |
| إضافة | `IRouteProvider` |
| إضافة | `ISyncProvider` (واجهة المزامنة) |
| إضافة | `ILocalStoreProvider` (لتخزين IndexedDB) |
| `IUnitOfWork` | تعديل التعليم — ليس معاملات حقيقية لـ Supabase |
| `IProviderRegistry` | إزالة Singleton — جعله قابلاً للحقن |

### 4.3 على 11_APPLICATION_LAYER.md

| البند | التغيير |
|-------|---------|
| إعادة تنظيم الـ Services | حسب Business Capability وليس حسب الكيان |
| إضافة `RequestContext` | لكل طلب — companyId, token, device |
| Service Factory | دعم Config مختلف لكل بيئة (Web, Desktop, Local) |
| إضافة Saga Support | للمعاملات المركبة دون Transaction حقيقي |

### 4.4 على 12_FOLDER_STRUCTURE_V2.md

| البند | التغيير |
|-------|---------|
| إضافة `infrastructure/` | لمكونات SW, GPS, Tracking, Heartbeat |
| `providers/contracts/` | يعاد تسميتها حسب Capabilities (من فوق) |
| إزالة مجلد `services/` القديم | تسريع الجدول الزمني للحذف |

### 4.5 على 13_PROVIDER_MIGRATION_PLAN.md

| البند | التغيير |
|-------|---------|
| لا تغيير جوهري | (خطة الترحيل لا تتأثر كثيراً) |
| إضافة مهمة "إعادة تسمية الـ Provider Interfaces" | بعد اعتماد أسماء Business Capabilities |

### 4.6 على 14_IMPLEMENTATION_STRATEGY.md

| البند | التغيير |
|-------|---------|
| اليوم 1: ليس IProvider.ts | **بل:** تحديد Business Capabilities أولاً (TASK-003 قبل التنفيذ) |
| الأولوية: Mock Provider | **يبقى** — لكن بـ Interface الجديد (ISalesOrderProvider) |
| إضافة مهمة التحقق | `dependency-cruiser` أو ESLint rules لتطبيق قواعد التبعية |

---

## 5. مصفوفة التغييرات المطلوبة

| الرقم | التغيير | التأثير | الأولوية |
|-------|---------|---------|---------|
| C-01 | إعادة تسمية Provider Interfaces حسب Business Capabilities | كبير | 1 (قبل البدء) |
| C-02 | تعديل DI Strategy — Registry ليس Singleton | متوسط | 1 (قبل البدء) |
| C-03 | إعادة تعريف UnitOfWork كـ Saga لـ Supabase | كبير | 2 (أثناء SupabaseProvider) |
| C-04 | إضافة Deployment Config للـ Factory | متوسط | 3 (عند Desktop/Mirror) |
| C-05 | إضافة Infrastructure Layer | صغير | 4 (لاحقاً) |
| C-06 | قواعد آلية للتحقق من التبعيات | صغير | 2 (مع أول كود) |
| C-07 | إضافة `RequestContext` لجميع الطلبات | متوسط | 2 (مع Application Layer) |

---

## 6. ما يبقى صحيحاً من TASK-002

| القرار | يبقى |
|--------|------|
| 5 طبقات: P → A → B → PC → I | ✅ مع إضافة Infrastructure |
| الـ Provider Implementation لا يعرف الـ UI | ✅ |
| الـ Business Layer لا يعرف Supabase | ✅ |
| استخدام Mappers لفصل DTO عن Domain | ✅ |
| Mock Provider للتطوير والاختبار | ✅ |
| Strangler Fig Pattern للترحيل | ✅ |
| الـ Contracts لا تحتوي تنفيذ | ✅ |
| كل Provider ينفذ Interface واحد على الأقل | ✅ |

---

## 7. الخلاصة

| البيان | القيمة |
|--------|--------|
| حالة TASK-002 | **مقبول لكن يحتاج تعديلات** |
| عدد التغييرات الرئيسية | 7 تغييرات (C-01 إلى C-07) |
| التغييرات الحرجة قبل البدء | C-01, C-02 (إعادة تسمية الـ Interfaces + Registry) |
| التغييرات المؤجلة | C-04 (حتى Desktop) |
| مستوى الثقة بعد التعديلات | عالي — مع TASK-003 + التعديلات يصبح جاهزاً للتنفيذ |
