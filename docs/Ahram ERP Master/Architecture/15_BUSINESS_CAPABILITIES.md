# 15 – Business Capabilities

**التصنيف:** تصميم معماري — قدرات الأعمال  
**الغرض:** تحديد وتوثيق جميع قدرات الأعمال الأساسية في نظام Ahram ERP  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** مسودة للاعتماد

---

## 1. ما هي قدرة الأعمال (Business Capability)

قدرة الأعمال هي **وظيفة أعمال مستقلة** يقدمها النظام، تمتلك:

- **غرضاً واضحاً** (Purpose) — لماذا توجد هذه القدرة
- **مسؤوليات محددة** (Responsibilities) — ما تفعله بالضبط
- **قواعد أعمال خاصة بها** (Business Rules) — المنطق الذي تملكه ولا تملكه أي قدرة أخرى
- **نطاق بيانات خاص** (Domain Models) — الكيانات التي تديرها
- **واجهات Providers خاصة بها** — كيفية وصولها للبيانات
- **Application Services خاصة بها** — كيفية تنسيق عملياتها

**مبدأ أساسي:** قدرات الأعمال **لا تعتمد على بعضها** في تعريفها.  
**الاعتماد يكون في التنفيذ** (Application Services تنسق بين قدرات متعددة).

---

## 2. خريطة قدرات الأعمال

```
┌─────────────────────────────────────────────────────────────┐
│                        Ahram ERP                            │
├───────────┬───────────┬───────────┬───────────┬─────────────┤
│  Core      │  Commerce │  People    │  Intelligence │  Foundation │
│  Sales     │           │  & Time   │              │             │
├───────────┼───────────┼───────────┼───────────┼─────────────┤
│ Identity   │ Customer  │ Attendance│ KPI &      │ Sync        │
│ & Access   │ Management│ & Time    │ Targets    │ & Offline   │
│            │           │           │            │             │
│ Authoriz-  │ Product   │ Employee  │ Reporting  │ Notification│
│ ation      │ Catalog   │ Tracking  │ & Analytics│ & Alerts    │
│            │           │           │            │             │
│ Pricing    │ Sales     │ Route     │ Business   │ Administra- │
│ & Discounts│ Order Mgmt│ Management│ Activity   │ tion        │
│            │           │           │            │             │
│ Deals &    │ Returns   │           │ Dashboard  │ Audit & Log │
│ Offers     │ Mgmt      │           │            │             │
│            │           │           │            │             │
│ Credit     │ Inventory │           │            │ Integration │
│ Management │ Control   │           │            │ & API       │
│            │           │           │            │             │
│ Collections│ Auctions  │           │            │             │
│ & Payments │           │           │            │             │
└───────────┴───────────┴───────────┴───────────┴─────────────┘
```

---

## 3. تعريف كل قدرة أعمال

### 3.1 Core Sales

#### Identity & Access

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة هويات المستخدمين (موظفين وعملاء) وجلسات الدخول |
| **المسؤوليات** | تسجيل الدخول، تسجيل الخروج، التحقق من الجلسة، إدارة الهويات |
| **قواعد الأعمال المملوكة** | كلمة المرور مشفرة، الجلسة تنتهي بعد 24 ساعة، لا جلسات متزامنة |
| **Domain Models** | `Identity`, `Session`, `LoginCredential` |
| **Data Providers** | `IIdentityProvider` |
| **Application Services** | `AuthenticationService`, `SessionService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | (لا يوجد — هذه القدرة لا تعتمد على غيرها) |

#### Authorization

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة الصلاحيات والأدوار وحوكمة الوصول |
| **المسؤوليات** | تعريف الأدوار، تعيين الصلاحيات، التحقق من الوصول، تصعيد الصلاحيات للإدارة العليا |
| **قواعد الأعمال المملوكة** | الإدارة العليا تتجاوز كل الصلاحيات، 8 أدوار مقننة، كل RPC يطبق حوكمة |
| **Domain Models** | `Role`, `Capability`, `Permission`, `GovernancePolicy` |
| **Data Providers** | `IAuthorizationProvider` |
| **Application Services** | `CapabilityService`, `RoleManagementService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | `Identity & Access` (للتحقق من الهوية) |

