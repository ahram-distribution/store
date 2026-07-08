# 26 – Presentation Architecture

**التصنيف:** مواصفة معمارية — طبقة العرض  
**الغرض:** توثيق عمارة طبقة Presentation ثنائية المسار — Mobile (PWA) و Desktop (Windows EXE)  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** مجمّدة — ✅ معتمدة  
**الـ ADR المرتبط:** ADR-009 (في 20_ARCHITECTURE_DECISIONS.md)

---

## 1. المبدأ الأساسي

**Business Logic is NOT duplicated.**

Application Layer, Domain Layer, Provider Layer, Infrastructure Layer — كلها **مشتركة** بين Mobile و Desktop.

فقط **Presentation Layer** تختلف:

- الصفحات (Pages) — مختلفة لأن UX مختلف
- التخطيطات (Layouts) — مختلفة لأن الشاشات مختلفة
- المكونات (Components) — بعضها مشترك (Buttons, Inputs) وبعضها خاص (BottomNav, DataGrid)
- التوجيه (Routing) — مختلف لأن أنماط التنقل مختلفة

**Business Behavior يبقى متطابقاً.** نفس Application Service، نفس DTO، نفس منطق الأعمال.

---

## 2. فلسفة Mobile UI (PWA)

### 2.1 لمن صمم؟

| المستخدم | الاستخدام الأساسي |
|----------|------------------|
| مندوب مبيعات | إنشاء طلبات، متابعة العملاء، عرض المنتجات |
| محصل | تسجيل دفعات، متابعة الأقساط |
| سائق | استلام الطلبات، تأكيد التسليم |
| مشرف ميداني | متابعة أداء الفريق، تقارير سريعة |

### 2.2 المبادئ

| المبدأ | الشرح |
|--------|-------|
| **Touch First** | كل العناصر بحجم مناسب للمس (48px minimum touch target) |
| **Thumb Zone** | العناصر المهمة في أسفل الشاشة (منطقة الإبهام) |
| **Single Column** | عرض رأسي — عمود واحد — لا multi-panel |
| **Bottom Navigation** | التنقل الرئيسي في الأسفل (Tabs) — 3-5 أقسام رئيسية |
| **Modal / Drawer** | المحتوى الثانوي في Modal أو Drawer (Side Sheet) |
| **Cards over Tables** | عرض البيانات كبطاقات وليس جداول — للقراءة السريعة |
| **Offline First** | تعمل بدون اتصال — IndexedDB + SW — مزامنة عند الاتصال |
| **Pull to Refresh** | التحديث بالسحب لأسفل |
| **Gesture Navigation** | سحب لحذف، سحب للرجوع، ضغط مطول لقوائم إضافية |
| **Minimal Typing** | مسح باركود، اختيار من قائمة، إكمال تلقائي — لا كتابة مطولة |

### 2.3 أنماط التنقل (Navigation Patterns)

| النمط | الاستخدام |
|-------|-----------|
| **Bottom Tab Bar** | الأقسام الرئيسية (الرئيسية، الطلبات، العملاء، الإعدادات) |
| **Stack Navigation** | التنقل داخل القسم (قائمة ← تفاصيل ← تعديل) |
| **Modal** | إجراءات سريعة (إضافة منتج، تأكيد طلب) |
| **Drawer (Side Sheet)** | فلاتر وخيارات متقدمة |
| **Swipe Back** | العودة إلى الشاشة السابقة (iOS native pattern) |

### 2.4 أحجام الشاشات المستهدفة

| الجهاز | العرض | ملاحظات |
|--------|-------|---------|
| الهواتف (Phone) | 360-428px | الهدف الأساسي |
| الأجهزة اللوحية (Tablet) | 600-1024px | دعم محدود — تصميم متجاوب أساسي |

### 2.5 أسلوب عرض البيانات

| نوع البيانات | طريقة العرض |
|-------------|-------------|
| قوائم (قائمة طلبات) | Cards مع معلومات أساسية + Badge للحالة |
| تفاصيل (تفاصيل طلب) | Vertical Sections + Summary at top |
| منتجات | Image + Name + Price — Grid (2 columns) أو List |
| إحصائيات | Large Number + Mini Chart / Progress Bar |
| تقارير | ملخصات — PDF للتفاصيل الكاملة |

