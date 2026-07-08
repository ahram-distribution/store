# 20 – Architecture Decisions

**التصنيف:** تصميم معماري — سجل القرارات المعمارية  
**الغرض:** توثيق جميع القرارات المعمارية المهمة بتنسيق ADR (Architecture Decision Record)  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** مسودة للاعتماد

---

## ADR-001: Business Capability Architecture

| الحقل | القيمة |
|-------|--------|
| **القرار** | تنظيم النظام حول قدرات الأعمال (Business Capabilities) وليس حول جداول قاعدة البيانات |
| **الرقم** | ADR-001 |
| **التاريخ** | 2026-07-05 |
| **الحالة** | ✅ مقترح |

### السياق (Context)

TASK-002 صمم الـ Provider Interfaces حول الكيانات (Order, Product, Customer, User...). هذا يجعل الـ Architecture قريباً من الـ Database Tables وليس من طريقة تفكير الأعمال.

### المشكلة (Problem)

- ERP نظام مؤسسي — قدرات الأعمال هي الوحدة التنظيمية الطبيعية، ليس الجداول
- إذا تغيرت قاعدة البيانات (إضافة جدول، دمج جدولين)، الـ Interfaces ستتغير
- الـ Provider Interfaces الحالية لا تعكس Business Language (تكلم "Order" بدل "Sales")
- كلما اقتربت الـ Interfaces من لغة الأعمال، كلما كان التواصل أسهل مع غير التقنيين

### البدائل المطروحة (Alternatives)

| البديل | الوصف |
|--------|-------|
| **A: Entity-Centric (TASK-002)** | `IOrderProvider`, `IProductProvider`, `ICreditProvider` |
| **B: Capability-Centric (TASK-003)** | `ISalesOrderProvider`, `IProductCatalogProvider`, `ICreditManagementProvider` |
| **C: Hybrid** | بعض Interfaces للكيانات، بعض للقدرات |

### القرار (Decision)

**اختيار B: Capability-Centric Architecture.**

### المبرر (Rationale)

1. الـ ERP له 23+ قدرة أعمال محددة — كل قدرة تملك Domain Models, Rules, Services
2. A يؤدي إلى 15+ Interface نفس العدد تقريباً — لكن منظمة حول لغة الأعمال
3. C يخلط معيارين — بعض المطورين سيفكرون بـ Entity وبعضهم بـ Capability
4. B يتماشى مع DDD (Domain-Driven Design) — الـ Bounded Context هو Business Capability
5. B يسهل التوسع — قدرة جديدة = Provider Interface جديد، لا تعديل على القديم

### التأثير المستقبلي (Consequences)

- **إيجابي:** Interfaces ثابتة حتى لو تغيرت قاعدة البيانات
- **إيجابي:** لغة مشتركة بين التقنيين وغير التقنيين
- **سلبي:** إعادة تسمية كل Interfaces من TASK-002 (مرة واحدة)
- **سلبي:** قد تكون بعض الـ Interfaces أكبر (تغطي أكثر من جدول)

---

## ADR-002: ProviderRegistry Scope (غير Singleton)

| الحقل | القيمة |
|-------|--------|
| **القرار** | `ProviderRegistry` ليس Singleton Global — يُنشأ لكل سياق (Web, Desktop, Test) ويُمرر عبر DI |
| **الرقم** | ADR-002 |
| **التاريخ** | 2026-07-05 |
| **الحالة** | ✅ مقترح |

### السياق (Context)

TASK-002 اقترح `ProviderRegistry.getInstance()` كـ Singleton. لكن التطبيق سيدعم Web, Desktop, Offline, Mirror — كل بيئة تحتاج Providers مختلفة.

### المشكلة (Problem)

1. Singleton يصعب اختباره (tests تشارك نفس الـ state)
2. Multi-Tenant المستقبلي (شركتان) يحتاج Registry منفصل لكل Tenant
3. سياق Desktop + Mirror يحتاج Providerين مختلفين — لا يمكن تبديلهما بـ Singleton واحد
4. إذا تغير Registry في أي وقت (أثناء التشغيل)، يصعب تتبع الأخطاء

