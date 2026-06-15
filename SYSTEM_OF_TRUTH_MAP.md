# SYSTEM OF TRUTH MAP — خريطة المصدر الوحيد

> **التاريخ:** 2026-06-16  
> **الهدف:** المرجع الإلزامي الوحيد للمعمارية التشغيلية — كل وظيفة لها مسار واحد، خدمة واحدة، مصدر بيانات واحد

---

## المبدأ الأساسي

```
أي وظيفة في النظام = مسار واحد فقط + خدمة واحدة فقط + مصدر بيانات واحد فقط
```

---

## 1. GPS — النظام الوحيد

| العنصر | ACTIVE (المعتمد) | DEPRECATED (ممنوع) |
|--------|-----------------|-------------------|
| **الاستحواذ (Acquisition)** | `gpsEngine.acquire()` ← `gpsService.getCurrentLocation()` | أي استدعاء مباشر لـ `navigator.geolocation` خارج `gpsService.ts` |
| **المراقبة المستمرة (Watching)** | `gpsEngine.startWatching()` ← `gpsService.startWatching()` | `trackingEngine._startWatch` أو أي `watchPosition` مباشر |
| **الموقع الأخير** | `gpsEngine.getLastKnown()` ← `gpsService.getLastKnownLocation()` | تخزين الموقع في متغيرات محلية خارج gpsService |
| **حفظ نقاط GPS** | `locationService.saveLocation()` → `governed_create_location` RPC | كتابة GPS مباشرة في جداول `tracking_points` أو `sessions` |
| **Reverse Geocoding** | `locationService.reverseGeocode()` / `reverseGeocodeStructured()` | استدعاء Nominatim مباشر خارج location.ts |
| **خرائط Google** | `locationService.buildGoogleMapsUrl()` | بناء URL يدوي في كل صفحة |
| **التتبع المستمر** | `trackingEngine` (يستخدم `gpsService` داخلياً) | أي نسخة أخرى من tracking logic خارج `trackingEngine.ts` |

### الممنوعات (GPS)
- ❌ `navigator.geolocation.getCurrentPosition()` في أي page أو component
- ❌ `navigator.geolocation.watchPosition()` خارج gpsService.ts
- ❌ استيراد `getCurrentLocation` مباشرة من `gpsService.ts` (يجب عبر `gpsEngine`)
- ❌ تخزين GPS في `localStorage` يدوياً
- ❌ استدعاء `insert_gps_test_point` RPC من أي صفحة غير GpsTestPage

---

## 2. ORDERS — النظام الوحيد

| العملية | ACTIVE RPC (المعتمد) | DEPRECATED (ممنوع) |
|---------|---------------------|-------------------|
| **إنشاء طلب** | `governed_create_order` | أي `supabase.from('orders').insert(...)` |
| **قراءة طلب** | `governed_get_order` | أي `supabase.from('orders').select(...)` |
| **قائمة طلبات** | `get_governed_orders` | أي `supabase.from('orders').select(...)` |
| **إرسال طلب** | `governed_submit_order` | تحديث `orders.status` مباشرة |
| **اعتماد طلب** | `governed_approve_order` | تحديث `orders.status` مباشرة |
| **تغيير حالة** | `governed_change_order_status` | تحديث `orders.status` مباشرة |
| **عناصر الطلب** | `get_governed_order_items` | أي `supabase.from('order_items').select(...)` |
| **إنشاء طلب (2)** | `governed_create_order` | أي RPC غير محكوم |

### الممنوعات (Orders)
- ❌ أي `supabase.from('orders')` مباشر
- ❌ أي `supabase.from('order_items')` مباشر
- ❌ أي تغيير لحالة الطلب بدون المرور بـ `governed_*` RPCs
- ❌ استخدام `order_flow_v2.py` أو `runtime_order_flow.py` (scripts تحليل فقط)

---

## 3. CUSTOMERS — النظام الوحيد

| العملية | ACTIVE RPC (المعتمد) | DEPRECATED (ممنوع) |
|---------|---------------------|-------------------|
| **إنشاء عميل** | `governed_create_customer` أو `register_customer` (للتسجيل الذاتي) | أي `supabase.from('customers').insert(...)` |
| **تحديث عميل** | `governed_update_customer` | أي `supabase.from('customers').update(...)` |
| **قراءة عميل** | `get_governed_customer` | أي `supabase.from('customers').select(...)` |
| **قائمة عملاء** | `get_governed_customers` | أي `supabase.from('customers').select(...)` |
| **عناوين العملاء** | `get_governed_customer_addresses` (RPC) | أي `supabase.from('customer_addresses').select(...)` |
| **جهات اتصال** | `get_governed_customer_contacts` (RPC) | أي `supabase.from('customer_contacts').select(...)` |
| **حفظ عنوان** | `governed_create_location` → `unified_locations` | أي كتابة في `customer_addresses` |

### الممنوعات (Customers)
- ❌ أي `supabase.from('customers')` مباشر
- ❌ أي `supabase.from('customer_addresses')` مباشر
- ❌ أي `supabase.from('customer_contacts')` مباشر
- ❌ الكتابة في `customer_addresses` — استخدم `unified_locations`

---

## 4. WHATSAPP — النظام الوحيد