### 2.6 Offline Behavior

| السيناريو | السلوك |
|-----------|--------|
| لا اتصال | عرض آخر البيانات المخزنة — تمييز بصري (غير محدّث) |
| إنشاء طلب بدون اتصال | تخزين في IndexedDB — مزامنة عند الاتصال |
| تسجيل GPS بدون اتصال | تخزين في Offline Queue — مزامنة عند الاتصال |
| تغيير البيانات بدون اتصال | Queue مع تعارض — حل تلقائي (آخر تعديل يفوز) |

---

## 3. فلسفة Desktop UI (Windows EXE)

### 3.1 لمن صمم؟

| المستخدم | الاستخدام الأساسي |
|----------|------------------|
| مدير عام | Dashboards, تقارير عامة, مؤشرات أداء |
| مدير مبيعات | مراجعة الطلبات، موافقات، تحليل أداء الفريق |
| مدير مخزن | إدارة المخزون، طلبات التحضير، AR |
| محاسب | إدارة الائتمان، المدفوعات، التقارير المالية |
| تنفيذي | إدارة النظام، المستخدمين، الإعدادات |

### 3.2 المبادئ

| المبدأ | الشرح |
|--------|-------|
| **Keyboard First** | اختصارات لوحة المفاتيح لكل عملية (Ctrl+N, Ctrl+S, F5) |
| **Large Screens** | تصميم لشاشات 1920×1080 كحد أدنى — دعم 1366×768 كحد أدنى |
| **Multi-panel** | تقسيم الشاشة إلى أقسام (Master-Detail، 3-panel) |
| **Data Grids** | جداول بيانات مع فرز، تصفية، تصدير (Excel, CSV, PDF) |
| **Context Menus** | قوائم يمين الفأرة (Right-click) لكل عنصر |
| **Drag & Drop** | سحب وإفلات للترتيب والنقل (إذا لزم) |
| **Search / Quick Find** | Ctrl+K للبحث السريع في كل مكان |
| **Bulk Operations** | اختيار متعدد + عملية مجمعة (حذف، تصدير، موافقة مجموعة) |
| **Split Windows** | فتح تقارير متعددة في نفس النافذة |
| **Print Friendly** | كل شاشة قابلة للطباعة — PDF Export |

### 3.3 أنماط التنقل (Navigation Patterns)

| النمط | الاستخدام |
|-------|-----------|
| **Left Sidebar Navigation** | الأقسام الرئيسية — أيقونة + اسم — Collapsible |
| **Top Bar** | Breadcrumb + Search + User Menu |
| **Tab Navigation (within page)** | أقسام داخل الصفحة (Tab Panel) |
| **Master-Detail Split** | قائمة في اليسار، تفاصيل في اليمين |
| **Modal Dialog** | إجراءات مركزة (إنشاء، تعديل، تأكيد) |
| **Floating Action** | للأوامر السريعة (FAB أو Toolbar) |

### 3.4 أحجام الشاشات المستهدفة

| الشاشة | الدقة | ملاحظات |
|--------|-------|---------|
| Desktop | 1920×1080 | الهدف الأساسي |
| Laptop | 1366×768 | الحد الأدنى المدعوم |
| Ultra-wide | 2560×1440+ | تحسين تلقائي (مساحة إضافية) |

### 3.5 أسلوب عرض البيانات

| نوع البيانات | طريقة العرض |
|-------------|-------------|
| قوائم طويلة | Data Grid — Virtual Scrolling — ترقيم صفحات — فرز — تصفية |
| تفاصيل كيان | Form Panel (Vertical/Horizontal) — أو Side Panel في Master-Detail |
| Dashboards | Widget Grid — Charts (Line, Bar, Pie) — KPI Cards |
| إحصائيات | Interactive Charts + Data Tables |
| تقارير | Report Viewer — تصدير (PDF, Excel, CSV) — طباعة |
| إدارة النظام | Form-heavy — Validation — Save/Cancel |

### 3.6 اختصارات لوحة المفاتيح

