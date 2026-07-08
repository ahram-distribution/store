# 21 – Architecture Specification v1.0

**التصنيف:** مواصفة معمارية رسمية — المرجع الوحيد  
**الغرض:** توثيق العمارة النهائية المجمّدة لنظام Ahram ERP — المصدر الوحيد للحقيقة  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.1  
**الحالة:** مجمّدة — ✅ معتمدة  
**الوثائق المستبدلة:** 09, 10, 11 (جزئياً)، 12 (جزئياً)، 13, 14  
**التغيير عن 1.0:** إضافة Presentation Architecture ثنائي المسار (Mobile + Desktop) (TASK-005)  
**التغيير عن 1.1:** إضافة Desktop Runtime Strategy — Electron (TASK-006/007)

---

## 1. الرؤية (Vision)

نظام ERP مؤسسي متكامل يُصمم حول **قدرات الأعمال (Business Capabilities)** — ليس حول جداول قاعدة البيانات.  
قابل للتوسع لـ Web, Desktop, Offline, Mirror دون إعادة كتابة UI.  
قاعدة البيانات (Supabase حالياً) هي تفصيل تنفيذي واحد قابل للاستبدال.

---

## 2. المبادئ (Principles)

| الرقم | المبدأ | الشرح |
|-------|--------|-------|
| P-01 | **Business Capability First** | كل تنظيم النظام حول قدرات الأعمال — كل قدرة تملك Models، Rules، Providers، Services |
| P-02 | **Dependency Inversion** | الـ UI يعتمد على Application Services، Application يعتمد على Contracts، التنفيذ تفصيل |
| P-03 | **Domain Purity** | Domain Layer (Models, Services) لا يستورد أي مكتبة — TypeScript Pure |
| P-04 | **Strangler Fig Migration** | النظام القديم والجديد يعملان معاً — لا Big Bang |
| P-05 | **Provider as Implementation Detail** | Supabase, Postgres, Mock كلها تنفيذات — الـ Contracts هي الثابت |
| P-06 | **Architecture Before Implementation** | لا تنفيذ دون تصميم معماري معتمد |
| P-07 | **Test First** | كل Provider وكل Application Service له اختبار قبل/مع التنفيذ |

---

## 3. العمارة الهرمية (Layered Architecture)

### 3.1 الطبقات الست

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Presentation Layer                                             │
│  ┌────────────────────────┐  ┌──────────────────────────────┐    │
│  │  Mobile Presentation   │  │  Desktop Presentation        │    │
│  │  (PWA)                 │  │  (Windows EXE)               │    │
│  │  • Touch-first         │  │  • Keyboard-first            │    │
│  │  • Bottom Nav          │  │  • Side/Top Nav              │    │
│  │  • Cards, Lists        │  │  • Data Grids, Multi-panel   │    │
│  │  • GPS, Camera, Offline│  │  • Printing, Dashboards      │    │
│  └────────────────────────┘  └──────────────────────────────┘    │
│        │                             │                            │
│        └─────────────┬───────────────┘                            │
│                      ▼                                            │
│              Shared UI Components                                 │
│       (Buttons, Inputs, Icons, Loading States)                    │
│  كلاهما يستهلكان نفس Application Services — لا تكرار لمنطق الأعمال│
├──────────────────────────────────────────────────────────────────┤
│ 2. Application Layer                                              │
│    Application Services, DTOs, Mappers, Validators                │
│    التنسيق والتحقق والتحويل — لا منطق أعمال                      │
├──────────────────────────────────────────────────────────────────┤
│ 3. Business Layer (Domain)                                        │
│    Domain Models, Value Objects, Domain Services                  │
│    منطق أعمال خالص — لا يعرف Supabase, React, Provider           │
├──────────────────────────────────────────────────────────────────┤
│ 4. Data Provider Layer (Contracts)                                │
│    I{Capability}Provider, IUnitOfWork, IProviderRegistry          │
│    واجهات فقط — لا تنفيذ                                          │
├──────────────────────────────────────────────────────────────────┤
│ 5. Provider Implementations                                       │
│    SupabaseProvider, MockProvider, PostgresProvider               │
│    تنفيذ الواجهات — يمكن استبدالها بالكامل                        │
├──────────────────────────────────────────────────────────────────┤
│ 6. Infrastructure Layer                                           │
│    GPS, Tracking, Heartbeat, SW, IndexedDB, Logging               │
│    عتاد ومكتبات نظام — لا تتبع أي قدرة أعمال                      │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 مسؤوليات كل طبقة — موجز

