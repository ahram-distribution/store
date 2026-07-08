# 18 – Dependency Direction

**التصنيف:** تصميم معماري — اتجاه التبعيات  
**الغرض:** توثيق قواعد اتجاه التبعيات بين الطبقات والقدرات والمكونات  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** مسودة للاعتماد

---

## 1. القاعدة الذهبية (The Golden Rule)

```
التبعية تتجه للداخل → نحو Domain

Presentation  →  Application  →  Domain (Contracts)
                                    ↓
                              Provider Implementations
                                    ↓
                              Infrastructure / Database
```

**الـ Domain لا يعرف شيئاً عن أي طبقة فوقه أو تحته.**

---

## 2. شجرة التبعيات الكاملة

```text
src/
│
├── pages/                          ← Presentation
│     └── يعتمد على → application/ (services, dto)
│                       ولا يعتمد على → providers/, services/, supabase
│
├── application/                    ← Application Layer
│     ├── services/                 ← يعتمد على → domain/ (models), providers/ (contracts)
│     ├── dto/                      ← يعتمد على → domain/ (للاستيرادات الأساسية فقط)
│     ├── mappers/                  ← يعتمد على → domain/ (models), application/ (dto)
│     ├── validators/               ← يعتمد على → application/ (dto)
│     └── factories/                ← يعتمد على → providers/ (contracts + registry)
│
├── domain/                         ← Business Layer (قلب النظام)
│     ├── models/                   ← لا يعتمد على أي شيء — Pure TypeScript
│     ├── value-objects/            ← لا يعتمد على أي شيء — Pure TypeScript
│     ├── enums/                    ← لا يعتمد على أي شيء
│     └── services/                 ← يعتمد على → domain/ (models, value-objects)
│                                    ولا يعتمد على → providers/, supabase, React
│
├── providers/                      ← Data Provider Layer
│     ├── contracts/                ← يعتمد على → domain/ (models)
│     ├── registry/                 ← يعتمد على → providers/ (contracts)
│     │                              ولا يعتمد على → domain/ أو application/
│     └── implementations/          ← يعتمد على → providers/ (contracts)
│           ├── supabase/           ← يعتمد على → lib/supabase, providers/contracts
│           ├── mock/               ← يعتمد على → providers/contracts
│           └── local/              ← يعتمد على → providers/contracts
│
├── lib/supabase.ts                 ← Infrastructure — لا يعتمد على أي من الطبقات الجديدة
├── store/                          ← State (zustand) — سيتحول تدريجياً
├── services/ (القديم)              ← ⛔ سيتم إيقافه
├── components/                     ← Presentation — يعتمد على application/
├── hooks/                          ← Presentation — يعتمد على application/
└── utils/                          ← Utilities — لا يعتمد على الطبقات
```

---

## 3. قواعد التبعية لكل طبقة

### 3.1 Presentation Layer (Pages, Components, Hooks)

| مسموح باستيراده | ممنوع استيراده |
|----------------|----------------|
| `application/services/` | `providers/` (مباشر) |
| `application/dto/` | `services/` (القديم) |
| `domain/enums/` | `lib/supabase.ts` |
| `domain/value-objects/` (قراءة فقط) | أي استدعاء `supabase.rpc()` |
| `utils/` | أي استدعاء Provider مباشر |

**علّة المنع:** إذا استدعت الصفحة Provider مباشر، يصبح تغيير Provider مستحيلاً دون تغيير الصفحة. وهذا بالضبط ما نمنعه.

### 3.2 Application Layer (Services, DTOs, Mappers, Validators)

| مسموح باستيراده | ممنوع استيراده |
|----------------|----------------|
| `providers/contracts/` | `providers/implementations/` |
| `domain/models/` | `lib/supabase.ts` |
| `domain/services/` | أي `services/` قديم |
| `domain/value-objects/` | أي مكون React |
| `application/dto/` | `store/` (zustand) |
| `application/mappers/` | |
| `application/validators/` | |

**علّة المنع:** Application Layer تختار الـ Provider المناسب عبر Registry، لكنها لا تعرف تفاصيل التنفيذ.

### 3.3 Business Layer (Domain Models, Domain Services)

| مسموح باستيراده | ممنوع استيراده |
|----------------|----------------|
| `domain/models/` | `providers/` |
| `domain/value-objects/` | `application/` |
| `domain/enums/` | `lib/supabase.ts` |
| `utils/` (formatting/pure only) | `services/` (قديم) |
| | `store/` |
| | أي مكتبة خارجية غير TypeScript pure |

**علّة المنع:** Domain Layer يجب أن يظل قابلاً للاختبار والاستخدام في أي سياق (Web, Desktop, بلا React).

### 3.4 Data Provider Contracts

| مسموح باستيراده | ممنوع استيراده |
|----------------|----------------|
| `domain/models/` | `application/` |
| `domain/value-objects/` | `lib/supabase.ts` |
| `domain/enums/` | أي تنفيذ |
| | أي `services/` |