#### Pricing & Discounts

| الحقل | القيمة |
|-------|--------|
| **الغرض** | حساب أسعار المنتجات مع تطبيق الخصومات وشرائح التسعير |
| **المسؤوليات** | حساب سعر القطعة/الدستة/الكرتونة، تطبيق خصم الشريحة، استثناءات المنتج والشركة |
| **قواعد الأعمال المملوكة** | `cartonPrice / cartonQuantity * 12` للدستة، الخصم لا يتجاوز حد الشريحة، استثناءات المنتج تعلو الشريحة |
| **Domain Models** | `Price`, `Discount`, `PriceTier`, `PriceException`, `UnitPrice` |
| **Data Providers** | `IPricingProvider` |
| **Application Services** | `PricingCalculationService`, `DiscountApplicationService` |
| **اعتماديات خارجية** | (لا يوجد — كل الحسابات داخلية) |
| **اعتماديات داخلية** | `Product Catalog` (للحصول على معلومات المنتج)، `Authorization` (للتحقق من صلاحية الخصم) |

#### Deals & Offers

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة العروض الترويجية والخصومات الخاصة |
| **المسؤوليات** | تعريف العروض، تفعيل/إلغاء العروض، التحقق من صحة العرض، حساب سعر العرض |
| **قواعد الأعمال المملوكة** | العرض النشط فقط يطبق، لا يجمع عرضين على نفس المنتج، العرض له صلاحية زمنية |
| **Domain Models** | `Deal`, `FlashOffer`, `DailyDeal`, `DealEligibility` |
| **Data Providers** | `IDealProvider`, `IFlashOfferProvider`, `IDailyDealProvider` |
| **Application Services** | `DealActivationService`, `OfferEligibilityService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | `Product Catalog`, `Pricing & Discounts` |

#### Credit Management

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة الائتمان للعملاء — الحدود، الحجوزات، الأرصدة المستحقة |
| **المسؤوليات** | تحديد حد الائتمان، حجز الائتمان عند الطلب، تحرير الحجز عند الإلغاء، تحويل الحجز إلى مستحق عند التأكيد |
| **قواعد الأعمال المملوكة** | لا يتجاوز الحجز الحد المتاح، الحجز ينتهي بعد 24 ساعة، التحويل إلى مستحق عند التأكيد فقط |
| **Domain Models** | `CreditLimit`, `CreditReservation`, `OutstandingBalance`, `CreditTransaction`, `CreditProgram` |
| **Data Providers** | `ICreditProvider` |
| **Application Services** | `CreditReservationService`, `CreditReleaseService`, `OutstandingService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | `Identity & Access` (للعميل)، `Sales Order Management` (للربط بالطلب) |

#### Collections & Payments

| الحقل | القيمة |
|-------|--------|
| **الغرض** | تحصيل المدفوعات من العملاء — نقداً، شيكات، تحويلات |
| **المسؤوليات** | تسجيل الدفعات، إدارة الشيكات (تحصيل/إرجاع)، متابعة الدفعات المتأخرة |
| **قواعد الأعمال المملوكة** | الشيك يحتاج 3 أيام للتصفية، الشيك المرتجع عليه غرامة، الدفعة تقلل الرصيد المستحق أولاً |
| **Domain Models** | `Payment`, `Check`, `PaymentMethod` |
| **Data Providers** | `ICollectionProvider` |
| **Application Services** | `PaymentRecordingService`, `CheckDepositService`, `OverdueFollowupService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | `Credit Management` |

### 3.2 Commerce

#### Customer Management

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة دورة حياة العميل بالكامل |
| **المسؤوليات** | إنشاء/تحديث بيانات العميل، تصنيف العملاء، تعيين الخط الملاحي، إيقاف/تفعيل العميل |
| **قواعد الأعمال المملوكة** | كل عميل ينتمي لشركة، العميل يمكن أن يكون موظفاً أيضاً، رقم الهاتف فريد ضمن الشركة |
| **Domain Models** | `Customer`, `CustomerClassification`, `CustomerRoute` |
| **Data Providers** | `ICustomerProvider` |
| **Application Services** | `CustomerProfileService`, `CustomerClassificationService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | (لا يوجد) |