| الطبقة | تفعل | لا تفعل |
|--------|------|---------|
| **Presentation (Mobile)** | تستدعي Application Services، تعرض DTOs، UX مخصص للموبايل | لا تستدعي `supabase.rpc()`, لا تستدعي Providers |
| **Presentation (Desktop)** | تستدعي نفس Application Services، تعرض DTOs، UX مخصص للـ Desktop | لا تستدعي `supabase.rpc()`, لا تستدعي Providers |
| **Application** | تنسق Providers، تحقق مدخلات، تحول DTO↔Domain | لا تحتوي منطق أعمال، لا تعرف طريقة التنفيذ |
| **Business** | تحسب الأسعار، تطبق القواعد، تضبط الاتساق | لا تعرف Supabase, React, Providers |
| **Contracts** | تعرف الـ Interfaces والأنواع | لا تحتوي تنفيذ |
| **Implementations** | تنفذ الـ Interfaces، تتصل بقاعدة البيانات | لا تعرف الـ UI، لا تعرف الـ Application |
| **Infrastructure** | تدير GPS, SW, IndexedDB, Heartbeat | لا تعرف Business Rules |

---

## 4. قدرات الأعمال (Business Capabilities)

### 4.1 القائمة الرسمية — 23 قدرة

| الرقم | القدرة | الـ Aggregates المملوكة | الـ Provider Interface |
|-------|--------|------------------------|----------------------|
| C-01 | Identity & Access | Identity, Session, LoginCredential | `IIdentityProvider` |
| C-02 | Authorization | Role, Capability, GovernancePolicy | `IAuthorizationProvider` |
| C-03 | Customer Management | Customer, CustomerClassification | `ICustomerProvider` |
| C-04 | Product Catalog | Product, Category, UnitOfMeasure | `IProductCatalogProvider` |
| C-05 | Pricing & Discounts | PriceTier, TierException, UnitPrice | `IPricingProvider` |
| C-06 | Deals & Offers | Deal, FlashOffer, DailyDeal, DealRule | `IOfferManagementProvider` |
| C-07 | Sales Order Management | SalesOrder, OrderItem, StatusChange | `ISalesOrderProvider` |
| C-08 | Returns Management | ReturnRequest, ReturnItem, ReturnApproval | `IReturnsProvider` |
| C-09 | Credit Management | CreditReservation, CreditLimit, CreditTransaction | `ICreditManagementProvider` |
| C-10 | Collections & Payments | Payment, Check | `ICollectionProvider` |
| C-11 | Inventory Control | StockReservation, InventoryItem, StockMovement | `IInventoryProvider` |
| C-12 | Auctions | Auction, Bid, BidInfo | `IAuctionProvider` |
| C-13 | Attendance & Time | Workday, BreakPeriod, AttendanceSession | `IAttendanceProvider` |
| C-14 | Employee Tracking | TrackingSession, TrackingPoint | `IEmployeeTrackingProvider` |
| C-15 | Route Management | Route, RouteVisit | `IRouteProvider` |
| C-16 | KPI & Targets | Target, KpiDefinition, TargetAchievement | `ITargetProvider` |
| C-17 | Reporting & Analytics | Report, ReportDefinition, DashboardWidget | `IReportingProvider` |
| C-18 | Business Activity | ActivityEvent, ActivityStream | `IActivityProvider` |
| C-19 | Synchronization & Offline | SyncQueue, SyncConflict, LocalStore | `ISyncProvider` |
| C-20 | Notification & Alerts | Notification, NotificationPreference | `INotificationProvider` |
| C-21 | Administration | Company, SystemSetting | `IAdministrationProvider` |
| C-22 | Audit & Log | AuditEntry, EventLog | `IAuditProvider` |
| C-23 | Integration & API | ApiKey, Webhook, IntegrationMapping | `IIntegrationProvider` |

### 4.2 تبعيات التنفيذ بين القدرات (DAG)

