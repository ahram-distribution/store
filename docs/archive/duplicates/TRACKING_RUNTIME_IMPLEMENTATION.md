# Tracking Runtime — Design & Implementation Plan

## 1. Architecture Overview — محرك التتبع

```
┌──────────────────────────────────────────────────────────────────────┐
│                         TrackingEngine                              │
│  (Singleton — src/services/trackingEngine.ts)                        │
│                                                                      │
│  ┌──────────┐   ┌────────────┐   ┌────────────────┐                 │
│  │  GPS      │   │  Queue     │   │  Sync Scheduler │                │
│  │  Capturer │──▶│ (IndexedDB)│──▶│ (setInterval)   │                │
│  └──────────┘   └────────────┘   └────────┬───────┘                 │
│        │              ▲                   │                          │
│        │              │                   │                          │
│  ┌─────┴──────────────┴─────┐             │ sync_tracking_points     │
│  │  Background Sync Handler │◀────────────┘ (POST RPC)              │
│  │  (Page Visibility API)   │                                        │
│  └──────────────────────────┘                                        │
└──────────────────────────────────────────────────────────────────────┘
```

**TrackingEngine** هو محرك وحيد (Singleton) يدير دورة حياة التتبع الكاملة.

---

## 2. Lifecycle — التشغيل بعد Start Workday

### 2.1. الربط

```
AttendancePage.tsx
  ├── handleAction('start') → start_workday RPC → trackingEngine.start()
  ├── handleAction('end')   → end_workday RPC   → trackingEngine.stop()
  └── useEffect() → fetchStatus() → if status === 'active'
        → trackingEngine.restore({ sessionId, intervalSeconds })
```

### 2.2. start()

```typescript
trackingEngine.start({
  sessionId: string,
  token: string,
  intervalSeconds: number,  // من get_workday_settings
  trackingMode: 'OFF' | 'VISITS_ONLY' | 'WORKDAY' | 'WORKDAY_PLUS_VISITS',
})
```

1. حفظ `sessionId`, `token`, `intervalSeconds` في الذاكرة و localStorage
2. فتح IndexedDB
3. محاولة إرسال نقاط عالقة من جلسة سابقة
4. بدء `setInterval(tick, intervalMs)`
5. التقاط أول نقطة فوراً

### 2.3. restore() — التعافي

عند mount أي صفحة Attendance أو عند إعادة تحميل PWA:
- `get_my_workday_status` → إذا كان `active`:
  - اقرأ `intervalSeconds` من `get_workday_settings`
  - أعد تشغيل `setInterval`
  - `flush()` فوراً لتفريغ أي نقاط في IndexedDB

---

## 3. الـ Interval — احترام location_interval_seconds

### 3.1. القراءة

تُقرأ مرة واحدة عند `start()` من `get_workday_settings`:
- `intervalMs = intervalSeconds * 1000`
- القيم المسموحة: 120, 300, 600, 900, 1800, 3600 ثانية

### 3.2. كل tick

```
1. تخطي إن كان tracking_mode = 'OFF'
2. captureLocation() — من location.ts الموجود
3. حفظ النقطة في IndexedDB (دائماً)
4. flush() — محاولة إرسال كل النقاط المعلقة
```

### 3.3. مرونة

الإدارة تغير `location_interval_seconds` من `AttendanceSettingsPage`. اليوم التالي يستخدم القيمة الجديدة.

---

## 4. المكونات

### 4.1. `setInterval` وليس `watchPosition`

| البديل | القرار | السبب |
|--------|--------|-------|
| `setInterval` | **نعم** | بسيط، متوقع، منخفض التكلفة |
| `watchPosition` | **لا** | يبقي GPS نشطاً → استنزاف البطارية |
| `getCurrentPosition` مع `setInterval` | **نعم** | شريحة GPS خاملة بين التكتات |

`_runPhase` في `location.ts` يستخدم `watchPosition` لالتقاط سريع (8-18 ثانية) — مناسب لالتقاط النقطة، وليس للتتبع المستمر.

### 4.2. IndexedDB للـ Queue

| السيناريو | IndexedDB | localStorage | Memory |
|-----------|-----------|--------------|--------|
| إغلاق التطبيق | ✅ يحتفظ | ✅ يحتفظ | ❌ يفقد |
| مساحة | غير محدودة | 5MB حد | محدودة |
| سرعة كتابة | سريع | بطيء مع الكميات | سريع |
| هيكل | Object Store | String فقط | مؤقت |

**الهيكل:**

```typescript
interface QueuedPoint {
  id: string, sessionId: string, token: string,
  latitude: number, longitude: number,
  accuracyMeters: number | null, altitudeMeters: number | null,
  speedMps: number | null, headingDegrees: number | null,
  batteryPct: number | null,
  recordedAt: string, pointType: string,
  retries: number, createdAt: string
}
```

Indexes: `sessionId`, `retries`.

### 4.3. Background Sync — مؤجل

PWA يستخدم `generateSW` → لا يمكن إضافة custom service worker حالياً. `visibilitychange` + `online/offline` events يغطيان معظم الحالات.