#### Product Catalog

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة كتالوج المنتجات — التصنيف، التسعير الأساسي، التوفر |
| **المسؤوليات** | تعريف المنتجات، تصنيف المنتجات، تحديد وحدات القياس، التحكم في الظهور |
| **قواعد الأعمال المملوكة** | المنتج له 3 وحدات قياس (قطعة/دستة/كرتونة)، `cartonQuantity >= 24` لتظهر الدستة |
| **Domain Models** | `Product`, `Category`, `UnitOfMeasure`, `ProductAvailability` |
| **Data Providers** | `IProductProvider` |
| **Application Services** | `ProductQueryService`, `ProductSearchService`, `ProductMaintenanceService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | (لا يوجد) |

#### Sales Order Management

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة دورة حياة أمر البيع بالكامل — من المسودة إلى التسليم |
| **المسؤوليات** | إنشاء الطلب، تقديم الطلب، الموافقة/الرفض، التحضير، التوزيع، التسليم، الإلغاء |
| **قواعد الأعمال المملوكة** | الطلب يمر بـ 9 حالات (draft → submitted → reviewing → approved → rejected → preparing → dispatched → delivered → cancelled)، لا يمكن الموافقة دون التحقق من الائتمان، لا يمكن التوزيع دون الموافقة |
| **Domain Models** | `SalesOrder`, `OrderItem`, `OrderStatus`, `OrderApproval` |
| **Data Providers** | `ISalesOrderProvider` |
| **Application Services** | `OrderCreationService`, `OrderApprovalService`, `OrderFulfillmentService`, `OrderQueryService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | `Customer Management`, `Product Catalog`, `Pricing & Discounts`, `Credit Management`, `Inventory Control` |

#### Returns Management

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة المرتجعات — طلب، موافقة، تنفيذ |
| **المسؤوليات** | إنشاء طلب مرتجع، مراجعة/موافقة، إعادة المخزون، إصدار دائن |
| **قواعد الأعمال المملوكة** | المرتجع مقبول فقط خلال 7 أيام من التسليم، المرتجع يحتاج موافقة المدير، إعادة المخزون بعد الموافقة |
| **Domain Models** | `ReturnRequest`, `ReturnItem`, `ReturnApproval` |
| **Data Providers** | `IReturnsProvider` |
| **Application Services** | `ReturnRequestService`, `ReturnApprovalService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | `Sales Order Management`, `Inventory Control`, `Credit Management` |

#### Inventory Control

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة المخزون — الأرصدة، الحجوزات، الحركات |
| **المسؤوليات** | تتبع المخزون، حجز المخزون للطلبات، تحرير الحجوزات، تسجيل حركات المخزون |
| **قواعد الأعمال المملوكة** | الحجز يقلل المخزون المتاح فقط (لا الكلي)، تحرير الحجز يعيد المخزون، المخزون لا يمكن أن يكون سالباً |
| **Domain Models** | `InventoryItem`, `StockReservation`, `StockMovement`, `Warehouse` |
| **Data Providers** | `IInventoryProvider` |
| **Application Services** | `StockReservationService`, `StockReleaseService`, `InventoryQueryService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | `Sales Order Management`, `Returns Management` |

#### Auctions

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة المزادات على المنتجات |
| **المسؤوليات** | إنشاء مزاد، تسجيل المزايدات، إغلاق المزاد، تحديد الفائز |
| **قواعد الأعمال المملوكة** | المزاد له وقت بداية ونهاية، المزايدة يجب أن تزيد عن السعر الحالي، الفائز يلتزم بالسعر |
| **Domain Models** | `Auction`, `Bid`, `AuctionWinner` |
| **Data Providers** | `IAuctionProvider` |
| **Application Services** | `AuctionManagementService`, `BiddingService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | `Product Catalog`, `Customer Management` |

### 3.3 People & Time

#### Attendance & Time

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة دوام الموظفين — الحضور، الانصراف، فترات الراحة |
| **المسؤوليات** | تسجيل بدء يوم العمل، تسجيل الانصراف، إدارة فترات الراحة، حساب ساعات العمل الصافية |
| **قواعد الأعمال المملوكة** | لا يمكن بدء يوم عمل دون GPS، لا يمكن إنهاء يوم عمل لم يبدأ، خصم فترات الراحة من إجمالي الوقت، إنهاء الجلسة بعد 30 دقيقة انقطاع |
| **Domain Models** | `Workday`, `BreakPeriod`, `AttendanceSession` |
| **Data Providers** | `IAttendanceProvider` |
| **Application Services** | `WorkdayStartService`, `WorkdayEndService`, `BreakManagementService`, `AttendanceQueryService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | `Identity & Access` |