```
Identity (C-01) ← لا تعتمد
Authorization (C-02) ← (C-01)
Customer (C-03) ← لا تعتمد
Product Catalog (C-04) ← لا تعتمد
Pricing (C-05) ← (C-04)
Offers (C-06) ← (C-04), (C-05)
Sales Order (C-07) ← (C-03), (C-04), (C-05), (C-09), (C-11)
Returns (C-08) ← (C-07), (C-11), (C-09)
Credit (C-09) ← (C-03), (C-07)
Collections (C-10) ← (C-09)
Inventory (C-11) ← (C-04)
Auctions (C-12) ← (C-04), (C-03)
Attendance (C-13) ← (C-01)
Tracking (C-14) ← (C-13), (C-01)
Route (C-15) ← (C-03), (C-14)
KPI (C-16) ← (C-07), (C-13)
Reporting (C-17) ← جميع القدرات (قراءة فقط)
Activity (C-18) ← (C-07), (C-13)
Sync (C-19) ← جميع القدرات
Notifications (C-20) ← (C-01)
Admin (C-21) ← (C-01), (C-02)
Audit (C-22) ← (C-01)
Integration (C-23) ← جميع القدرات
```

---

## 5. نموذج النطاق (Domain Model)

### 5.1 Value Objects المشتركة

| Value Object | الحقول | مملوك لـ |
|--------------|--------|---------|
| `Money` | amount, currency | Foundation |
| `GeoLocation` | latitude, longitude, accuracy, timestamp | Foundation |
| `DateRange` | from, to | Foundation |
| `Quantity` | value, unit (UnitOfMeasure) | Foundation |
| `PhoneNumber` | number, countryCode | Foundation |
| `Address` | street, district, city, governorate, coordinates? | Foundation |
| `UnitOfMeasure` | code, name, baseUnit, conversionFactor | Product Catalog |

### 5.2 الـ Aggregates الرئيسية

| Aggregate | Root | الكيانات الداخلية | دورة الحياة |
|-----------|------|-------------------|-------------|
| **SalesOrder** | SalesOrder | OrderItem[], StatusChange[] | Draft→Submitted→Reviewing→Approved→Preparing→Dispatched→Delivered / Rejected / Cancelled |
| **Customer** | Customer | — | Created→Active→Suspended→Active / Inactive |
| **Product** | Product | Category (مرجع) | Created→Active→Inactive |
| **Workday** | Workday | BreakPeriod[] | Active→Completed / Interrupted |
| **CreditReservation** | CreditReservation | — | Active→Converted / Released (24h expiry) |
| **Check** | Check | — | Received→Deposited→Cleared / Bounced |
| **Payment** | Payment | — | Created→Completed |
| **ReturnRequest** | ReturnRequest | ReturnItem[], ReturnApproval | Pending→Approved→Completed / Rejected |
| **TrackingSession** | TrackingSession | TrackingPoint[] (lazy) | Active→Completed / Interrupted |
| **Target** | Target | — | Defined→Active→Achieved / Expired |

### 5.3 القواعد الثابتة (Invariants) — الرئيسية

| القاعدة | تنتمي لـ Aggregate |
|---------|-------------------|
| `netTotal = total - discount` | SalesOrder |
| لا رجوع إلى حالة سابقة (إلا Cancelled من Approved) | SalesOrder |
| الموافقة تحتاج creditReservationId | SalesOrder |
| لا بدء Workday بدون GPS | Workday |
| لا إنهاء Workday مع Break نشط | Workday |
| 30 دقيقة بدون Heartbeat → Interrupted | Workday |
| `availableStock >= 0` دائماً | Inventory |
| `active` reservation تنتهي بعد 24h | Credit |
| `bounced` Check لا يُعاد إيداعه | Check |
|只能在 7 أيام من التسليم للـ Return | Returns |

---

## 6. استراتيجية التجميعات (Aggregate Strategy)

1. **كل Aggregate يضمن اتساقه الداخلي** — الـ Invariants تُطبق داخل الـ Aggregate
2. **الاتساق بين Aggregates** — عبر Application Services (تنسيق) أو Events (مستقبلاً)
3. **حجم Aggregate** — صغير إلى متوسط (< 100 كيان داخلي)
4. **TrackingSession استثناء** — TrackingPoints لا تُحمّل في الذاكرة (Lazy Load)
5. **لا Aggregate يعرف Aggregate آخر** — فقط Reference عبر ID

---

## 7. قواعد التبعية (Dependency Rules)

### 7.1 بين الطبقات

```
Presentation ──► Application ──► Domain ◄── Contracts ◄── Implementations
                                      │                        │
                                      │                        ▼
                                      │              Infrastructure
                                      │
                                      └── (لا اعتماديات خارجية)
```