| الاختصار | العملية |
|----------|---------|
| Ctrl+N | إنشاء جديد |
| Ctrl+S | حفظ |
| F5 | تحديث / Refresh |
| Ctrl+F | بحث / Filter |
| Ctrl+K | Quick Search |
| Ctrl+E | تصدير (Excel) |
| Ctrl+P | طباعة |
| Delete | حذف (مع تأكيد) |
| Esc | إلغاء / إغلاق Modal |

---

## 4. Shared vs Client-Specific Components

### 4.1 Shared UI Components (`presentation/shared/components/`)

| المكون | ملاحظات |
|--------|---------|
| **Button** | مع أنماط أساسية (Primary, Secondary, Danger, Ghost) |
| **Input** | Text, Number, Phone, Password + Validation |
| **Select / Dropdown** | قائمة اختيار مع بحث |
| **Modal / Dialog** | نافذة تأكيد/إدخال |
| **Loading / Spinner** | مؤشر تحميل موحد |
| **Toast / Snackbar** | إشعارات مؤقتة |
| **Avatar** | صورة المستخدم (حروف بديلة عند عدم وجود صورة) |
| **Badge / Tag** | عرض الحالة (نشط، ملغي، الخ) |
| **Empty State** | عند عدم وجود بيانات |
| **Error State** | عند فشل التحميل |
| **Icon** | مجموعة أيقونات موحدة |

**السبب للمشاركة:** هذه المكونات لا تحمل منطق تنقل أو تخطيط — هي "ذرات" (Atomic Design Atoms).

### 4.2 Mobile-Specific Components (`presentation/mobile/components/`)

| المكون | الغرض |
|--------|-------|
| **BottomNavigation** | شريط التنقل السفلي |
| **PullToRefresh** | سحب للتحديث |
| **Card / CardList** | عرض البيانات كبطاقات |
| **SwipeableRow** | سحب للكشف عن أزرار إجراءات |
| **FloatingActionButton** | زر الإجراء السريع العائم |
| **SearchBar** | شريط بحث مع إلغاء |
| **CameraCapture** | مسح باركود / تصوير |
| **OfflineIndicator** | إشارة ظاهرية عند عدم الاتصال |
| **BottomSheet** | لوحة سفلية منزلقة (خيارات إضافية) |

### 4.3 Desktop-Specific Components (`presentation/desktop/components/`)

| المكون | الغرض |
|--------|-------|
| **DataGrid** | جدول بيانات تفاعلي (Sort, Filter, Paginate, Export) |
| **Sidebar** | القائمة الجانبية الرئيسية |
| **TopBar** | شريط العنوان + Breadcrumb |
| **TabPanel** | أقسام داخل الصفحة |
| **SplitPanel** | تقسيم الشاشة إلى جزئين (Master-Detail) |
| **ContextMenu** | قائمة يمين الفأرة |
| **Toolbar** | شريط أدوات (New, Save, Delete, Export) |
| **Breadcrumb** | مسار التنقل |
| **KeyboardShortcutProvider** | تسجيل الاختصارات |
| **Chart** | رسم بياني (Line, Bar, Pie) — مكتبة Chart.js / Recharts |
| **ReportViewer** | عارض تقارير (طباعة، تصدير) |

---

## 5. الـ Routing

### 5.1 Mobile Routing (HashRouter)

```text
HashRouter — للـ PWA (لا يحتاج Server Config)

/login
/register
/ ( حسب الهوية → Storefront / Dashboard)
/storefront
/storefront/products
/orders
/orders/:id
/orders/new
/customers
/customers/:id
/attendance
/attendance/runtime
/dashboard
/settings
...
```

### 5.2 Desktop Routing (BrowserRouter / MemoryRouter)

```text
BrowserRouter (Web) أو MemoryRouter (Electron)

/dashboard
/orders
/orders/:id
/orders/new
/customers
/customers/:id
/products
/products/:id
/reports
/reports/sales
/reports/attendance
/admin/users
/admin/settings
/credit
/credit/:customerId
...
```

### 5.3 الفروقات