#### Employee Tracking

| الحقل | القيمة |
|-------|--------|
| **الغرض** | تتبع حركة الموظف الميداني عبر GPS |
| **المسؤوليات** | تسجيل نقاط GPS دورياً، مزامنة النقاط مع الخادم، إدارة قائمة انتظار Offline |
| **قواعد الأعمال المملوكة** | نقطة GPS تسجل كل 30 ثانية، المزامنة كل دقيقة، النقاط بدون اتصال تخزن في IndexedDB |
| **Domain Models** | `TrackingPoint`, `TrackingSession`, `GeoLocation` |
| **Data Providers** | `ITrackingProvider` |
| **Application Services** | `TrackingSyncService`, `TrackingQueryService` |
| **اعتماديات خارجية** | Geolocation API (browser/Capacitor) |
| **اعتماديات داخلية** | `Attendance & Time`, `Identity & Access` |

#### Route Management

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة الخطوط الملاحية — تخطيط زيارات العملاء |
| **المسؤوليات** | تعريف الخطوط الملاحية، تعيين العملاء للخطوط، تخطيط الزيارات اليومية |
| **قواعد الأعمال المملوكة** | العميل ينتمي لخط واحد فقط، الزيارة تسجل مع الوقت والموقع |
| **Domain Models** | `Route`, `RouteVisit`, `RoutePlan` |
| **Data Providers** | `IRouteProvider` |
| **Application Services** | `RoutePlanningService`, `VisitRecordingService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | `Customer Management`, `Employee Tracking` |

### 3.4 Intelligence

#### KPI & Targets

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة مؤشرات الأداء والأهداف البيعية |
| **المسؤوليات** | تعريف الأهداف، تتبع الإنجاز مقابل الهدف، حساب مؤشرات الأداء |
| **قواعد الأعمال المملوكة** | KPI المبيعات = بيانات الطلبات (لا يوجد كيان مبيعات منفصل)، الهدف اليومي = الهدف الشهري / أيام العمل |
| **Domain Models** | `Target`, `KpiDefinition`, `KpiValue`, `TargetAchievement` |
| **Data Providers** | `ITargetProvider`, `IKpiProvider` |
| **Application Services** | `TargetSettingService`, `KpiCalculationService`, `PerformanceQueryService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | `Sales Order Management`, `Attendance & Time` |

#### Reporting & Analytics

| الحقل | القيمة |
|-------|--------|
| **الغرض** | توليد التقارير وتحليل البيانات |
| **المسؤوليات** | تقارير المبيعات، تقارير الحضور، تقارير الأداء، تحليل الاتجاهات |
| **قواعد الأعمال المملوكة** | (لا توجد — التجميع والتحليل دون قواعد أعمال خاصة) |
| **Domain Models** | `Report`, `ReportDefinition`, `DashboardWidget` |
| **Data Providers** | `IReportingProvider` |
| **Application Services** | `ReportGenerationService`, `DashboardService` |
| **اعتماديات خارجية** | (لا يوجد) |
| **اعتماديات داخلية** | جميع قدرات الأعمال (مصدر البيانات) |

#### Business Activity