### 7.2 قواعد صارمة

| القاعدة | المخالف |
|---------|---------|
| **R-01** | لا استدعاء `supabase.rpc()` من Presentation |
| **R-02** | لا استيراد من `providers/implementations` في Application |
| **R-03** | لا استيراد من `lib/supabase` في Domain |
| **R-04** | لا استيراد من `application` في Domain |
| **R-05** | لا استيراد من `application` في Providers |
| **R-06** | لا استيراد من `store/` في Domain |
| **R-07** | لا Provider يستدعي Provider آخر |
| **R-08** | لا Business Rule في UI |
| **R-09** | لا استدعاء `supabase.rpc()` مباشر من Pages (بعد الترحيل) |

---

## 8. عمارة مزود البيانات (Provider Architecture)

### 8.1 ProviderRegistry — Scope

**القرار:** Scoped Immutable Registry (ADR-002)

- لا Singleton Global
- يُنشأ لكل سياق (Web, Desktop, Test) ويُمرر عبر Constructor
- غير قابل للتغيير بعد الإنشاء (Immutable after build)

### 8.2 Provider Interfaces — التسمية الرسمية

| الاسم الرسمي | القدرة | قاعدة البيانات المرتبطة حالياً |
|-------------|--------|--------------------------------|
| `ISalesOrderProvider` | Sales Order Management | `get_governed_orders`, `create_order`, ... |
| `IProductCatalogProvider` | Product Catalog | `get_governed_products` |
| `ICustomerProvider` | Customer Management | `get_customers`, `create_customer` |
| `ICreditManagementProvider` | Credit Management | `reserve_credit`, `release_reservation` |
| `ICollectionProvider` | Collections & Payments | `record_payment`, `register_check` |
| `IIdentityProvider` | Identity & Access | `login`, `validate_session`, `logout` |
| `IAuthorizationProvider` | Authorization | `check_capability`, `get_roles` |
| `IAttendanceProvider` | Attendance & Time | `start_workday`, `end_workday` |
| `IEmployeeTrackingProvider` | Employee Tracking | `sync_tracking_points`, `record_heartbeat` |
| `IOfferManagementProvider` | Deals & Offers | `get_active_deals`, `get_flash_offers` |
| `IReturnsProvider` | Returns Management | `create_return_request`, `approve_return` |
| `IInventoryProvider` | Inventory Control | `reserve_stock`, `get_stock_level` |
| `IAuctionProvider` | Auctions | `create_auction`, `place_bid` |
| `IRouteProvider` | Route Management | `get_routes`, `record_visit` |
| `ITargetProvider` | KPI & Targets | `get_targets`, `get_kpi_values` |
| `IReportingProvider` | Reporting & Analytics | (تقارير) |
| `IActivityProvider` | Business Activity | `get_activity_stream` |
| `ISyncProvider` | Synchronization | `sync_pull`, `sync_push` |
| `INotificationProvider` | Notifications | `send_notification`, `get_notifications` |
| `IAdministrationProvider` | Administration | `get_settings`, `manage_users` |
| `IAuditProvider` | Audit & Log | `record_audit`, `query_audit_log` |
| `IIntegrationProvider` | Integration | `register_webhook`, `get_api_keys` |
| `IPricingProvider` | Pricing & Discounts | `get_tiers`, `get_exceptions` |

### 8.3 استراتيجية المعاملات (Transaction Strategy)

**القرار:** Saga Pattern لـ Supabase (ADR-003)

- المعاملات البسيطة: كل شيء في RPC واحد (الوضع الحالي)
- المعاملات المركبة: Saga مع Compensating Actions
- `IUnitOfWork` يبقى كواجهة لـ PostgreSQL المباشر (المستقبل)

### 8.4 قائمة Providers المطلوب تنفيذها

| الأولوية | الـ Provider | التقدير |
|----------|-------------|---------|
| P0 | `Mock{Capability}Provider` لجميع القدرات (قبل أي تنفيذ) | 3 أيام |
| P1 | `SupabaseSalesOrderProvider` | 2 يوم |
| P1 | `SupabaseProductCatalogProvider` | 1 يوم |
| P1 | `SupabaseCustomerProvider` | 1 يوم |
| P1 | `SupabaseIdentityProvider` + `SupabaseAuthorizationProvider` | 1.5 يوم |
| P2 | `SupabaseCreditManagementProvider` + `SupabaseCollectionProvider` | 2 يوم |
| P2 | `SupabaseAttendanceProvider` + `SupabaseEmployeeTrackingProvider` | 2.5 يوم |
| P3 | بقية الـ SupabaseProviders | 4 أيام |

