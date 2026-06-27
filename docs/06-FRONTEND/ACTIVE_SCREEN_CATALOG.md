# ACTIVE SCREEN CATALOG — حصر الشاشات الفعلية

> **التاريخ:** 2026-10-03 (مُحدّث)  
> **الهدف:** تصنيف كل شاشة في النظام حسب إمكانية الوصول إليها فعلياً  
> **ملاحظة**: هيكل الـ Frontend العام موثق في `SYSTEM_REFERENCE_CURRENT_STATE.md` Section 5. هذه الوثيقة تركز على كتالوج الشاشات الكامل مع تصنيف الوصول.

---

## طريقة التصنيف

1. **ACTIVE** — يمكن الوصول إليها عبر: BottomNav, TopBar, Launcher, Dashboard, Menu, Button, FAB, Search
2. **DEAD** — مسار موجود في `routes/index.tsx` لكن لا يوجد رابط يؤدي إليه
3. **DUPLICATE** — شاشتان أو أكثر تؤدي نفس الوظيفة
4. **LEGACY** — شاشة قديمة لها بديل أحدث

---

## التصنيف الكامل

### 1. ACTIVE — يمكن الوصول إليها فعلياً

#### من BottomNav (للموظف)

| المسار | المكون | المصدر |
|--------|--------|--------|
| `/dashboard` | DashboardPage | BottomNav "الرئيسية" |
| `/storefront` | CompaniesPage | BottomNav "المتجر" |
| `/orders` | OrdersPage | BottomNav "الطلبات" |
| `/visits` | VisitsPage | BottomNav "الزيارات" |
| `/products` | ProductsPage | BottomNav "المزيد" |

#### من BottomNav (للعميل)

| المسار | المكون | المصدر |
|--------|--------|--------|
| `/storefront` | CompaniesPage | BottomNav "المتجر" |
| `/orders` | OrdersPage | BottomNav "الطلبات" |
| `/account` | AccountPage | BottomNav "حسابي" |

#### من ModuleLauncherPage (للموظف)

| المسار | المكون | المصدر (رابط في الـ Launcher) |
|--------|--------|-------------------------------|
| `/orders` | OrdersPage | كل الطلبات |
| `/orders/new` | OrderNewPage | إنشاء طلب |
| `/orders/approval-queue` | ApprovalQueuePage | متابعة الطلبات |
| `/orders?my=1` | OrdersPage (مصفى) | طلباتي |
| `/orders?my_invoices=1` | OrdersPage (مصفى) | فواتيري |
| `/delivery` | DeliveryPage | التسليم |
| `/returns` | ReturnsPage | المرتجعات |
| `/warehouse` | WarehousePage | تجهيز المخزن |
| `/visits/new` | NewVisitPage | زيارة جديدة |
| `/visits?filter=active` | VisitsPage (مصفى) | بدء زيارة |
| `/dashboard/employee-analysis` | EmployeeAnalysisPage | تحليل الزيارات |
| `/customers` | CustomersPage | كل العملاء |
| `/customers/new` | NewCustomerPage | عميل جديد |
| `/customers?my=1` | CustomersPage (مصفى) | عملائي |
| `/credit` | CustomerCreditPage | الائتمان |
| `/analytics/customers` | AnalyticsListPage | تقارير العملاء |
| `/employees` | EmployeeManagementPage | كل الموظفين |
| `/employees?role=مندوب` | EmployeeManagementPage (مصفى) | المناديب |
| `/employees?role=مشرف` | EmployeeManagementPage (مصفى) | المشرفين |
| `/hierarchy` | HierarchyPage | الهيكل البيعي |
| `/employees#roles` | RolesTab | الأدوار |
| `/employees#permissions` | PermissionsTab | الصلاحيات |
| `/employees#targets` | TargetsWeightsTab | الأهداف والأوزان |
| `/account/permissions` | UserPermissionsPage | صلاحياتي |
| `/account/profile` | UserProfilePage | بياناتي |
| `/products?add=1` | ProductsPage (مصفى) | إضافة منتج |
| `/products/manage` | ProductManagerPage | تعديل منتج |
| `/companies` | MgmtCompaniesPage | الشركات |
| `/companies?add=1` | MgmtCompaniesPage (مصفى) | إضافة شركة |
| `/companies/manage` | CompanyManagerPage | تعديل شركة |
| `/warehouse/review` | WarehouseReviewPage | مراجعة المخزون |
| `/deals` | DealsPage | العروض |
| `/daily-deals/manage` | DailyDealsManagementPage | العروض اليومية |
| `/flash-offers/manage` | FlashOffersManagementPage | عروض الفلاش |
| `/tiers/manage` | TiersManagerPage | إدارة الشرائح |
| `/auctions/manage` | AuctionsManagerPage | إدارة المزادات |
| `/attendance` | AttendanceRouter (redirector) | الحضور والانصراف |
| `/reports` | ReportsPage | التقارير |
| `/dashboard/performance` | PerformanceAnalysisPage | تحليل الأداء |
| `/dashboard/company-targets` | CompanyTargetsPage | أهداف الشركة |
| `/dashboard/employee-targets` | EmployeeTargetsPage | أهداف الموظفين |
| `/activity` | ActivityPage | النشاط الموحد |
| `/credit/programs/manage` | CreditProgramsManagerPage | إدارة برامج الائتمان |
| `/credit/manage` | CreditManagementPage | تقارير الائتمان |
| `/settings/company` | CompanyProfilePage | إعدادات الشركة |
| `/sales-manager-cc` | SalesManagerCCPage | مركز قيادة المبيعات |
| `/command-center` | CommandCenterPage | مركز القيادة |