| الحقل | القيمة |
|-------|--------|
| **الغرض** | مراقبة النشاط التجاري في الوقت الفعلي |
| **المسؤوليات** | تسجيل الأحداث التجارية، عرض النشاط الحي |
| **قواعد الأعمال المملوكة** | `kpiType === 'sales'` maps to `recordType = 'orders'` |
| **Domain Models** | `ActivityEvent`, `ActivityStream` |
| **Data Providers** | `IActivityProvider` |
| **Application Services** | `ActivityStreamService`, `BusinessActivityService` |
| **اعتماديات داخلية** | `Sales Order Management`, `Attendance & Time` |

### 3.5 Foundation

#### Synchronization & Offline

| الحقل | القيمة |
|-------|--------|
| **الغرض** | مزامنة البيانات بين التخزين المحلي والخادم، ودعم العمل دون اتصال |
| **المسؤوليات** | مزامنة دورية، حل تعارضات، قائمة انتظار Offline، تخزين محلي |
| **قواعد الأعمال المملوكة** | المزامنة أحادية الاتجاه (السحابة هي المصدر)، التعارضات تحل بـ "آخر تعديل يفوز" |
| **Domain Models** | `SyncQueue`, `SyncConflict`, `LocalStore` |
| **Data Providers** | `ISyncProvider`, `ILocalProvider` |
| **Application Services** | `SyncOrchestrationService`, `ConflictResolutionService` |
| **اعتماديات خارجية** | IndexedDB, Network Status API |
| **اعتماديات داخلية** | جميع قدرات الأعمال (كلها تحتاج المزامنة) |

#### Notification & Alerts

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة الإشعارات والتنبيهات للمستخدمين |
| **المسؤوليات** | إرسال الإشعارات (Push/In-app)، إدارة تفضيلات الإشعارات، سجل الإشعارات |
| **قواعد الأعمال المملوكة** | الإشعارات مرتبة حسب الأهمية، الإشعارات المقروءة تحذف بعد 30 يوماً |
| **Domain Models** | `Notification`, `NotificationPreference`, `NotificationChannel` |
| **Data Providers** | `INotificationProvider` |
| **Application Services** | `NotificationDispatchService`, `NotificationPreferenceService` |
| **اعتماديات خارجية** | Push API, Capacitor Push Plugin |
| **اعتماديات داخلية** | `Identity & Access` |

#### Administration

| الحقل | القيمة |
|-------|--------|
| **الغرض** | إدارة إعدادات النظام والشركات |
| **المسؤوليات** | إعدادات الشركة، إدارة المستخدمين (CRUD), تكوين النظام |
| **قواعد الأعمال المملوكة** | (لا توجد — إدارية بحتة) |
| **Domain Models** | `Company`, `SystemSetting`, `AuditLog` |
| **Data Providers** | `IAdministrationProvider` |
| **Application Services** | `CompanySettingsService`, `UserManagementService`, `AuditService` |
| **اعتماديات داخلية** | `Identity & Access`, `Authorization` |

#### Audit & Log

| الحقل | القيمة |
|-------|--------|
| **الغرض** | تسجيل جميع العمليات الهامة للتدقيق |
| **المسؤوليات** | تسجيل الأحداث، استعلام سجل التدقيق، الاحتفاظ بالسجل |
| **قواعد الأعمال المملوكة** | سجل التدقيق لا يُحذف، كل عملية تغيير حالة تُسجل |
| **Domain Models** | `AuditEntry`, `EventLog` |
| **Data Providers** | `IAuditProvider` |
| **Application Services** | `AuditRecordingService`, `AuditQueryService` |
| **اعتماديات داخلية** | `Identity & Access` |

#### Integration & API

| الحقل | القيمة |
|-------|--------|
| **الغرض** | التكامل مع الأنظمة الخارجية |
| **المسؤوليات** | تعريف واجهات API الخارجية، إدارة المفاتيح، تحويل البيانات |
| **قواعد الأعمال المملوكة** | (لا توجد — تكامل تقني بحت) |
| **Domain Models** | `ApiKey`, `Webhook`, `IntegrationMapping` |
| **Data Providers** | `IIntegrationProvider` |
| **Application Services** | `ApiGatewayService`, `WebhookDispatchService` |
| **اعتماديات خارجية** | (يعتمد على النظام المتكامل معه) |
| **اعتماديات داخلية** | جميع قدرات الأعمال (أي منها يمكن تكشيفه) |