| الجانب | Mobile | Desktop |
|--------|--------|---------|
| نوع Router | HashRouter | BrowserRouter / MemoryRouter |
| عدد المسارات | ~95 (كما هو حالياً) | ~70+ (بعض مسارات الموبايل غير مطلوبة) |
| المسارات الفريدة | Storefront, DailyDeals, FlashOffers, Auctions, Attendance Runtime | Reports, Admin, Advanced Filters |
| Guard mechanism | ProtectedRoute (مشترك — نفس الكود) | ProtectedRoute (مشترك) |

### 5.4 الـ Route Guards (مشترك)

نظام `ProtectedRoute` مع `useCapability` هو نفسه — مشترك بين Mobile و Desktop في `presentation/shared/`.

---

## 6. الـ Store (State Management)

### 6.1 Store مشترك (`presentation/shared/store/`)

| الـ Store | المحتوى |
|-----------|---------|
| `authStore` | الجلسة، الـ token، بيانات المستخدم، الأدوار |

### 6.2 Store خاص بالموبايل (`presentation/mobile/store/`)

| الـ Store | المحتوى |
|-----------|---------|
| `cartStore` | عربة التسوق (فقط مندوبي المبيعات يحتاجونها) |
| `offlineStore` | حالة الاتصال — Queue المعلقة |

### 6.3 Store خاص بالديسكتوب (`presentation/desktop/store/`)

| الـ Store | المحتوى |
|-----------|---------|
| `uiStore` | حالة الواجهة (أي Panel مفتوح، حجم النافذة، filter settings) |
| `reportStore` | إعدادات التقارير المؤقتة |

### 6.4 القاعدة

- **التخزين الدائم** → عبر Provider (قاعدة البيانات) — ليس عبر zustand
- **الحالة المؤقتة الخاصة بالـ UI** → zustand store الخاص بالمنصة
- **الجلسة والمستخدم** → مشترك (authStore) — لأنهما مطلوبان لـ Application Services

---

## 7. Responsive Policy

| العبارة | القيمة |
|---------|--------|
| **Responsive Design** | ❌ **ليس الهدف** |
| **Platform-specific UX** | ✅ **هو الهدف** |
| هل توجد شاشة واحدة للكل؟ | لا — Mobile و Desktop لهما Pages مختلفة |
| هل توجد مكونات مشتركة؟ | نعم — Atomic Components فقط (Buttons, Inputs, Icons) |
| ماذا عن Tablet؟ | محدود — Mobile PWA مع تحسينات أساسية |

**القاعدة:** إذا كانت الشاشة تحتاج logics مختلفة في UX — تُنشأ كـ Page مستقلة في كل منصة.  
لا تحاول تصميم صفحة "تشتغل في الكل" — هذا يؤدي إلى تجربة سيئة في كل مكان.

### مثال:

| الصفحة | Mobile | Desktop |
|--------|--------|---------|
| قائمة الطلبات | Card list + Bottom Sheet للفلاتر | Data Grid + Side Panel للفلاتر + تصدير |
| إنشاء طلب | Wizard خطوة بخطوة (Bottom Sheet) | Form متكامل في Panel واحد + Keyboard Shortcuts |
| تفاصيل العميل | بطاقة معلومات + قائمة الأوامر | Master-Detail + Credit Info + History |
| Dashboard | KPI Cards + Mini Charts (Vertical) | Widget Grid + Interactive Charts |

---

## 8. قواعد الشاشات المستقبلية (Rules for Future Screens)

| القاعدة | التفصيل |
|---------|---------|
| **PS-01** | كل شاشة جديدة تُحدد لمنصة (Mobile, Desktop, أو كلتاهما) |
| **PS-02** | إذا كانت الشاشة لمنصة واحدة فقط — توضع في مجلد تلك المنصة فقط |
| **PS-03** | إذا كانت الشاشة لكلا المنصتين — تُنشأ صفحة منفصلة في كل منصة (قد تختلف UX) |
| **PS-04** | لا يُشارك أي Page بين Mobile و Desktop — حتى لو كانت متطابقة (لمنع الانجراف) |
| **PS-05** | الـ Shared Components فقط هي المسموح بمشاركتها |
| **PS-06** | أي Hook جديد: إذا كان لـ React عام — يوضع في shared. إذا كان خاص بالمنصة — في مجلد المنصة |
| **PS-07** | لا يُستخدم `window.innerWidth` لتحديد "أنا في Mobile أو Desktop" — المنصة معروفة من ملف الدخول |
| **PS-08** | كل منصة لها `App.tsx` منفصل — `main.tsx` يختار أي App يشغّل بناءً على build target |