### البدائل المطروحة

| البديل | الوصف |
|--------|-------|
| **A: Singleton Global** | `getInstance()` — كما في TASK-002 |
| **B: Scoped Registry** | يُنشأ لكل سياق، يُمرر عبر Constructor |
| **C: No Registry** | كل Service يستقبل Provider مباشر في Constructor |
| **D: Immutable Registry** | سكوب محدد، لكنه غير قابل للتغيير بعد الإنشاء |

### القرار

**اختيار B + D: Scoped Immutable Registry.**

### المبرر

1. B يسمح بإنشاء Registry مختلف لكل بيئة (Test, Web, Desktop)
2. D يضمن أن الـ Providers لا تتغير أثناء حياة التطبيق (Immutable after build)
3. معاً يحلان مشاكل Singleton + Multi-Tenant + الاختبار
4. لا يزال يسمح بـ Manual DI (لا حاجة لـ DI Framework)

### نمط التنفيذ

```typescript
// Bootstrap — إنشاء Registry محدد للسياق
function buildWebRegistry(): ProviderRegistry {
  return new ProviderRegistry([
    { name: 'identity', provider: new SupabaseIdentityProvider() },
    { name: 'authorization', provider: new SupabaseAuthorizationProvider() },
    { name: 'salesOrder', provider: new SupabaseSalesOrderProvider() },
    // ...
  ])
}

// Test — Registry مختلف
function buildTestRegistry(): ProviderRegistry {
  return new ProviderRegistry([
    { name: 'identity', provider: new MockIdentityProvider() },
    { name: 'salesOrder', provider: new MockSalesOrderProvider() },
    // ...
  ])
}

// التطبيق يستقبل Registry في الجذر ويمرره للـ Services
const registry = buildWebRegistry()
const orderService = new OrderApplicationService(
  registry.resolve<ISalesOrderProvider>('salesOrder'),
  registry.resolve<ICreditManagementProvider>('credit')
)
```

### التأثير المستقبلي

- **إيجابي:** كل سياق له Providers خاصة به
- **إيجابي:** اختبارات معزولة
- **سلبي:** الـ Registry يجب إنشاؤه قبل أي Service
- **سلبي:** لا يمكن تغيير Provider بعد البناء (ميزة وليست عيباً)

---

## ADR-003: Saga Pattern بدلاً من Distributed Transaction

| الحقل | القيمة |
|-------|--------|
| **القرار** | استخدام Saga Pattern للمعاملات المركبة عبر Providers متعددة لـ Supabase، بدلاً من `IUnitOfWork` التقليدي |
| **الرقم** | ADR-003 |
| **التاريخ** | 2026-07-05 |
| **الحالة** | ✅ مقترح |

### السياق (Context)

TASK-002 صمم `IUnitOfWork.begin/commit/rollback` مع `registerProvider`. لكن Supabase RPC يعمل عبر REST — كل طلب HTTP مستقل. لا يمكن لف استدعاءات RPC متعددة في معاملة PostgreSQL حقيقية.

### المشكلة (Problem)

1. `supabase.rpc()` هو REST API — كل استدعاء طلب HTTP منفصل
2. لا يمكن التراجع عن RPC إذا فشل RPC لاحق (مثلاً: حجز الائتمان نجح لكن إنشاء الطلب فشل)
3. الحل الحالي (كل شيء في RPC واحد) يعمل لكنه يضع كل المنطق في PostgreSQL
4. نقل المنطق إلى TypeScript يحتاج معالجة الفشل التعويضي

### البدائل المطروحة

| البديل | الوصف |
|--------|-------|
| **A: IUnitOfWork حقيقي مع Transaction** | يتطلب اتصال PostgreSQL مباشر (ليس REST) |
| **B: كل شيء في RPC واحد** | يبقي المنطق في PostgreSQL (الوضع الحالي) |
| **C: Saga Pattern** | كل خطوة لها خطوة تعويضية (Compensating Action) |
| **D: Eventual Consistency مع Queue** | رسائل غير متزامنة — معقد جداً للتطبيق الحالي |