---

## 4. مصفوفة الـ Ownership

| القدرة | تملك Domain Models | تملك Providers | تملك App Services | تملك Business Rules |
|--------|-------------------|----------------|-------------------|---------------------|
| Identity & Access | ✅ | ✅ | ✅ | ✅ |
| Authorization | ✅ | ✅ | ✅ | ✅ |
| Pricing & Discounts | ✅ | ✅ | ✅ | ✅ |
| Deals & Offers | ✅ | ✅ | ✅ | ✅ |
| Credit Management | ✅ | ✅ | ✅ | ✅ |
| Collections & Payments | ✅ | ✅ | ✅ | ✅ |
| Customer Management | ✅ | ✅ | ✅ | ✅ |
| Product Catalog | ✅ | ✅ | ✅ | ✅ |
| Sales Order Management | ✅ | ✅ | ✅ | ✅ |
| Returns Management | ✅ | ✅ | ✅ | ✅ |
| Inventory Control | ✅ | ✅ | ✅ | ✅ |
| Auctions | ✅ | ✅ | ✅ | ✅ |
| Attendance & Time | ✅ | ✅ | ✅ | ✅ |
| Employee Tracking | ✅ | ✅ | ✅ | ✅ |
| Route Management | ✅ | ✅ | ✅ | ✅ |
| KPI & Targets | ✅ | ✅ | ✅ | ✅ |
| Reporting & Analytics | ✅ | ✅ | ❌ (تجميع) | ❌ |
| Business Activity | ✅ | ✅ | ✅ | ✅ |
| Sync & Offline | ✅ | ✅ | ✅ | ✅ |
| Notification & Alerts | ✅ | ✅ | ✅ | ✅ |
| Administration | ✅ | ✅ | ✅ | ❌ |
| Audit & Log | ✅ | ✅ | ✅ | ✅ |
| Integration & API | ✅ | ✅ | ✅ | ❌ |

---

## 5. تبعيات التنفيذ بين القدرات

```
Identity & Access  ← لا تعتمد على أحد
Authorization      ← Identity & Access

Customer Management ← لا تعتمد على أحد
Product Catalog    ← لا تعتمد على أحد

Pricing & Discounts ← Product Catalog, Authorization
Deals & Offers     ← Product Catalog, Pricing & Discounts
Credit Management  ← Customer Management, Sales Order Management
Collections & Payments ← Credit Management

Sales Order Management ← Customer, Product, Pricing, Credit, Inventory
Returns Management ← Sales Order, Inventory, Credit
Inventory Control  ← Product Catalog

Attendance & Time  ← Identity & Access
Employee Tracking  ← Attendance & Time, Identity & Access
Route Management   ← Customer Management, Employee Tracking

KPI & Targets      ← Sales Order, Attendance
Reporting & Analytics ← جميع القدرات (قراءة فقط)
Business Activity  ← Sales Order, Attendance

Sync & Offline     ← جميع القدرات
Notification & Alerts ← Identity & Access
Administration     ← Identity & Access, Authorization
Audit & Log        ← Identity & Access
Integration & API  ← جميع القدرات (قراءة/كتابة)
```

---

## 6. تغيير جوهري عن TASK-002

| الخطأ في TASK-002 | التصحيح في TASK-003 |
|-------------------|---------------------|
| `IOrderProvider` — يركز على الطلب كجدول | `ISalesOrderProvider` — يركز على قدرة إدارة أوامر البيع |
| `IProductProvider` — يركز على المنتج كجدول | `IProductCatalogProvider` — يركز على قدرة كتالوج المنتجات |
| `ICreditProvider` — واسع جداً | `ICreditManagementProvider` + `ICollectionProvider` — فصل الائتمان عن التحصيل |
| `IUserProvider` — يمزج Auth مع User Management | `IIdentityProvider` + `IAuthorizationProvider` + `IAdministrationProvider` — فصل المسؤوليات |
| الـ Provider يعكس جداول DB | الـ Provider يعكس قدرة أعمال |
| لا定义了 Business Capabilities ownership | كل قدرة تملك Providers, Models, Rules, Services |