#### من TopBar

| المسار | المكون | المصدر |
|--------|--------|--------|
| `/storefront` | CompaniesPage | زر "المتجر" |
| `/dashboard` | DashboardPage | زر "لوحة التحكم" |

#### من AppLayout (FABs)

| المسار | المكون | المصدر |
|--------|--------|--------|
| `/orders/new?customer={id}` | OrderNewPage | Cart FAB |
| `/visits/{id}` | VisitDetailPage | Active Visit FAB |

#### من GlobalSearch

| المسار | المكون | المصدر |
|--------|--------|--------|
| `/customers/{id}` | CustomerProfilePage | بحث |
| `/products` | ProductsPage | بحث |
| (ديناميكي) `r.path` | (متنوع) | بحث |

#### من CommandCenterPage

| المسار | المكون | المصدر |
|--------|--------|--------|
| `/command-center/modules/{key}` | ModuleWorkspacePage | لوحة القيادة |
| `/dashboard/company-targets` | CompanyTargetsPage | (مكرر) |
| `/account/permissions` | UserPermissionsPage | (مكرر) |
| `/auctions` | AuctionsPage | (مكرر) |
| `/daily-deals` | DailyDealsPage | (مكرر) |
| `/flash-offers` | FlashOffersPage | (مكرر) |
| `/tiers` | TierSystemPage | (مكرر) |
| `/companies` | MgmtCompaniesPage | (مكرر) |
| `/deals` | DealsPage | (مكرر) |
| `/products` | ProductsPage | (مكرر) |
| `/attendance/operations` | OperationsCenterPage | مركز القيادة |
| `/launcher/orders` | ModuleLauncherPage | المركز التقني |
| `/launcher/customers` | ModuleLauncherPage | المركز التقني |
| `/launcher/visits` | ModuleLauncherPage | المركز التقني |
| `/launcher/employees` | ModuleLauncherPage | المركز التقني |
| `/launcher/reports` | ModuleLauncherPage | المركز التقني |

#### من SalesManagerCCPage

| المسار | المكون | المصدر |
|--------|--------|--------|
| `/attendance/operations` | OperationsCenterPage | تبويب الحضور |
| `/attendance/runtime` | AttendanceRuntimePage | إجراءات سريعة |
| `/orders/approval-queue` | ApprovalQueuePage | اعتماد الطلبات |
| `/employees/{id}` | EmployeeProfilePage | أعضاء الفريق |
| `/employees` | EmployeeManagementPage | الموظفون |
| `/hierarchy` | HierarchyPage | الهيكل البيعي |
| `/collections` | CollectionsPage | التحصيلات |
| `/dashboard/employee-targets` | EmployeeTargetsPage | أهداف الفريق |
| `/collections?filter=pending` | CollectionsPage (مصفى) | تحصيلات معلقة |
| `/visits?filter=active` | VisitsPage (مصفى) | زيارة نشطة |
| `/orders?my=1` | OrdersPage (مصفى) | طلباتي |

#### من DashboardPage (حسب الدور)

| المسار | المكون | الدور المطلوب |
|--------|--------|---------------|
| `—` (inline) | UpperManagementDashboard | الإدارة العليا |
| `—` (inline) | SalesManagerCCPage | مدير بيع |
| `—` (inline) | SalesRepWorkDay | مندوب مبيعات |
| `—` (inline) | WarehouseManagerWorkspace | مدير مخزن |
| `—` (inline) | ManagementDashboard | سيلز داخلي و fallback |
| `—` (inline) | WarehouseDashboard | رمز WRQ1001 |

#### من ExecutiveOperationsWorkspace