### PS-08 بالتفصيل — Build Target

```typescript
// main.tsx — نقطة الدخول الوحيدة (أو يتم اختيارها في build)
// PWA build: يشغّل presentation/mobile/App.tsx
// Desktop build: يشغّل presentation/desktop/App.tsx

const App = import.meta.env.VITE_PLATFORM === 'desktop'
  ? require('./presentation/desktop/App').default
  : require('./presentation/mobile/App').default
```

---

## 9. قواعد التبعية لطبقة Presentation

### 9.1 Mobile يمكنه استيراد

| مسموح | ممنوع |
|-------|-------|
| `presentation/shared/` | `presentation/desktop/` |
| `application/services/` | `providers/implementations/` |
| `application/dto/` | `lib/supabase.ts` (مباشر) |
| `domain/enums/` | `services/` (القديم) |
| `infrastructure/` (محدد: GPS, Tracking) | |

### 9.2 Desktop يمكنه استيراد

| مسموح | ممنوع |
|-------|-------|
| `presentation/shared/` | `presentation/mobile/` |
| `application/services/` | `providers/implementations/` |
| `application/dto/` | `lib/supabase.ts` (مباشر) |
| `domain/enums/` | `services/` (القديم) |
| `infrastructure/` (محدد: Logging, SW) | |

### 9.3 Shared يمكنه استيراد

| مسموح | ممنوع |
|-------|-------|
| `application/services/` | أي من `presentation/mobile/` أو `presentation/desktop/` |
| `application/dto/` | `providers/implementations/` |
| `domain/enums/` | |
| `domain/value-objects/` | |
| `utils/` | |

---

## 10. Application Services — واجهة موحدة لكلا المنصتين

```typescript
// نفس الـ Service — يُستخدم من Mobile و Desktop
const orderService = new OrderQueryService(orderProvider)

// Mobile
function MobileOrderListPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([])
  useEffect(() => {
    orderService.listOrders({ page: 1, pageSize: 20 })
      .then(result => setOrders(result.data))
  }, [])
  // عرض كبطاقات (Cards)
}

// Desktop
function DesktopOrderListPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([])
  useEffect(() => {
    orderService.listOrders({ page: 1, pageSize: 100 })
      .then(result => setOrders(result.data))
  }, [])
  // عرض كـ Data Grid مع Sort/Filter/Export
}
```

**Business behavior متطابق.** فقط Presentation يختلف.

---

## 11. الـ Deployment

| الخاصية | Mobile (PWA) | Desktop (Windows EXE) |
|---------|-------------|----------------------|
| **طريقة التوزيع** | Web Server (Vercel, Netlify) + PWA install | Electron / Tauri — Windows Installer |
| **نقطة الدخول** | `presentation/mobile/App.tsx` | `presentation/desktop/App.tsx` |
| **Router** | HashRouter | MemoryRouter |
| **Service Worker** | نعم — Offline + Background Sync | لا — اتصال مباشر |
| **Capacitor** | نعم — GPS, Camera, Push | لا — APIs سطح المكتب |
| **التخزين المحلي** | IndexedDB (offline queue) | SQLite (مستقبلاً) |
| **Updates** | PWA update on reload | Auto-updater (electron-updater) |
| **Print** | Print API (browser) | Full Printing API (Electron) |

---

## 12. الخلاصة

| البند | القيمة |
|-------|--------|
| Presentation مسارات | 2: Mobile (PWA) + Desktop (Windows EXE) |
| Business Logic | مشترك — لا تكرار |
| Application Services | مشتركة — نفس الـ API |
| Shared Components | Atomic level (Buttons, Inputs, Icons, Loading) |
| Platform Components | BottomNav, DataGrid — خاصة بالمنصة |
| Responsive Design | ❌ — Platform-specific UX هو الهدف |
| عدد القواعد (Rules) | 8 قواعد للشاشات المستقبلية |
| ADR | ADR-009 (في 20_ARCHITECTURE_DECISIONS.md) |