---

## 9. طبقة البنية التحتية (Infrastructure Layer)

### 9.1 المكونات

| المكون | المسؤولية | الموقع الحالي |
|--------|-----------|---------------|
| **TrackingEngine** | تسجيل نقاط GPS دورياً | `capacitor-plugins/trackingEngine.ts` |
| **GpsService** | الحصول على الموقع (browser/Capacitor) | `utils/gpsEngine.ts` |
| **HeartbeatService** | نبضات حية كل 5 دقائق | `services/heartbeatService.ts` |
| **OfflineQueue** | تخزين نقاط GPS في IndexedDB عند عدم الاتصال | `services/trackingQueue.ts` |
| **NetworkStatus** | مراقبة حالة الاتصال | (جديد) |
| **LoggerService** | تسجيل أحداث النظام | `services/failureLogger.ts` |
| **ServiceWorkerManager** | إدارة الـ SW (precache, background sync) | `sw.ts` |

### 9.2 الموقع الجديد

```
src/infrastructure/
├── tracking/
│   └── TrackingEngine.ts
├── gps/
│   └── GpsService.ts
├── heartbeat/
│   └── HeartbeatService.ts
├── queue/
│   └── OfflineQueue.ts
├── network/
│   └── NetworkStatusService.ts
├── logging/
│   └── LoggerService.ts
└── sw/
    └── ServiceWorkerManager.ts
```

---

## 10. RequestContext

### 10.1 التعريف الرسمي

```typescript
interface RequestContext {
  token: string
  identityId: string
  identityType: 'employee' | 'customer'
  companyId: string
  roles: string[]
  device?: 'web' | 'desktop' | 'mobile'
  timestamp: Date
}
```

### 10.2 الاستخدام

- كل Application Service يستقبل `RequestContext` في الـ Constructor أو الطريقة
- يُستخرج من Auth Store حالياً، لاحقاً من الـ Session
- يُمرر إلى Provider عند الحاجة (لحوكمة الوصول)

---

## 11. تدفق البيانات (Data Flow)

### 11.1 كتابة (Write Flow)

```
[MobilePage / DesktopPage] → Application Service
  → RequestContext (auth, company)
  → Validator.validate(request)
  → Domain Service (حسابات / قواعد)
  → Saga:
      1. Provider A.create(data)
      2. Provider B.reserve(data)
      3. Provider C.update(data)
  → Mapper.toResponse(result)
  → return DTO
```

### 11.2 قراءة (Read Flow)

```
[MobilePage / DesktopPage] → Application Service
  → Provider.getAll/filter
  → Mapper.toResponseList(data)
  → return DTO[]
```

---

## 12. Desktop Runtime (Electron)

### 12.1 القرار

**Electron هو منصة تشغيل Desktop الرسمية.** (ADR-010)

التفاصيل الكاملة في: `27_DESKTOP_RUNTIME_STRATEGY.md`

### 12.2 النموذج

```
React (Renderer) ── IPC (preload.ts) ──► Electron Main Process
     │                                         │
     ▼                                         ▼
Application Services              PostgreSQL Manager / Backup / Sync / AI
     │
     ▼
Provider Contracts
     │
     ├── SupabaseProvider (Remote)
     └── DesktopProvider (Local — عبر IPC)
```

### 12.3 مسؤوليات Main Process

| الخدمة | الوصف |
|--------|-------|
| **PostgreSQL Manager** | بدء/إيقاف PostgreSQL محلي لإدارة البيانات المحلية |
| **Backup Engine** | أخذ/استعادة نسخ احتياطية من قاعدة البيانات المحلية |
| **Sync Engine** | مزامنة البيانات بين Local PostgreSQL و Supabase |
| **Auto Update** | تحديث تلقائي للتطبيق (electron-updater) |
| **AI Runtime** | تشغيل نماذج LLM محلية |
| **Print Service** | طباعة الفواتير والتقارير |
| **Plugin Loader** | تحميل إضافات خارجية |
| **License Manager** | إدارة تراخيص التطبيق |

### 12.4 IPC Bridge