| المسار | المكون | المصدر |
|--------|--------|--------|
| `/warehouse/review` | WarehouseReviewPage | مراجعة المخزون |
| `/warehouse/preparation/{id}` | WarehousePrepDetail | تفاصيل التجهيز |
| `/orders/{id}` | OrderDetailPage | تفاصيل الطلب |
| `/orders/{id}/edit` | OrderEditPage | تعديل الطلب |
| `/returns/{id}` | ReturnDetailPage | تفاصيل المرتجع |
| `/collections?filter=pending` | CollectionsPage (مصفى) | تحصيلات معلقة |

#### من CreditReviewPage

| المسار | المكون | المصدر |
|--------|--------|--------|
| `/credit/applications/{id}` | CreditReviewPage | مراجعة الائتمان |

#### من ModuleLauncherPage (إضافي)

| المسار | المكون | المصدر |
|--------|--------|--------|
| `/executive-workspace` | ExecutiveOperationsWorkspace | مركز العمليات التنفيذية |
| `/data-deletion` | DataDeletionPage | مركز حذف البيانات |
| `/credit` | CustomerCreditPage | إدارة الائتمان |
| `/credit/programs` | CreditProgramsPage | برامج الائتمان |
| `/auctions/manage` | AuctionsManagerPage | إدارة المزادات |
| `/daily-deals/manage` | DailyDealsManagementPage | العروض اليومية |
| `/flash-offers/manage` | FlashOffersManagementPage | عروض الفلاش |
| `/tiers/manage` | TiersManagerPage | إدارة الشرائح |
| `/companies/manage` | CompanyManagerPage | إدارة الشركات |
| `/products/manage` | ProductManagerPage | إدارة المنتجات |
| `/employees/{id}` | EmployeeProfilePage | ملف الموظف |
| `/customers/{id}` | CustomerProfilePage | ملف العميل |
| `/attendance/settings` | AttendanceSettingsPage | إعدادات الحضور |
| `/attendance/employees` | EmployeeManagementPage | إدارة الموظفين |

#### مسارات إضافية

| المسار | المكون | المصدر |
| `/login` | LoginPage | إعادة توجيه عند عدم التوثيق |
| `/register` | RegistrationPage | رابط في LoginPage (عادة) |
| `/checkout` | CheckoutPage | زر "إتمام الطلب" في Cart |
| `/order-review` | OrderReviewPage | بعد إضافة المنتجات للسلة |
| `/order-success` | OrderSuccessPage | بعد نجاح الطلب |
| `/cart` | CartPage | زر السلة في المتجر |
| `/daily-deals` | DailyDealsPage | المتجر (شريط العروض) |
| `/daily-deals/{id}` | DailyDealDetailPage | المتجر |
| `/flash-offers` | FlashOffersPage | المتجر |
| `/flash-offers/{id}` | FlashOfferDetailPage | المتجر |
| `/tiers` | TierSystemPage | المتجر |
| `/auctions` | AuctionsPage | المتجر |
| `/auctions/{id}` | AuctionDetailPage | المتجر |
| `/storefront/products` | StorefrontPage | المتجر (المنتجات) |
| `/products/{id}` | ProductProfilePage | من بطاقة المنتج (عادة) |
| `/companies/{id}` | CompanyProfilePage | من قائمة الشركات (عادة) |
| `/orders/{id}` | OrderDetailPage | من قائمة الطلبات |
| `/orders/{id}/edit` | OrderEditPage | من تفاصيل الطلب |
| `/customers/{id}` | CustomerProfilePage | من قائمة العملاء |
| `/customers/{id}/analytics` | CustomerAnalyticsPage | من ملف العميل |
| `/visits/{id}` | VisitDetailPage | من قائمة الزيارات |
| `/visits/screen` | VisitScreen | بعد بدء زيارة جديدة |
| `/returns/new` | ReturnNewPage | من قائمة المرتجعات |
| `/returns/{id}` | ReturnDetailPage | من قائمة المرتجعات |
| `/collections/new` | NewCollectionPage | من قائمة التحصيلات |
| `/collections/followup` | CollectionFollowupPage | من المتابعة (عادة) |
| `/delivery/{id}` | DeliveryDetailPage | من قائمة التوصيل |
| `/warehouse/prep/{id}` | WarehousePrepDetail | من المخزن |
| `/credit/programs` | CreditProgramsPage | من إدارة الائتمان |
| `/credit/applications` | CreditApplicationsPage | من الائتمان |
| `/credit/applications/{id}` | CreditReviewPage | من الطلبات |
| `/attendance/runtime` | AttendanceRuntimePage | AttendanceRouter (للموظفين) |
| `/attendance/operations` | OperationsCenterPage | AttendanceRouter (للإدارة) |
| `/attendance/settings` | AttendanceSettingsPage | من الإعدادات |
| `/attendance/team-map` | TeamMapPage | من لوحة الحضور |
| `/attendance/employee/{empId}/{date}` | EmployeeWorkdayDetailPage | من تقارير الحضور |
| `/command-center/modules/{moduleKey}` | ModuleWorkspacePage | من مركز القيادة |
| `/launcher/{module}` | ModuleLauncherPage | من مركز القيادة |
| `/ops/gps-test` | GpsTestPage | — (يتطلب الإدارة العليا) |