### القرار

**اختيار B + C: كل شيء في RPC واحد (حالياً) مع إعداد Saga للتوسع.**

### المبرر

1. B هو الوضع الحالي — يعمل وليس هناك حاجة لتغييره فوراً
2. عند نقل المنطق من RPC إلى TypeScript (في الترحيل التدريجي)، نستخدم Saga
3. Saga تسمح بـ Rollback منطقي (تعويضي) — ليس Rollback على مستوى قاعدة البيانات
4. الخيار A غير ممكن مع Supabase REST، والخيار D معقد جداً

### مثال Saga

```typescript
class CreateOrderSaga {
  async execute(request: CreateOrderRequest): Promise<Order> {
    // 1. محاولة حجز الائتمان
    const reservation = await this.creditProvider.reserve(...)

    try {
      // 2. محاولة إنشاء الطلب
      const order = await this.orderProvider.create(...)
      return order
    } catch (error) {
      // تعويض: تحرير حجز الائتمان
      await this.creditProvider.release(reservation.id)
      throw error
    }
  }
}
```

### التأثير المستقبلي

- **إيجابي:** انتقال تدريجي من RPC Logic إلى TypeScript Logic
- **إيجابي:** `IUnitOfWork` يبقى كواجهة لـ PostgreSQL المباشر (المستقبل)
- **سلبي:** يحتاج كل فريق كتابة تعويضات (Compensating Actions) صراحة
- **سلبي:** أكثر تعقيداً من Transaction الحقيقي لكنه أكثر مرونة

---

## ADR-004: Infrastructure Layer منفصلة

| الحقل | القيمة |
|-------|--------|
| **القرار** | إضافة `src/infrastructure/` منفصلة عن الـ 5 طبقات الرئيسية للمكونات التي تتعامل مع العتاد/native APIs |
| **الرقم** | ADR-004 |
| **التاريخ** | 2026-07-05 |
| **الحالة** | ✅ مقترح |

### السياق (Context)

بعض المكونات لا تنتمي لأي طبقة: GPS Tracking, Heartbeat, Service Worker, IndexedDB Queue.

### المشكلة (Problem)

- TrackingEngine ليس Data Provider (لا يقرأ/يكتب في قاعدة البيانات)
- GPS Service ليس Application Service (لا ينسق عمليات)
- Heartbeat ليس Business Logic (لا قواعد أعمال)
- وضعها في `providers/implementations/` غير صحيح — هي ليست Providers للبيانات

### البدائل المطروحة

| البديل | الوصف |
|--------|-------|
| **A: دمجها مع Providers** | `ITrackingProvider` و `IGpsProvider` في providers/ |
| **B: دمجها مع Utils** | `utils/trackingEngine.ts` |
| **C: Infrastructure Layer جديدة** | مجلد `infrastructure/` منفصل |
| **D: تركها في مكانها الحالي** | `capacitor-plugins/` + `services/` |

### القرار

**اختيار C: Infrastructure Layer جديدة.**

### المبرر

1. A يخلط بين Data Access و Hardware Access
2. B يخلط بين Pure Functions و Side-Effect Code
3. D يبقيها متناثرة — لا تنظيم
4. C يعطيها مكانها الصحيح — مكونات Infrastructure تعمل تحت كل الطبقات

### الهيكل المقترح

```
src/infrastructure/
├── tracking/
│   ├── TrackingEngine.ts
│   └── TrackingTypes.ts
├── gps/
│   └── GpsService.ts
├── heartbeat/
│   └── HeartbeatService.ts
├── queue/
│   └── OfflineQueue.ts          ← IndexedDB
├── network/
│   └── NetworkStatusService.ts
├── storage/
│   └── LocalStorageService.ts   ← IndexedDB + localStorage
├── sw/
│   └── ServiceWorkerManager.ts
└── logging/
    └── LoggerService.ts
```