| العنصر | ACTIVE (المعتمد) | DEPRECATED (ممنوع) |
|--------|-----------------|-------------------|
| **إرسال رسالة** | `sendWhatsAppFromDisplay(display)` | أي استدعاء آخر لإرسال WhatsApp |
| **نسخ رسالة** | `copyWhatsAppFromDisplay(display)` | أي تنفيذ آخر للنسخ |
| **بناء الرسالة** | `buildWhatsAppMessageFromDisplay(display)` | أي بناء رسالة يدوي |
| **البروتوكول** | `https://wa.me/{number}?text={encoded}` | أي `whatsapp://` أو `window.location.href` مباشر |
| **مصدر البيانات** | `OrderDisplayData` (من `buildOrderDisplay()`) | أي مصدر بيانات آخر (مثل raw order rows) |

### الممنوعات (WhatsApp)
- ❌ استخدام `whatsapp://` protocol
- ❌ استخدام `window.location.href` لإرسال WhatsApp
- ❌ بناء رسالة WhatsApp خارج `whatsapp.ts`
- ❌ استيراد `buildWhatsAppMessageFromDisplay` مباشرة (يجب عبر `sendWhatsAppFromDisplay`)

---

## 5. AUTH — النظام الوحيد

| العملية | ACTIVE (المعتمد) | DEPRECATED (ممنوع) |
|---------|-----------------|-------------------|
| **تسجيل الدخول** | `api.login(p_token)` عبر `authService.login()` | أي `supabase.from('identities')` مباشر |
| **تسجيل خروج** | `api.logout(p_token)` عبر `authService.logout()` | أي حذف session مباشر |
| **التحقق من الجلسة** | `api.validate_session(p_token)` عبر `authService.validateSession()` | أي قراءة مباشرة من `app.sessions` |
| **صلاحية (Capability)** | `check_capability(p_token, p_capability)` | أي فحص صلاحية يدوي (hardcoded) |

---

## 6. ATTENDANCE — النظام الوحيد

| العملية | ACTIVE RPC (المعتمد) | DEPRECATED (ممنوع) |
|---------|---------------------|-------------------|
| **بدء يوم عمل** | `start_workday(p_token)` | أي كتابة في `workday_sessions` مباشرة |
| **إنهاء يوم عمل** | `end_workday(p_token)` | أي كتابة مباشرة |
| **بدء استراحة** | `start_break(p_token)` | أي كتابة مباشرة |
| **إنهاء استراحة** | `end_break(p_token)` | أي كتابة مباشرة |
| **حالة يوم العمل** | `get_my_workday_status(p_token)` | أي استعلام مباشر لـ `workday_sessions` |
| **خريطة اليوم** | `get_employee_day_map(p_token, empId, date)` | أي استعلام مباشر لـ `tracking_points` |
| **التتبع المستمر** | `trackingEngine` (يستخدم `gpsService` داخلياً) | أي tracking logic مكرر |

---

## 7. DASHBOARD & REPORTS — النظام الوحيد

| اللوحة | ACTIVE (المعتمد) |
|--------|-----------------|
| **الإدارة العليا** | `UpperManagementDashboard` + `get_upper_management_dashboard` RPC |
| **مدير بيع** | `SalesManagerCCPage` + `get_sales_manager_cc` RPC |
| **مندوب مبيعات** | `SalesRepWorkDay` + `get_my_workday_status` RPC |
| **مدير مخزن** | `WarehouseManagerWorkspace` + `get_dashboard_warehouse` RPC |
| **التقارير** | `ReportsPage` + 9 `get_*_report` RPCs |

---

## 8. خريطة التبعيات (Dependency Map)

```
gpsEngine (الوحيد للاستحواذ)
  └── gpsService.ts (التنفيذ الفعلي)
       ├── getCurrentLocation()
       ├── startWatching() / stopWatching()
       └── getLastKnownLocation()

locationService
  ├── saveLocation() → governed_create_location RPC
  ├── reverseGeocode() → Nominatim API
  ├── fetchLocation() → get_governed_location RPC
  └── buildGoogleMapsUrl()

trackingEngine
  └── يستخدم gpsService.startWatching() + gpsService.getLastKnownLocation()
  └── يخزن في tracking_points عبر sync_tracking_points RPC

whatsapp.ts
  └── sendWhatsAppFromDisplay() → wa.me protocol
  └── يستخدم OrderDisplayData فقط

governed_* RPCs (الوحيد للوصول للبيانات)
  ├── orders: governed_create_order, get_governed_orders, governed_submit_order
  ├── customers: governed_create_customer, get_governed_customers, governed_update_customer
  └── employees: governed_create_employee, get_governed_employees
```

---

## 9. قواعد التطوير المستقبلية

1. **أي وظيفة جديدة** يجب أن تمر عبر RPC محكوم (governed RPC) — ممنوع `supabase.from()` مباشر
2. **أي استحواذ GPS** يجب أن يستخدم `gpsEngine.acquire()` — ممنوع `navigator.geolocation` مباشر
3. **أي إرسال WhatsApp** يجب أن يستخدم `sendWhatsAppFromDisplay()` — ممنوع `whatsapp://`
4. **أي استعلام orders** يجب أن يستخدم `get_governed_orders` — ممنوع `supabase.from('orders')`
5. **أي استعلام customers** يجب أن يستخدم `get_governed_customers` — ممنوع `supabase.from('customers')`

---

*تاريخ الإنشاء: 2026-06-16*  
*المرجع: ACTIVE_RPC_CATALOG.md، ACTIVE_RUNTIME_ONLY.md، REGRESSION_GUARD.md*