---

### 2. DEAD — لا يمكن الوصول إليها

بناءً على التحليل الكامل لجميع طرق التنقل (BottomNav, TopBar, 10 Launchers, FABs, Search، الأزرار الداخلية)، **لا توجد أي شاشة مصنفة DEAD**. جميع المسارات الـ 82 يمكن الوصول إليها من خلال رابط أو زر أو إعادة توجيه.

**ملاحظة:** بعض الشاشات غير قابلة للوصول ليس لعدم وجود رابط، بل لأن الدور المطلوب غير موجود في قاعدة البيانات (تصنف تحت LEGACY).

---

### 3. DUPLICATE — شاشات متكررة

| الشاشتان | المشكلة | التوصية |
|----------|---------|---------|
| `CompaniesPage` (`/storefront`) vs `MgmtCompaniesPage` (`/companies`) | اسم واحد لمكونين مختلفين تماماً | إعادة تسمية أحدهما |
| `SalesManagerCCPage` vs `CommandCenterPage` | تداخل في الوظائف (كلاهما لوحات قيادة) | مراجعة للدمج |
| `DailyDealsPage` (`/daily-deals`) vs `DealsPage` (`/deals`) | DealsPage مجرد wrap لـ DailyDealsService | دمج أو إزالة DealsPage |
| `AttendanceRouter` + `AttendanceRuntimePage` + `AttendanceSettingsPage` + `OperationsCenterPage` | 4 مسارات للحضور في router واحد | منطقي — إبقاء |
| `ModuleLauncherPage` + `SubLauncherPage` + `CommandCenterPage` | 3 طرق مختلفة لنفس البوابة | مراجعة للتبسيط |
| `public/manifest.webmanifest` + `public/pwa/manifest.json` | ملفا PWA manifest | توحيد في ملف واحد |

---

### 4. LEGACY — شاشات قديمة

| الشاشة | البديل الأحدث | ملاحظة |
|--------|---------------|--------|
| `AdminWorkspace` | UpperManagementDashboard | دور "أدمن" لم يعد يُمنح |
| `SuperAdminWorkspace` | UpperManagementDashboard | دور "سوبر أدمن" لم يعد يُمنح |
| `ChairmanWorkspace` | UpperManagementDashboard | دور "رئيس مجلس الإدارة" لم يعد يُمنح |
| `AccountantWorkspace` | ManagementDashboard | دور "محاسب" غير موجود في DB |
| `CollectorWorkspace` | ManagementDashboard | دور "محصل" غير موجود في DB |
| `SecurityWorkspace` | ManagementDashboard | دور "أمن" غير موجود في DB |
| `BuffetWorkspace` | ManagementDashboard | دور "بوفيه" غير موجود في DB |
| `DataEntryWorkspace` | ManagementDashboard | دور "مدخل بيانات" غير موجود في DB |
| `SecretaryWorkspace` | ManagementDashboard | دور "سكرتير" غير موجود في DB |
| `PurchasingManagerWorkspace` | ManagementDashboard | دور "مدير مشتريات" غير موجود في DB |
| `DeliveryWorkspace` | WarehouseDashboard | دور "توصيل" غير موجود في DB |
| `TransportDashboard` | WarehouseDashboard | دور قديم — مستبدل |
| `WarehouseDashboard` | WarehouseManagerWorkspace | كود WRQ1001 فقط — قديم |

**ملاحظة مهمة:** هذه الشاشات الـ 13 موجودة في الكود بروابط في `DashboardPage.tsx` لكن الأدوار المرتبطة بها **غير ممنوحة لأي موظف فعلي**. لذلك لا يمكن الوصول إليها أثناء التشغيل الحقيقي.

ومع ذلك، **لا يزال بإمكان المستخدم الوصول إلى الإدارة العليا** ← `UpperManagementDashboard`، و**مدير بيع** ← `SalesManagerCCPage`، و**مندوب** ← `SalesRepWorkDay`.

---

## عدد الشاشات حسب التصنيف

| التصنيف | العدد |
|---------|-------|
| **ACTIVE** (يمكن الوصول إليها) | 69 مساراً فريداً |
| **DUPLICATE** (مكررة) | 5-7 حالات |
| **LEGACY** (قديمة، أدوار غير موجودة) | 13 Workspace |
| **DEAD** (لا يمكن الوصول إليها) | 0 |
| **المجموع الكلي للمسارات** | 82 |