### التأثير المستقبلي

- **إيجابي:** فصل واضح بين Hardware/Infrastructure code و Business/Data code
- **إيجابي:** يسهل اختبار الطبقات العليا (نستخدم Mocks للـ Infrastructure)
- **سلبي:** مجلد جديد (لكن تنظيماً أفضل)

---

## ADR-005: Provider Interfaces تنظيمها حسب Business Capability Naming

| الحقل | القيمة |
|-------|--------|
| **القرار** | أسماء Interfaces تتبع قدرات الأعمال وتستخدم البادئة `I{Capability}Provider` أو `I{Capability}Repository` |
| **الرقم** | ADR-005 |
| **التاريخ** | 2026-07-05 |
| **الحالة** | ✅ مقترح |

### القائمة الكاملة للـ Interfaces الجديدة

| الاسم القديم (TASK-002) | الاسم الجديد (TASK-003) |
|------------------------|------------------------|
| `IOrderProvider` | `ISalesOrderProvider` |
| `IProductProvider` | `IProductCatalogProvider` |
| `ICustomerProvider` | `ICustomerProvider` (يبقى) |
| `ICreditProvider` | `ICreditManagementProvider` |
| — (جديد) | `ICollectionProvider` |
| `IUserProvider` | `IIdentityProvider` |
| — (جديد) | `IAuthorizationProvider` |
| `IAttendanceProvider` | `IAttendanceProvider` (يبقى) |
| `ITrackingProvider` | `IEmployeeTrackingProvider` |
| — (جديد) | `IRouteProvider` |
| `IDealProvider` | `IDealProvider` ← `IOfferManagementProvider` |
| `IFlashOfferProvider` | (يدمج مع IOfferManagementProvider) |
| `IDailyDealProvider` | (يدمج مع IOfferManagementProvider) |
| `ITierProvider` | (يدمج مع IOfferManagementProvider) |
| `ICacheProvider` | يبقى (ليس قدرة — بنية تحتية) |
| `IUnitOfWork` | يبقى — للسجلات المباشرة فقط |
| `IProviderRegistry` | يبقى — مع تعديلات ADR-002 |
| — (جديد) | `IKpiProvider` |
| — (جديد) | `ITargetProvider` |
| — (جديد) | `IReturnsProvider` |
| — (جديد) | `IAuctionProvider` |
| — (جديد) | `INotificationProvider` |
| — (جديد) | `IAuditProvider` |
| — (جديد) | `IAdministrationProvider` |
| — (جديد) | `IReportingProvider` |
| — (جديد) | `IInventoryProvider` |

---

## ADR-006: RequestContext لجميع الطلبات

| الحقل | القيمة |
|-------|--------|
| **القرار** | كل Application Service يقبل `RequestContext` يحتوي identity/token/companyId/device |
| **الرقم** | ADR-006 |
| **التاريخ** | 2026-07-05 |
| **الحالة** | ✅ مقترح |

### السياق (Context)

حالياً، كل RPC يستقبل `p_token` ويستخرج companyId من الجلسة — هذا مخبأ في كل RPC.

### المشكلة

- الـ Token يُمرر كـ p_token في كل استدعاء
- لا يوجد كائن سياق موحد
- للـ Desktop/Mirror المستقبلي، نحتاج device info + tenant info

### القرار

```typescript
interface RequestContext {
  token: string
  identityId: string
  identityType: 'employee' | 'customer'
  companyId: string
  device?: 'web' | 'desktop' | 'mobile'
  timestamp: Date
}
```

كل Application Service يستقبل `RequestContext` في الـ Constructor أو الـ Method.

### التأثير

- **إيجابي:** كائن موحد لكل ما يحتاجه Provider
- **إيجابي:** يسهل إضافة Multi-Tenant
- **سلبي:** يحتاج تمرير في كل Service (لكن هذا أفضل من التشتيت)

---

## ADR-007: الـ Domain يبقى Pure TypeScript بدون أي اعتماديات خارجية