```typescript
// Renderer يتواصل مع Main Process فقط عبر:
window.api.backup.create(options)
window.api.database.start()
window.api.sync.status()
window.api.ai.ask(prompt)
// ... إلخ
```

### 12.5 الأمان

```
contextIsolation: true
sandbox: true
nodeIntegration: false
```

### 12.6 موقع `desktop/` خارج `src/`

| المسار | المحتوى |
|--------|---------|
| `src/presentation/desktop/` | React — صفحات ومكونات الديسكتوب |
| `desktop/` | Electron Main Process — مستقل عن build pipeline |
| `src/providers/implementations/desktop/` | Providers محليين يتواصلون مع Main عبر IPC |

---

## 13. ملخص القرارات المعمارية (ADR Summary)

| ADR | القرار | الحالة |
|-----|--------|--------|
| ADR-001 | Business Capability Architecture | ✅ معتمد |
| ADR-002 | Scoped Immutable Registry | ✅ معتمد |
| ADR-003 | Saga Pattern بدلاً من Distributed Transaction | ✅ معتمد |
| ADR-004 | Infrastructure Layer منفصلة | ✅ معتمد |
| ADR-005 | Provider Interfaces حسب Capabilities | ✅ معتمد |
| ADR-006 | RequestContext لجميع الطلبات | ✅ معتمد |
| ADR-007 | Domain Pure TypeScript | ✅ معتمد |
| ADR-008 | Strangler Fig للترحيل | ✅ معتمد |
| ADR-009 | Dual Presentation (Mobile + Desktop) | ✅ معتمد |
| ADR-010 | Desktop Runtime Strategy (Electron) | ✅ معتمد |

**كل ADR مفصل بالكامل في:** `20_ARCHITECTURE_DECISIONS.md`

---

## 14. هيكل المجلدات (Folder Structure) — الرسمي

```
src/
├── bootstrap.ts             ← إنشاء ProviderRegistry مع Providers المناسبة
│
├── presentation/            ← جميع مكونات واجهة المستخدم
│   ├── mobile/              ← Mobile PWA — Touch-first UX
│   │   ├── pages/           ← صفحات الموبايل (OrdersPage, LoginPage, ...)
│   │   ├── components/      ← مكونات خاصة بالموبايل (BottomNav, PullToRefresh, ...)
│   │   ├── layouts/         ← تخطيطات الموبايل (MobileLayout, AuthLayout)
│   │   ├── hooks/           ← Hooks خاصة بالموبايل (useGeolocation, useCamera, ...)
│   │   ├── store/           ← حالة خاصة بالموبايل (zustand)
│   │   └── App.tsx          ← نقطة دخول الموبايل
│   │
│   ├── desktop/             ← Desktop EXE — Keyboard-first UX
│   │   ├── pages/           ← صفحات الديسكتوب (DashboardPage, GridOrdersPage, ...)
│   │   ├── components/      ← مكونات خاصة بالديسكتوب (DataGrid, Sidebar, ...)
│   │   ├── layouts/         ← تخطيطات الديسكتوب (DesktopLayout, MultiPanelLayout)
│   │   ├── hooks/           ← Hooks خاصة بالديسكتوب (useKeyboardShortcuts, ...)
│   │   ├── store/           ← حالة خاصة بالديسكتوب (zustand)
│   │   └── App.tsx          ← نقطة دخول الديسكتوب
│   │
│   └── shared/              ← مكونات مشتركة بين الموبايل والديسكتوب
│       ├── components/      ← Buttons, Inputs, Icons, Loading, Modals
│       ├── hooks/           ← Hooks مشتركة (useAuth, useCapability)
│       ├── store/           ← Store مشترك (auth store)
│       ├── utils/           ← format, roleNormalization
│       └── assets/          ← صور، أيقونات، Fonts
│
├── application/             ← مشترك — Application Services, DTOs, Mappers, Validators
│   ├── services/
│   │   ├── identity/        ← AuthenticationService, SessionService
│   │   ├── salesOrder/      ← OrderCreationService, OrderApprovalService
│   │   ├── productCatalog/  ← ProductQueryService, ProductSearchService
│   │   ├── customer/        ← CustomerProfileService
│   │   ├── credit/          ← CreditReservationService
│   │   ├── attendance/      ← WorkdayStartService
│   │   └── ... (حسب كل قدرة)
│   ├── dto/                 ← DTOs لكل قدرة
│   ├── mappers/             ← Mappers لكل قدرة
│   └── validators/          ← Validators لكل قدرة
│
├── domain/                   ← مشترك — Domain Models (TypeScript pure)
│   ├── models/
│   ├── value-objects/
│   ├── enums/
│   └── services/            ← PricingService, etc.
│
├── providers/                ← مشترك — Contracts + Implementations
│   ├── contracts/           ← Interfaces فقط
│   ├── registry/            ← ProviderRegistry, types
│   └── implementations/
│       ├── supabase/        ← Supabase{Capability}Provider
│       ├── mock/            ← Mock{Capability}Provider
│       └── local/           ← (مستقبلاً)
│
├── infrastructure/           ← مشترك — GPS, Tracking, Heartbeat, SW, Logging
│   ├── tracking/
│   ├── gps/
│   ├── heartbeat/
│   ├── queue/
│   ├── network/
│   ├── logging/
│   └── sw/
│
├── lib/supabase.ts          ← (يبقى — يحتاجه SupabaseProvider)
├── utils/                   ← (يبقى — دوال مساعدة مشتركة)
└── services/ (قديم)         ← ⛔ سيُزال خلال الترحيل
```