### 4.4. Page Visibility API

```typescript
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') trackingEngine.flush()
})
```

---

## 5. ماذا يحدث عندما...

| السيناريو | السلوك |
|-----------|--------|
| **انقطع الإنترنت** | النقاط تتراكم في IndexedDB. كل tick يحاول `flush()` ويفشل. 3 فشل → ينتظر `online` event. |
| **أُغلق التطبيق** | IndexedDB يحتفظ بكل النقاط. عند إعادة الفتح: `restore()` ← `flush()` فوراً. |
| **قفل الشاشة** | `visibilitychange → hidden`. المتصفح يخفف الـ interval. عند فتح القفل: `flush()` يرسل المتراكمات. |
| **عاد الاتصال** | `window 'online'` → `flush()` فوراً → إرسال كل النقاط المتراكمة دفعة واحدة. |

---

## 6. استدعاء sync_tracking_points

### 6.1. إضافة `attendanceService.syncTrackingPoints()`

```typescript
async syncTrackingPoints(sessionId: string, points: QueuedPoint[]) {
  return supabase.rpc('sync_tracking_points', {
    p_token: getToken(),
    p_session_id: sessionId,
    p_points: points.map(p => ({ /* latitude, longitude, ... */ })),
  })
}
```

### 6.2. دالة `flush()`

```
1. getAll() من IndexedDB
2. تجميع في دفعات (MAX_BATCH_SIZE = 20)
3. لكل دفعة: POST sync_tracking_points
4. نجاح → remove من IndexedDB
5. فشل → incrementRetries
6. retries > 10 → تجاهل النقطة
```

### 6.3. توقيت الاستدعاء

| الموقف | استدعاء |
|--------|---------|
| كل tick (كل intervalSeconds) | `flush()` |
| visibilitychange → visible | `flush()` فوراً |
| online event | `flush()` فوراً |
| restore() | `flush()` فوراً |
| stop() | `flush()` → إرسال آخر ما تبقى |

---

## 7. حجم البيانات

```
interval = 300 ثانية (5 دقائق)
يوم عمل = 9 ساعات → ~108 نقطة → ~30 كيلوبايت/يوم
أسوأ حالة (انقطاع ساعتين) → 24 نقطة → طلبين (batch=20)
```

---

## 8. حساب Connected / Delayed / Lost

لا يتغير SQL — فقط يصبح ذا معنى.

| الحالة | الشرط | المعنى الحقيقي بعد المحرك |
|--------|-------|--------------------------|
| `connected` | `last_seen < 5 min` | المحرك يعمل، الإنترنت متصل |
| `delayed` | `5 min < last_seen < 25 min` | انقطاع إنترنت مؤقت أو تخفيف متصفح |
| `lost` | `last_seen > 25 min` | المحرك توقف أو أُغلق التطبيق |
| `no_data` | `last_seen IS NULL` | لم يبدأ اليوم من التطبيق |

---

## 9. تغذية الشاشات — كيف ترتبط Analytics بالمحرك

```
tracking_points (بعد المحرك: ~108 نقطة/يوم/موظف)
  │
  ├──▶ get_live_workday_overview   → LiveMonitoring (connected/delayed/lost)
  ├──▶ get_team_map                → TeamMap (آخر موقع)
  ├──▶ get_employee_day_map        → Route Map (مسار + توقفات + مسافة)
  ├──▶ get_employee_day_timeline   → Timeline (نقاط + أحداث)
  ├──▶ get_employee_detail         → KPI Cards + Header
  ├──▶ get_employee_workday_history → Daily Log + Monthly Summary
  └──▶ get_workday_report          → Executive Reports
```

---

## 10. التعديلات المطلوبة — ملفات جديدة ومعدلة

### ملفات جديدة

| الملف | المحتوى |
|-------|---------|
| `src/services/trackingEngine.ts` | محرك التتبع (Singleton) |
| `src/services/trackingQueue.ts` | IndexedDB Queue |
| `src/components/TimeRangeFilter.tsx` | الفلتر الزمني الموحد (مشترك) |

### ملفات معدلة

| الملف | التغيير |
|-------|---------|
| `src/services/attendance.ts` | إضافة `syncTrackingPoints()` |
| `src/pages/attendance/AttendancePage.tsx` | ربط `trackingEngine` + إضافة طلبات/مبيعات/تحصيلات اليوم |
| `src/pages/attendance/LiveMonitoringPage.tsx` | إضافة زر تفاصيل → EmployeeDayMapPage |
| `src/pages/attendance/TeamMapPage.tsx` | إضافة auto-refresh |
| `src/pages/attendance/ReportsPage.tsx` | إضافة sorting + ربط الفلتر الموحد |
| `src/pages/employees/EmployeeProfilePage.tsx` | تطوير تبويب الحضور: سجل يومي + ملخص شهري |
| `src/pages/attendance/EmployeeDayMapPage.tsx` | ربط الفلتر الزمني |

### المبدأ

**لا توجد شاشة جديدة.** كل شيء يضاف إلى الشاشات الموجودة.