| الحقل | القيمة |
|-------|--------|
| **القرار** | Domain Layer (models, value-objects, services) لا يستورد أي مكتبة خارجية — TypeScript Pure |
| **الرقم** | ADR-007 |
| **التاريخ** | 2026-07-05 |
| **الحالة** | ✅ مقترح |

### السياق

Domain هو قلب النظام — يجب أن يظل قابلاً للاختبار والنقل لأي بيئة.

### القرار

- لا `supabase` في الـ Domain
- لا `react` في الـ Domain
- لا `zustand` في الـ Domain
- لا `zod` أو أي مكتبة خارجية (حتى class-validator)
- فقط TypeScript + Date.now() و Math.* إذا لزم

### التأثير

- **إيجابي:** الـ Domain يمكن اختباره في Node.js دون أي Mock
- **إيجابي:** يمكن نقله إلى Desktop App (Electron) دون تغيير
- **إيجابي:** لا تبعيات متضاربة
- **سلبي:** بعض الـ Validation اليدوي بدلاً من مكتبات مثل Zod

---

## ADR-008: الترحيل بـ Strangler Fig — النظام القديم والجديد يعملان معاً

| الحقل | القيمة |
|-------|--------|
| **القرار** | الترحيل التدريجي بـ Strangler Fig Pattern — لا Big Bang |
| **الرقم** | ADR-008 |
| **التاريخ** | 2026-07-05 |
| **الحالة** | ✅ مقترح |

### التفاصيل

كما هو موثق في 13_PROVIDER_MIGRATION_PLAN.md.

### المبرر

- لا توقف الخدمة
- كل خطوة قابلة للعكس
- النظام القديم يبقى مرجعاً للمقارنة

---

## ملخص القرارات

| ADR | القرار | الأولوية | الحالة |
|-----|--------|---------|--------|
| 001 | Business Capability Architecture | حرج | ✅ مقترح |
| 002 | Scoped Immutable Registry | حرج | ✅ مقترح |
| 003 | Saga بدلاً من Distributed Transaction | عالي | ✅ مقترح |
| 004 | Infrastructure Layer منفصلة | متوسط | ✅ مقترح |
| 005 | أسماء Interfaces حسب القدرات | حرج | ✅ مقترح |
| 006 | RequestContext لجميع الطلبات | عالي | ✅ مقترح |
| 007 | Domain Pure TypeScript (بلا اعتماديات) | عالي | ✅ مقترح |
| 008 | Strangler Fig للترحيل | متوسط | ✅ مقترح |
| 009 | Dual Presentation (Mobile + Desktop) | متوسط | ✅ مقترح |
| 010 | Desktop Runtime Strategy (Electron) | متوسط | ✅ مقترح |

---

## ADR-009: Dual Presentation (Mobile + Desktop)

| الحقل | القيمة |
|-------|--------|
| **القرار** | فصل Presentation Layer إلى مسارين مستقلين: Mobile (PWA) و Desktop (Windows EXE) ـ يشاركان نفس Application و Domain و Providers |
| **الرقم** | ADR-009 |
| **التاريخ** | 2026-07-05 |
| **الحالة** | ✅ مقترح |

### السياق

النظام حالياً هو PWA للموبايل فقط. مع خريطة الطريق لتطبيق Desktop (Windows EXE)، نحتاج قراراً حول كيفية تنظيم Presentation Layer.

### المشكلة

- خيار واحد (Responsive Design) — صفحة واحدة تعمل في الموبايل والديسكتوب
- خياران (Platform-specific) — صفحات منفصلة لكل منصة
- Responsive Design يبدو أوفر في الجهد — لكنه ينتج تجربة سيئة في كلتا المنصتين
- Platform-specific ينتج أفضل تجربة — لكنه يتطلب جهداً مضاعفاً في الصفحات

### البدائل