**علّة المنع:** الـ Contracts هي العقود — يجب أن تبقى خفيفة ومستقلة.

### 3.5 Provider Implementations

| مسموح باستيراده | ممنوع استيراده |
|----------------|----------------|
| `providers/contracts/` | `application/` |
| `domain/models/` | أي مكون React |
| `lib/supabase.ts` (SupabaseProvider فقط) | `store/` |
| `utils/` | |

**علّة المنع:** Provider Implementation هو تفصيل تنفيذي — لا يعرف شيئاً عن طبقة العرض أو التطبيق.

---

## 4. قاعدة التبعيات بين القدرات (Capability Dependencies)

### 4.1 Directed Acyclic Graph (DAG)

**شرط أساسي:** تبعيات القدرات يجب أن لا تشكل دورة (Acyclic Graph).

```text
Identity & Access
  └── Authorization
        └── كل القدرات التي تحتاج صلاحيات

Product Catalog
  └── Pricing & Discounts
  └── Deals & Offers
  └── Inventory Control
        └── Sales Order Management
              └── Returns Management
                    └── Credit Management
                          └── Collections & Payments

Customer Management
  └── Credit Management
  └── Route Management
  └── Sales Order Management

Attendance & Time
  └── Employee Tracking
        └── Route Management
  └── KPI & Targets
        └── Reporting
```

### 4.2 كيف تتبع قدرة قدرة أخرى

```text
Sales Order Management ← تعتمد على ← Credit Management
                                    ↓
ليس عبر استدعاء CreditProvider مباشر من OrderProvider.
بل عبر Application Service:
  OrderApplicationService {
    orderProvider: ISalesOrderProvider
    creditProvider: ICreditManagementProvider  ← ✅ صحيح
  }
```

**القاعدة:** قدرة تتبع قدرة أخرى عبر **Application Service**، وليس عبر Provider.

### 4.3 لا استدعاءات متبادلة (No Circular Dependencies)

```text
❌ ممنوع:
  SalesOrderProvider.call(CreditProvider)
  CreditProvider.call(SalesOrderProvider)

✅ مسموح:
  OrderApplicationService {
    orderProvider
    creditProvider
  }
```

---

## 5. اتجاه البيانات (Data Flow Direction)

```text
[UI Event]
    │
    ▼
[Application Service]  ───► [Domain Service] (لحساب / تحقق)
    │                            │
    │                            ▼
    │                      (نتيجة حسابية)
    │                            │
    ▼                            │
[Provider (via Registry)] ◄─────┘
    │
    ▼
[Database / External System]
    │
    ▼
[Provider returns result]
    │
    ▼
[Application Service maps result → DTO]
    │
    ▼
[UI renders DTO]
```

---

## 6. ما هو خارج نظام التبعيات (External to Dependency System)

| المكون | الموقع | لماذا خارج النظام |
|--------|--------|------------------|
| **SW (Service Worker)** | `src/sw.ts` | يعمل في thread منفصل |
| **IndexedDB** | ضمن SW + sync | Offline storage — لا ينتمي لطبقة |
| **Capacitor Plugins** | `src/capacitor-plugins/` | Infrastructure — نظام تشغيل |
| **GPS Engine** | `src/utils/gpsEngine.ts` | Pure utility — لا تبعيات |
| **Tracking Engine** | `src/capacitor-plugins/trackingEngine.ts` | Hardware + Browser API |
| **Heartbeat Service** | (قديم) | سينتقل إلى Infrastructure |
| **Failure Logger** | (قديم) | سينتقل إلى Audit & Log |

---

## 7. ما يتغير وما يبقى

| المكون | هل يتغير اتجاه التبعية؟ |
|--------|------------------------|
| **Pages** | ✅ تتغير — تتوقف عن استدعاء services/ | 
| **Application Services** | 🔄 **جديد** — لم يكن موجوداً |
| **Domain Models** | 🔄 **جديد** — نقل من types/ |
| **Domain Services** | 🔄 **جديد** — نقل من engine/ |
| **Provider Contracts** | 🔄 **جديد** |
| **Provider Implementations** | 🔄 **جديد** |
| Provider Registry | 🔄 **جديد** |
| **lib/supabase.ts** | ❌ يبقى — يحتاجه SupabaseProvider |
| **store/** | ⚠️ سيتغير — سيستخدم Application Services بدل services/ |
| **services/** (قديم) | ⛔ سيزول |
| **engine/pricing.ts** | 📦 سينتقل إلى domain/services/ |
| **utils/** | ❌ يبقى |

---

## 8. التحقق الآلي (Automated Verification)

يمكن إضافة سكريبت تحقق للتأكد من عدم كسر قواعد التبعية:

```text
فحوصات مقترحة:
1. لا import من providers/implementations في application/services/
2. لا import من lib/supabase في domain/ أو application/
3. لا import من services/ (قديم) في pages/ (بعد الترحيل)
4. لا import من application/ في providers/
5. لا import من store/ في domain/
```

**الأداة:** `dependency-cruiser` أو ESLint plugin `import/no-restricted-paths`