**ملاحظة:** `presentation/mobile/App.tsx` و `presentation/desktop/App.tsx` هما نقطتا دخول منفصلتان.  
كل منهما يستخدم نفس الـ `bootstrap.ts` لكن يبني Registry مختلفاً حسب الحاجة.  
`presentation/shared/store/` يحتوي الـ auth store المشترك — بقية الـ stores خاصة بالمنصة.

---

## 15. استراتيجية الترحيل (Migration Strategy)

### 14.1 النمط: Strangler Fig (ADR-008)

- النظام القديم (`services/`) يبقى حتى آخر مرحلة
- كل صفحة تُرحّل تدريجياً لاستخدام Application Services الجديدة
- النظام القديم والجديد يعملان معاً أثناء الترحيل

### 14.2 المراحل الخمس

| المرحلة | المدة | المخرجات |
|---------|-------|---------|
| **Phase 0: Foundation** | 5 أيام | مجلدات + Contracts + MockProvider + bootstrap |
| **Phase 1: Core Providers** | 8 أيام | SupabaseProviders لـ 4 قدرات رئيسية + Application Services |
| **Phase 2: Page Migration** | 10 أيام | ترحيل أول صفحتين + Credit + Attendance Providers |
| **Phase 3: Expansion** | 12 أيام | ترحيل كل الصفحات + إزالة services/ القديمة |
| **Phase 4: Provider Expansion** | 8 أيام | Local + Sync Providers للتجربة |

**التفاصيل الكاملة في:** `13_PROVIDER_MIGRATION_PLAN.md`

---

## 16. الوثائق الملغاة والمستبدلة

| هذه الوثيقة | تستبدل (Supersedes) |
|-------------|-------------------|
| 21 (هذه) | 09_DATA_PROVIDER_ARCHITECTURE.md (جزئياً) |
| 21 (هذه) | 10_PROVIDER_INTERFACES.md (جزئياً) |
| 21 (هذه) | 11_APPLICATION_LAYER.md (جزئياً) |

الوثائق 09-11 تبقى كمراجع تاريخية لكن المحتوى المعتمد هو في هذه الوثيقة.

| هذه الوثيقة | تستبدل (Supersedes) |
|-------------|-------------------|
| 26 (جديد) | (لا يوجد — وثيقة جديدة تغطي Presentation Architecture) |
| 27 (جديد) | (لا يوجد — وثيقة جديدة تغطي Desktop Runtime Strategy) |

---

## 17. الخلاصة

| البند | القيمة |
|-------|--------|
| الإصدار | 1.2 |
| الحالة | ✅ مجمّدة |
| عدد الطبقات | 6 (Presentation → Infrastructure) |
| مسارات Presentation | 2 (Mobile + Desktop) |
| Desktop Runtime | Electron (Main Process + IPC Bridge) |
| عدد قدرات الأعمال | 23 |
| عدد Aggregates | 10 رئيسية |
| عدد ADRs | 10 |
| استراتيجية الترحيل | Strangler Fig |
| Provider Registry | Scoped Immutable |
| Transaction Model | Saga لـ Supabase |
| الوثائق المعتمدة | هذه الوثيقة + 15-20 + 22-27 |