| البديل | الوصف |
|--------|-------|
| **A: Responsive Design** | صفحة واحدة تتغير حسب حجم الشاشة |
| **B: Platform-Specific** | صفحات منفصلة لكل منصة + Shared Components |
| **C: Hybrid** | بعض الصفحات Responsive، بعضها منفصل |

### القرار

**اختيار B: Platform-Specific Presentation.**

### المبرر

1. ERP له مستخدمين مختلفين تماماً (مندوب ميداني vs مدير مكتبي) — يحتاجون UX مختلف
2. Responsive Design يضيف تعقيداً (CSS @media, حالة الشاشة) — وفي النهاية تجربة دون المستوى
3. Business Logic مشترك — فقط UI يختلف — لذا الجهد المضاعف محدود (الصفحات فقط)
4. Shared Components تقلل الجهد (Buttons, Inputs, Icons — نفسها في المنصتين)
5. الانتقال إلى Desktop لاحقاً سيكون أسهل — كل صفحة Desktop جديدة تُبنى من الصفر مع الـ UX المناسب

### التأثير

- **إيجابي:** أفضل تجربة مستخدم لكل منصة
- **إيجابي:** لا تعقيد CSS (لا Media Queries معقدة)
- **سلبي:** بعض الصفحات تُبنى مرتين (لكنها ليست كلها — بعض الصفحات لمنصة واحدة فقط)
- **سلبي:** يحتاج Build Pipeline يختار أي App يشغّل

---

## ADR-010: Desktop Runtime Strategy (Electron)

| الحقل | القيمة |
|-------|--------|
| **القرار** | Electron هو منصة تشغيل (Desktop Runtime) الرسمية لتطبيق Ahram Desktop |
| **الرقم** | ADR-010 |
| **التاريخ** | 2026-07-05 |
| **الحالة** | ✅ مقترح |

### السياق

Ahram Platform يحتاج تطبيق Windows Desktop للمستخدمين الإداريين (مديرين، محاسبين، مشرفين).  
Desktop يحتاج: Local PostgreSQL، Auto Update، Backup/Restore، Sync Engine، Multi-window، طباعة، AI Local، Plugin System.

### البدائل

| البديل | الوصف |
|--------|-------|
| **A: Electron** | Node.js + Chromium — نظام بيئي ناضج، مكتبات غنية، child_process لإدارة PostgreSQL |
| **B: Tauri** | Rust + WebView — حجم صغير، أداء عالٍ، لكن Rust غير متوفر في الفريق |

### القرار

**اختيار A: Electron.**

### المبرر

1. **Local PostgreSQL** — Electron يسمح بـ `child_process.spawn('pg_ctl')` — Tauri يحتاج Rust FFI
2. **Auto Update** — `electron-updater` ناضج وجاهز — Tauri's updater حديث وأقل استقراراً
3. **Printing** — Electron يمرر `BrowserWindow.webContents.print()` مباشر — Tauri يحتاج Rust plugin
4. **Multi-window** — Electron API جاهز (`new BrowserWindow`) — Tauri يحتاج إدارة Rust للنوافذ
5. **Plugin System** — Electron يسمح بـ `require()` ديناميكي — Tauri يحتاج Compilation
6. **AI Runtime** — Electron يستدعي Python/ONNX عبر child_process — Tauri يحتاج Rust bindings
7. **الفريق** — الفريق يكتب TypeScript، لا Rust — Electron يبني على مهارات موجودة
8. **النضج** — Electron في السوق 10+ سنوات، Tauri ~3 سنوات — للمشروع المؤسسي، الاستقرار أهم

### التأثير

- **إيجابي:** تغطية كاملة لمتطلبات Desktop (DB, Backup, Sync, AI, Plugins, Print)
- **إيجابي:** فريق React الحالي يمكنه العمل على Main Process (TypeScript/Node.js)
- **سلبي:** حجم المثبّت أكبر (~150MB) واستهلاك RAM أعلى
- **سلبي:** يحتاج تكوين electron-builder + إدارة التحديثات

**يحتاج اعتماد Product Owner قبل البدء في التنفيذ.**
