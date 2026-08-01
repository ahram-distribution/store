# تصميم مخطط قواعد البيانات وعقود الـ RPC — Schema & RPC Contracts Design

**الحالة:** تصميم — **مُراجَع من الأعمال (2026-08-01)، بانتظار اعتماد النسخة النهائية — لم يُنفَّذ بعد (Design-only)**
**المرجع الأعلى:** `docs/01-ARCHITECTURE/BUSINESS_SPECIFICATION_RESERVATION_ALLOCATION.md` (مواصفة الأعمال الرسمية)
**المرجع المعماري:** `docs/01-ARCHITECTURE/RESERVATION_ALLOCATION_ARCHITECTURE.md` (قسم 5 — العناصر المؤجَّلة)
**النطاق:** مخطط قواعد البيانات وعقود الـ RPC لمحرك حجز وتخصيص المخزون
**خط الأساس:** 2026-08-01 — بيانات طلبات الإنتاج = صفر طلبات (بعد Task 0)

> **قاعدة التصميم:** كل اقتراح في هذا المستند مصنَّف حسب أحد ثلاثة أصناف: **Reuse Existing** (استخدام كائن موجود كما هو) / **Extend Existing** (توسيع كائن موجود بإضافة غير كاسرة) / **New Object Required** (كائن جديد مع تبرير تقني). مبدأ "إعادة الاستخدام قبل التوسيع قبل الإنشاء" ملزِم. هذا المستند **تصميم فقط — يتوقف عند بوابة المراجعة ولا يتضمن أي تنفيذ**.

> **نتيجة مراجعة الأعمال (2026-08-01):** القراران **1 و3 معتمدان**، القرار **2 مُعدَّل** (حجز فقط عند `submitted`؛ `draft`=لا حجز؛ `approved`=يحدث الخصم وينتهي الحجز؛ لا سلوك حجز لأي حالة أخرى)، القرار **4 مؤجَّل** (العروض خارج نطاق المرحلة). التفاصيل الكاملة في **القسم 16**.

---

## 1. ملخص تنفيذي (القرار الجوهري)

**القرار:** اعتماد نموذج **حجز مشتق (Derived Reservation)** — لا يوجد جدول حجز جديد إطلاقاً.

الحجز لطلب معيّن على منتج معيّن **يُحسب دائماً من المحتوى الحالي للطلب وحالته**، ولا يُخزَّن في أي جدول. هذه نقطة التصميم المركزية لأنها تجعل القواعد الملزمة تتحقق **بالبُنية وليس بالمنطق**:

| القاعدة | كيف تتحقق ببنية الحجز المشتق |
|---------|------------------------------|
| BR-RS-01 (الحجز مزامن دائماً) | الحجز **هو** محتوى الطلب الحالي — لا يوجد شيء ليتزامن |
| BR-RS-02 (نقصان الكمية) | ينخفض الحجز تلقائياً لأن المحتوى انخفض |
| BR-RS-03 (زيادة الكمية) | يزداد الحجز تلقائياً، مع فحص السعة عند الزيادة |
| BR-RS-04 (الخروج من حالة الحجز) | الحجز = صفر تلقائياً عند الخروج من `submitted` (القسم 4) |
| BR-RS-05 (مستوى المنتج الفردي) | الحجز مجمَّع لكل منتج داخل الطلب |
| BR-RS-06 (لا حجوزات قديمة) | **مستحيل وجود حجز قديم** — لا يوجد تخزين ليصبح قديماً |
| BR-RS-07 (لا انتهاء صلاحية) | لا يوجد TTL لأنه لا يوجد تخزين |
| BR-RS-08 (تعديل أي حالة يزامن المخزون) | يُعالج عند تعديل الطلب المحسوم (استرجاع ثم إعادة خصم) |

**النتيجة:** صفر جداول جديدة، صفر أعمدة جديدة على `orders`، صفر RPCs عامة جديدة، لا ترحيل بيانات، ولا منطق مزامنة قابل للتلف. التغييرات هي **توسيعات غير كاسرة** على RPCs الموجودة + دوال مساعدة داخلية (New Object) لمنع تكرار المنطق.

---

## 2. جدول تصنيف التغييرات (Reuse / Extend / New)

### 2.1 كائنات يُعاد استخدامها كما هي (Reuse Existing)

| الكائن | الدور في التصميم | القواعد |
|--------|-----------------|---------|
| `orders` + الأعمدة: `status`, `inventory_deducted_at`, `inventory_deducted_items`, `order_negative_selling_allowed`, `order_inventory_deduction_status`, `submitted_at`, `created_at` | مصدر الحالة ومصدر الخصم ولمحة السياسة | BR-RS-01, BR-RS-04, BR-RS-08 |
| `order_items` (`product_id`, `unit_type`, `unit_quantity`, `piece_quantity`) | مصدر محتوى الحجز لكل منتج | BR-RS-02, BR-RS-03, BR-RS-05, BR-SU-01 |
| `inventory` (`product_id`, `quantity`) | قاعدة سعة الحجز (بالقطع) | BR-AL-01 |
| `governed_inventory_deduct` | الخصم مرة واحدة (exactly-once) مع أقفال `FOR UPDATE` | BR-RS-08 |
| `governed_inventory_restore` | الاسترجاع الذري عند الإلغاء/التعديل | BR-RS-08 |
| `app.app_settings` (السياسة العالمية `inventory_negative_selling_allowed`, `inventory_deduction_status`) | مصدر السعة غير المحدودة/المحدودة | عنصر 2 المؤجَّل |
| `check_capability`, `app.sessions`, `is_upper_management` | التحقق من الصلاحيات | BR-VIS-01, BR-VIS-02 |

### 2.2 كائنات تُوسَّع بإضافة غير كاسرة (Extend Existing)

| الكائن | الإضافة | القواعد | المبرر |
|--------|---------|---------|--------|
| `inventory_movements` | 3 أعمدة: `reason text`, `previous_quantity integer`, `new_quantity integer` + توسيع مفردات `movement_type` | BR-AUD-01 | السجل التشغيلي الموجود يفتقد «السبب والقيمة قبل/بعد» المطلوبة في سجل أحداث الطلب |
| `governed_check_product_availability` | **بدون تغيير** — يبقى التوقيع الحالي `(p_product_id, p_requested_quantity)` بسلوكه الحالي للمتوافقية الرجعية (قرار عقد RPC — القسم 8.1) | — | الحفاظ على العقود القائمة (القسم 8.1) |
| `governed_get_order_inventory_snapshot` | إضافة `reserved_quantity`, `allocated_quantity`, `capacity` لكل منتج | BR-VIS-02 | تفاصيل الإدارة (إدارة فقط كما هي اليوم) |
| `governed_supreme_edit_order` | استرجاع الخصم القديم قبل التعديل ثم إعادة الخصم حسب الحالة | BR-RS-08 | **التبعية المعروفة:** تعديل طلب `approved` محسوم يترك المخزون غير متزامن حالياً |
| `governed_inventory_deduct` | استبدال تحويل `piece_quantity` المحفوظ بدالة تحويل موحدة (القيمة الحالية للكرتونة) + كتابة `reason/previous/new` | BR-SU-02, BR-AUD-01 | توحيد التحويل للقطع + استيفاء سجل الأحداث |
| `governed_inventory_restore` | كتابة `reason/previous/new` + أنواع حركة أدق | BR-AUD-01 | استيفاء سجل الأحداث |
| `governed_change_order_status` | تسجيل أحداث الدخول/الخروج من حالة الحجز (`submitted`) + فحص السعة عند الدخول إليها | BR-RS-04, BR-RS-08, BR-AUD-01 | التحرير التلقائي عند الخروج من `submitted` + التدقيق |
| `governed_create_order`, `governed_replace_order_contents`, `governed_return_order_for_revision` | ربط دالة `_reserved_quantity_for_order` للتحقق من السعة عند الزيادة + تسجيل أحداث الحجز | BR-RS-03, BR-RS-05, BR-RS-08, BR-AUD-01 | منع تكرار المنطق |

### 2.3 كائنات جديدة (New Object Required) — مع التبرير التقني

| الكائن | التبرير التقني | القواعد |
|--------|----------------|---------|
| `_to_pieces(unit_type, unit_quantity, carton_quantity)` — دالة تحويل موحدة | **مصدر واحد** لتحويل وحدات البيع إلى قطع (كرتون/دزينة/قطعة). يستخدمها الحجز والخصم والحد الأقصى معاً لضمان عدم الاختلاف، وتحقق BR-SU-02 بقراءة `carton_quantity` الحالية. لا توجد دالة كهذه اليوم (`_calc_base_unit_price` تحسب السعر فقط). لا يمكن إعادة استخدام كائن موجود لأنه غير موجود. | BR-SU-01, BR-SU-02 |
| `_reserved_quantity_for_order(p_product_id, p_order_id)` — دالة الحجز المشتق | **مصدر واحد** لحساب حجز طلب على منتج (أسطر `order_items` بعد التحويل الموحد). تُستخدم في كل نقاط الاحتساب (الإرشاد، الإدارة، فحص السعة) لضمان عدم تكرار منطق التجميع الموجود أصلاً في `governed_inventory_deduct`. | BR-RS-01..05, BR-RS-08 |
| `_reservation_capacity(p_product_id, p_exclude_order_id)` — دالة سعة الحجز | **مصدر واحد** لسعة الحجز الجديد: رصيد المخزون ناقص حجوزات الطلبات المؤهلة الأخرى غير المستثناة. تتعامل مع الحالتين (سعة غير محدودة عند البيع بالسالب / محدودة عكسياً) وهي أساس FCFS. | BR-AL-01, BR-RS-03 |
| `governed_check_product_availability_v2(p_product_id, p_requested_quantity, p_unit_type, p_token)` — RPC إرشاد جديدة | حمل السلوك الجديد الواعي بالوحدة والسعة (BR-VIS-01) في **اسم منفصل وواضح** بدلاً من إضافة overload على RPC عامة قائمة — يمنع تعارض overload عبر PostgREST (`PGRST203`) تماماً ويُبقي `governed_check_product_availability` القديمة دون تغيير (قرار عقد RPC — القسم 8.1). | BR-VIS-01, BR-RS-03 |

> **ملاحظة حوكمة:** هذه الدوال الثلاث **دوال داخلية (internal helpers)** تُستدعى من دوال `SECURITY DEFINER` الموجودة، ولا تُعرض كـ RPC عامة. لا تعرض أي رقم مخزون/حجز خام لأي مستخدم مباشرةً — الإرشاد يمر عبر RPC الموجودة الموسَّعة التي تتحكم بالصلاحيات (BR-VIS-01/02).

---

## 3. عنصر 1 المؤجَّل — نموذج تخزين الحجوزات (القرار)

**القرار: نموذج مشتق — لا جدول حجز.** رُفض الخيار المادي (جدول `order_reservations`).

### 3.1 التعريف الرسمي للحجز المشتق

حجز الطلب `O` على المنتج `P` = مجموع كميات `P` في أسطر `order_items` للطلب `O` **محوَّلةً إلى قطع بدالة `_to_pieces`**، **بشرط**:
1. حالة الطلب `O` = **`submitted`** فقط (القسم 4 — الحالة الوحيدة المعتمدة للحجز)، **و**
2. `orders.inventory_deducted_at IS NULL` (لم يُخصم بعد — المحسوم مُستهلَك فعلياً وليس محجوزاً؛ حارس دفاعي).

```
_reserved_quantity_for_order(P, O) =
  CASE WHEN O.status = 'submitted' AND O.inventory_deducted_at IS NULL
       THEN Σ_خطوط_order_items( _to_pieces(unit_type, unit_quantity, carton_quantity الحالية) )
       ELSE 0
  END
```

### 3.2 مبرر رفض الجدول المادي

| وجه المقارنة | الجدول المادي (مرفوض) | النموذج المشتق (معتمد) |
|--------------|------------------------|------------------------|
| BR-RS-06 (لا حجوزات قديمة) | يتطلب مزامنة يدوية/ترغرز في كل مسار تعديل → خطر حجوزات قديمة | **يستحيل** وجود حجز قديم بالبُنية |
| BR-RS-01 (مزامنة دائمة) | يحتاج ربط كل RPC تعديل بدالة مزامنة → نسيان مسار = كسر القاعدة | تحقق تلقائي |
| الترحيل | ترحيل/إعادة بناء لحالة صفر طلبات + منطق إعادة حساب | لا ترحيل |
| عدد الجداول | +1 جدول جديد | +0 |
| مخاطرة الإنتاج | تشغيل/تعطيل الترغرز والمزامنة | لا مسارات جديدة للمزامنة |
| تكرار المنطق | تجميع المحتوى يُنسخ من `governed_inventory_deduct` | دالة `_reserved_quantity_for_order` واحدة تُعاد استخدامها |

### 3.3 متى قد يُعاد النظر

إذا أصرّت إدارة الأعمال على **حجز جزئي مخزَّن** (الطلب يطلب 10 والرصيد يكفي 7، فيُخزَّن 7 كحجز ثابت غير محسوب) — فذلك يتطلب جدولاً مادياً. التصميم الحالي يرفض ذلك لأن:
- سعة الحجز الافتراضية **غير محدودة** (البيع بالسالب مفعّل افتراضياً)، فالحالة الجزئية لا تظهر افتراضياً،
- والحالة المحدودة تُدار بـ FCFS محسوب لحظياً (القسم 5) دون تخزين.

> **قرار أعمال للمراجعة:** إن كانت الحجوزات الجزئية المخزَّنة مطلوبة صراحةً في سيناريو البيع غير السالب، تُبلَّغ إدارة الأعمال بذلك قبل أي تنفيذ (سيغيّر هذا القرار عدد الجداول).

---

## 4. عنصر 3 المؤجَّل — مجموعة حالات الحجز (القرار المعتمد)

**القاعدة (مُعتمدة من الأعمال — 2026-08-01):** الطلب **يحجز** إذا وفقط إذا كانت حالته **`submitted`** **ولم يُخصم بعد** (`inventory_deducted_at IS NULL` حارس دفاعي).

### 4.1 القرارات المعتمدة

| الحالة | السلوك | المنطق |
|--------|--------|--------|
| `draft` | **لا حجز** | لم يُقدَّم بعد — ليس التزاماً ولا ينافس في FCFS |
| `submitted` | **يبدأ الحجز** | نقطة دخول الالتزام ومفتاح «الأول في التقديم» |
| `approved` | **يحدث الخصم وينتهي الحجز** | عند الوصول إلى حالة الخصم المكوَّنة يُخصم المخزون فيتحوّل الطلب من «محجوز» إلى «مُستهلَك» |

### 4.2 لا سلوك حجز لأي حالة أخرى

**ممنوع الاستنتاج أو الإضافة:** لا يُضاف سلوك حجز لأي حالة غير الحالات الثلاث أعلاه (`reviewing`, `preparing`, `prepared`, `ready_for_dispatch`, `sent_to_delivery`, `dispatched`, `deferred`, `returned_for_revision`, `stock_review`, `cancelled`, `delivered`, وغيرها). حجزها = صفر دائماً.

- إن تطلَّبت أي حالة إضافية سلوك حجز لاحقاً → **يُوقف العمل ويُطلَب قرار أعمال صريح** قبل أي تعديل.
- حالة `approved` مع حالة خصم مكوَّنة مختلفة عن `'approved'` (إعداد عالمي/لكل طلب): يظل الحجز صفراً — الحجز ينتهي عند `approved` بقرار الأعمال، ولا يُستنتج سلوك حجز لحالات لاحقة.
- القاعدة الملزمة (BR-RS-04) «الخروج من حالة الحجز يحرر الحجز» تعني هنا: الخروج من `submitted` إلى أي حالة أخرى يحرر الحجز تلقائياً.

---

## 5. عنصر 2 المؤجَّل — حساب سعة الحجز + FCFS (القرار)

### 5.1 تعريف السعة

```
_reservation_capacity(P, exclude_order) =
  IF (السياسة العالمية inventory_negative_selling_allowed = true)   -- سعة غير محدودة
     THEN ∞  (عبر المنتجات: غير محدودة، لا فحص رصيد)
  ELSE
      inventory.quantity(P) − Σ _reserved_quantity_for_order(P, O')
        حيث O' ≠ exclude_order و O'.status = 'submitted' (غير محسوم)
```

- **البيع بالسالب مفعَّل (الافتراضي الحالي):** السعة غير محدودة → الحجز يساوي دائماً محتوى الطلب، وتوزيع FCFS لا يفعَّل (لا تنافس).
- **البيع بالسالب معطَّل:** السعة = رصيد المخزون ناقص حجوزات الطلبات المؤهلة الأخرى. التنافس يُحسم بـ FCFS.

### 5.2 مفتاح «الأول في التقديم» (BR-AL-01) وإعادة التخصيص

- **مفتاح الفرز:** `(submitted_at ASC, created_at ASC, id ASC)` على طلبات `submitted` غير المحسومة.
- **التخصيص الجشع:** عند كل قراءة، تُرتَّب طلبات `submitted` بالمفتاح أعلاه ويُوزَّع الرصيد لكل طلب بمقدار `min(محتواه, المتبقي)`، **مقرباً لأسفل لوحدات البيع الكاملة** (BR-SU-01) عبر `_to_pieces`.
- **إعادة التخصيص:** تلقائية لحظية لأنها محسوبة عند كل قراءة — لا حاجة لحدث إعادة تخصيص (BR-RS-06).
- **النطاق والأداء:** الحساب لكل منتج عند الطلب. مع خط الأساس صفر طلبات وأداء مسارات `governed_*` الحالية، لا يُضاف فهرس جديد. عند تعميم البيع غير السالب مستقبلاً يُقيَّم فهرس مركّب على `orders(status, submitted_at)` — خارج نطاق هذا المستند.
- **نقطة دخول الخصم:** الخصم عند حالة الخصم المكوَّنة ينتقل بالطلب من «حجز» إلى «استهلاك» — تُحرَّر سعته تلقائياً لبقية الطلبات.

### 5.3 تفاعل السعة مع البيع بالسالب

السعة المحدودة **تُطبَّق فقط** عند تعطيل البيع بالسالب عالمياً (من `app.app_settings`). عند التفعيل، لا يوجد حد رصيد إطلاقاً (السلوك الحالي). **لا يتغير `governed_inventory_deduct` في سلوك السماح** — الخصم الحالي يتحقق من الفجوات فقط عند تعطيل البيع بالسالب، وهذا يبقى صحيحاً.

---

## 6. عنصر 8 المؤجَّل — وحدات البيع وتحويل القطع (BR-SU-01/02)

### 6.1 الدالة الموحدة `_to_pieces`

```
_to_pieces(p_unit_type, p_unit_quantity, p_carton_quantity):
  piece  → p_unit_quantity * 1
  dozen  → p_unit_quantity * 12
  carton → p_unit_quantity * p_carton_quantity      -- تُقرأ من أحدث قيمة للمنتج
```

- **BR-SU-01:** جميع الكميات أعداد صحيحة بوحدات بيع كاملة؛ لا كسور (تقريب لأسفل عند السعة المحدودة).
- **BR-SU-02:** يُقرأ `products.carton_quantity` **من أحدث قيمة عند كل حساب** — يسري تغييره على كل الطلبات القديمة والجديدة تلقائياً دون أي تحديث يدوي.

### 6.2 توحيد التحويل في الخصم

يستبدل `governed_inventory_deduct` اعتماده على `order_items.piece_quantity` المحفوظ بحساب القطع عبر `_to_pieces` من `(unit_type, unit_quantity)` + `carton_quantity` الحالية — ليتطابق الحجز والخصم دائماً.

> **مُعتمَد من الأعمال (2026-08-01):** هذا يغيّر سلوك الخصم الحالي (الذي يستخدم الكمية المحفوظة عند الإنشاء). بما أن خط الأساس صفر طلبات، لا يوجد ترحيل. الهدف: توحيد الحجز والخصم (BR-SU-02).

---

## 7. عنصر 6 المؤجَّل — سجل أحداث الطلب (BR-AUD-01)

### 7.1 القرار: توسيع `inventory_movements` ليكون سجل أحداث المخزون/الحجز

| العمود الحالي | الاستخدام |
|---------------|-----------|
| `created_at` | الطابع الزمني ✓ |
| `created_by` | الفاعل ✓ |
| `product_id`, `order_id` | نطاق الحدث ✓ |
| `quantity_change` | التغيير الصافي ✓ |

| العمود الجديد (إضافة غير كاسرة) | الغرض (BR-AUD-01) |
|-------------------------------|-------------------|
| `reason text DEFAULT NULL` | السبب |
| `previous_quantity integer DEFAULT NULL` | القيمة السابقة (بالقطع) |
| `new_quantity integer DEFAULT NULL` | القيمة الجديدة (بالقطع) |

### 7.2 مفردات `movement_type` الموسَّعة

| الحركة | السيناريو |
|--------|-----------|
| `ORDER_DEDUCTION` (موجود) | الخصم عند حالة الخصم |
| `ORDER_CANCELLATION_RESTORE` (موجود) | الاسترجاع عند الإلغاء |
| `ORDER_EDIT_RESTORE` | استرجاع قبل تعديل طلب محسوم (BR-RS-08) |
| `ORDER_REVISION_RESTORE` | استرجاع عند الإعادة للمراجعة |
| `RESERVATION_UPDATE` | إنشاء/زيادة/نقصان حجز عند أي تعديل محتوى |
| `RESERVATION_RELEASE` | تحرير الحجز عند الخروج من الحالة المؤهلة |
| `RESERVATION_ALLOCATE` | تخصيص FCFS عند السعة المحدودة |
| `RESERVATION_REJECT` | رفض زيادة بسبب السعة المحدودة (عند البيع غير السالب) |

### 7.3 متى تُكتب الأحداث

- **تعديل المحتوى** (`governed_create_order`, `governed_replace_order_contents`, `governed_supreme_edit_order`, `governed_return_order_for_revision`): حدث `RESERVATION_UPDATE` لكل منتج (previous/new) عند اختلاف المحتوى — يسري فقط عندما يكون الطلب في `submitted`.
- **تغيير الحالة** (`governed_change_order_status`, `governed_approve_order`, `governed_cancel_order`): حدث `RESERVATION_RELEASE` عند الخروج من `submitted` إلى أي حالة أخرى، وحدث `RESERVATION_ALLOCATE` عند الدخول إليها في سعة محدودة.
- **الخصم/الاسترجاع**: أحداث `ORDER_DEDUCTION`/`ORDER_*_RESTORE` (بالسبب والقيمتين قبل/بعد).

> **لا يُنشأ جدول `order_event_log` جديد:** `order_status_history` يوثق انتقالات الحالة بالفعل (BR-AUD-01 فرعياً)، و`inventory_movements` الموسَّع يوثق كل أحداث المخزون/الحجز/التخصيص. توحيد السجل في جدول واحد موجود = أصغر تغيير آمن دون ازدواج.

---

## 8. عنصر 5 المؤجَّل — عقود الـ RPC الجديدة/المحدَّثة

### 8.1 إرشاد المندوب (BR-VIS-01) — قرار عقد RPC عام

**القرار (2026-08-01): فصل الاسم — لا overload على RPC عامة قائمة.**

لا يمكن الاعتماد على overload في PostgreSQL لـ RPC عامة معروضة عبر PostgREST: عند إضافة overload بمعاملات اختيارية (defaults)، يصبح الاستدعاء ذو المعاملات الأقل ملتبساً بين التوقيعين ويعيد PostgREST `PGRST203` («Could not choose the best candidate function»). الخطر موثّق أصلاً في `docs/01-ARCHITECTURE/PUBLIC_RPC_CONTRACT_RULE.md`. **القرار:**

1. **`governed_check_product_availability(p_product_id, p_requested_quantity)` — بدون أي تغيير.** يبقى التوقيع والسلوك الحاليان (قراءة `products.negative_selling_allowed` كما هي اليوم) حفاظاً على كل العملاء القائمين (المتجر/السلة/وضع التعديل) دون أي تعديل.
2. **RPC عامة جديدة باسم منفصل وواضح:** `governed_check_product_availability_v2(p_product_id, p_requested_quantity, p_unit_type, p_token)` — تحمل السلوك الجديد الواعي بالوحدة والسعة.

**التوقيع الجديد (RPC جديدة — لا overload):**
```sql
governed_check_product_availability_v2(
  p_product_id          uuid,
  p_requested_quantity  integer,
  p_unit_type           varchar(20) DEFAULT NULL,   -- اختياري — وحدة البيع المطلوبة
  p_token               text DEFAULT NULL           -- اختياري (سياق الجلسة إن توفر)
) RETURNS jsonb
```

**الاستجابة (نفس ملف الاستجابة — غير كاسر):**
```jsonc
{
  "available": true|false,          // يوافق المندوب: متاح / غير متاح
  "max_allowed_units": 5,           // NEW — الحد الأقصى المسموح بوحدة البيع المطلوبة (BR-VIS-01)
  "unit_type": "carton",            // NEW — وحدة البيع المحسوب عليها الحد الأقصى
  "error": "PRODUCT_OUT_OF_STOCK" | "INSUFFICIENT_STOCK" | null
}
```

**تغييرات السلوك في `governed_check_product_availability_v2` (مقارنة بالقديمة):**
1. **إصلاح خلل موجود (مكتشف أثناء التصميم):** الحالي يقرأ `products.negative_selling_allowed` (عمود المنتج القديم) بينما السياسة انتقلت إلى `app.app_settings` منذ `20270803_inventory_global_policies.sql` ولم يعد هذا العمود يُحدَّث بالسياسة. **القرار:** تُقرأ السياسة من `app.app_settings` (`inventory_negative_selling_allowed`) عند توفر `p_token`، أو تُعتبر غير محدودة افتراضياً إن غاب.
2. **الحجز يؤثر على الإرشاد:** عند تعطيل البيع بالسالب، `available = _reservation_capacity(P, NULL) >= requested`. عند التفعيل: `available = true` (إن لم يكن `is_out_of_stock`).
3. **`max_allowed_units`** = `floor(_reservation_capacity(P, NULL) / _to_pieces(unit, 1, carton_quantity))` — **بدون إظهار أي رقم مخزون/حجز خام** (BR-VIS-01).

> **ملاحظة التبني:** عند ربط الواجهة مستقبلاً (القسم 15 الخطوة 6)، تُحدَّث استدعاءات `governed_check_product_availability` إلى `governed_check_product_availability_v2` (بتمرير `p_unit_type` و `p_token`) كمرحلة منفصلة — خارج نطاق هذا المستند (Database/RPC).

### 8.2 توسيع `governed_get_order_inventory_snapshot` (تفاصيل الإدارة — BR-VIS-02)

**التوقيع الحالي (بدون تغيير):** `governed_get_order_inventory_snapshot(p_token text, p_order_id uuid) RETURNS jsonb`

**الاستجابة (إضافة حقول غير كاسرة لكل منتج):**
```jsonc
{
  "snapshot": [{
    "product_id": "...",
    "requested_quantity": 100,        // موجود
    "available_quantity": 500,        // موجود
    "is_sufficient": true,            // موجود
    "reserved_quantity": 100,         // NEW — حجز هذا الطلب (BR-VIS-02)
    "allocated_quantity": 100,        // NEW — نصيب FCFS الفعلي لهذا الطلب
    "capacity": 400                   // NEW — سعة الحجز المتاحة للمنتج (باستثناء هذا الطلب)
  }]
}
```
تظل الإدارة فقط بصلاحية `orders.manage` كما هي (BR-VIS-02).

### 8.3 توسيع `governed_supreme_edit_order` (التبعية المعروفة — BR-RS-08)

**التسلسل الجديد داخل الدالة (بعد التحقق، قبل استبدال المحتوى):**
```
1. IF orders.inventory_deducted_at IS NOT NULL
     → PERFORM governed_inventory_restore(p_order_id)          -- استرجاع الخصم القديم
     → كتابة حدث ORDER_EDIT_RESTORE (reason=reason, previous/new)
2. استبدال المحتوى (كما هو حالياً)
3. IF حالة الخصم المكوَّنة للطلب = حالة الطلب الحالية  -- i.e. طلب وصل/تجاوز نقطة الخصم
     → PERFORM governed_inventory_deduct(p_order_id)           -- إعادة خصم بالمحتوى الجديد
   ELSE
     → تسجيل أحداث RESERVATION_UPDATE لكل منتج (previous/new)
```

**المبرر:** هذا هو المسار الوحيد الذي يعدّل طلباً `approved` محسوماً دون تغيير حالته اليوم، فيترك المخزون غير متزامن (التبعية المعروفة — القسم 4 في الوثيقة المعمارية).

### 8.4 توسيع `governed_change_order_status` (BR-RS-04/08 + BR-AUD-01)

بعد التحقق من الصلاحية والانتقال الحالي، تُضاف:
1. عند **الخروج** من `submitted` إلى أي حالة أخرى (`reviewing`, `approved`, `returned_for_revision`, `cancelled`, ...): تسجيل `RESERVATION_RELEASE` لكل منتج محجوز (previous = حجز الطلب، new = 0). عند الانتقال إلى `approved` يحدث الخصم (`ORDER_DEDUCTION`) فينتهي الحجز بنفس المعاملة.
2. عند **الدخول** إلى `submitted` (من `draft` أو إعادة فتح) بسعة محدودة: تسجيل `RESERVATION_UPDATE`/`RESERVATION_ALLOCATE`.
3. لا تتغير قواعد الانتقال والصلاحيات ولا منطق الخصم الحالي.

### 8.5 ربط دالة الحجز في مسارات التعديل (BR-RS-03)

`governed_create_order` / `governed_replace_order_contents` / `governed_return_order_for_revision`: بعد كتابة المحتوى، تُستدعى `_reserved_quantity_for_order` لكل منتج جديد؛ وعند **زيادة** عن سعة `_reservation_capacity` في وضع البيع غير السالب → تُرفض الزيادة بحدث `RESERVATION_REJECT` (بلا إنشاء حجز جزئي مخزَّن). **الفحص يسري فقط عندما يكون الطلب في `submitted`** — أي حالة أخرى حجزها صفر فلا يوجد فحص سعة.

### 8.6 ملخص دقيق: RPC عامة جديدة واحدة فقط (بقرار عقد RPC)

| الحاجة | الحل |
|--------|------|
| إرشاد المندوب (BR-VIS-01) | RPC عامة **جديدة واحدة**: `governed_check_product_availability_v2` (السلوك الواعي بالوحدة والسعة) — مع إبقاء `governed_check_product_availability` القديمة دون تغيير |
| تفاصيل الإدارة (BR-VIS-02) | توسيع `governed_get_order_inventory_snapshot` |
| مزامنة المحتوى (BR-RS-01/08) | داخل RPCs التعديل/الحالة الموجودة (استرجاع → إعادة خصم/حجز) |
| الحساب المشترك | دوال داخلية `_to_pieces`, `_reserved_quantity_for_order`, `_reservation_capacity` (غير معروضة) |

---

## 9. عنصر 9 المؤجَّل — العروض اليومية/الوميضية في كميات الحجز

**القرار (2026-08-01): مؤجَّل — خارج نطاق هذه المرحلة.** لا تُدرج العروض اليومية (`order_daily_deals`/`daily_deal_items`) ولا العروض الوميضية (`order_flash_offers`/`flash_offer_items`) في حساب الحجز في هذا التصميم. الحجز يُحتسب من أسطر `order_items` فقط.

- **السياق المُسجَّل:** `daily_deals.available_quantity` لم يعد يُخصم في المسار المحكوم الحالي (انتقلت معالجة المخزون إلى `governed_inventory_deduct` التي تخصم مكونات المنتجات فقط).
- **عند فك التعليق مستقبلاً:** تُدرج مساهمة كل عرض عبر منطق التجميع الموجود في `governed_inventory_deduct`، وبتلك الحالة **يُستأنف العمل ويُطلَب قرار أعمال** لتأكيد المعاملة قبل أي تنفيذ.

---

## 10. عنصر 10 المؤجَّل — المتزامنة والذرية (القرار)

| الآلية | الاستخدام |
|--------|-----------|
| معاملة واحدة حول كل مسار تعديل | موجود (كل RPC تعديل هي دالة واحدة) |
| أقفال `FOR UPDATE` على صفوف `inventory` | موجود في `governed_inventory_deduct` — يُعاد استخدامه حرفياً للخصم والاسترجاع |
| دالة حجز مشتقة بلا كتابة | لا قفل مطلوب لقراءة الحجز — الحساب لحظي من بيانات ملتزمة |
| `inventory_deducted_at` كحارس exactly-once | موجود — يمنع الخصم المزدوج عند إعادة التنفيذ (BR-RS-08) |
| إعادة التنفيذ (retry) | لا حاجة لدالة جديدة — الحارس الموجود يعيد نفس النتيجة |

**الذريّة الشاملة:** استرجاع الخصم → استبدال المحتوى → إعادة الخصم تتم داخل نفس الدالة (نفس المعاملة) في `governed_supreme_edit_order` (8.3) — لا توجد نافذة وسيطة مرئية للطلبات الأخرى.

---

## 11. عنصر 7 المؤجَّل — تحديث RPCs القائمة (تأكيد الملخص)

| RPC | التغيير | التصنيف |
|-----|---------|---------|
| `governed_change_order_status` | أحداث دخول/خروج + فحص سعة عند الدخول | Extend |
| `governed_inventory_deduct` | `_to_pieces` + reason/previous/new | Extend |
| `governed_check_product_availability` | **لا تغيير** (legacy للمتوافقية الرجعية — قرار 8.1) | Keep |
| `governed_check_product_availability_v2` | RPC عامة جديدة: السياسة العالمية + `max_allowed_units` + الحجوزات | New |
| `governed_inventory_restore` | reason/previous/new + أنواع أدق | Extend |
| `governed_supreme_edit_order` | استرجاع → إعادة خصم (BR-RS-08) | Extend |

---

## 12. ما لا يُضاف عمداً (والسبب)

| الشيء | لماذا لا يُضاف |
|-------|----------------|
| جدول `order_reservations` | النموذج المشتق يستحيل فيه الحجز القديم (BR-RS-06) — الجدول المادي يستلزم مزامنة قابلة للكسر وترحيلاً |
| جدول `order_event_log` | `inventory_movements` الموسَّع + `order_status_history` يغطيان BR-AUD-01 |
| RPC عامة جديدة للـ sync/إعادة الحساب | BR-RS-06 يحظر الصيانة اليدوية — المزامنة داخلية حصراً |
| RPC تظهر أرقام المخزون/الحجز للمندوب | BR-VIS-01 يحظرها صراحة |
| أعمدة جديدة على `orders` | لا حاجة — الحجز مشتق من الأعمدة الموجودة |

---

## 13. خلاصة أثر التغيير (صافي)

- **جداول جديدة:** 0
- **أعمدة جديدة:** 3 (فقط على `inventory_movements`)
- **RPC عامة جديدة:** 1 (`governed_check_product_availability_v2` — قرار عقد RPC 8.1)
- **دوال داخلية جديدة:** 3 (`_to_pieces`, `_reserved_quantity_for_order`, `_reservation_capacity`)
- **RPC موسَّعة:** 4 (`governed_change_order_status`, `governed_inventory_deduct`, `governed_inventory_restore`, `governed_supreme_edit_order`) + ربط في `governed_create_order`, `governed_replace_order_contents`, `governed_return_order_for_revision` + توسيع `governed_get_order_inventory_snapshot`. **`governed_check_product_availability` تُبقى دون تغيير** (قرار 8.1).
- **ترحيل بيانات:** لا شيء (خط الأساس صفر طلبات)
- **تغيير سلوك الخصم:** استبدال تحويل القطع بدالة موحدة (BR-SU-02) — **مُعتمَد** (6.2)
- **العروض اليومية/الوميضية:** **مؤجَّلة** — خارج نطاق هذه المرحلة (9)

---

## 14. عناصر اكتُشفت أثناء التصميم (حقائق — لا حُكم)

1. **`governed_check_product_availability` يقرأ عموداً مهجوراً:** يقرأ `products.negative_selling_allowed` بينما السياسة العالمية في `app.app_settings` منذ `20270803`. لا يوجد استدعاء محدِّث لهذا العمود → الإرشاد الحالي يتجاهل سياسة البيع بالسالب تقريباً. **يُعالَج في 8.1 عبر RPC الجديدة `governed_check_product_availability_v2`** (القديمة تُترك كما هي للمتوافقية الرجعية).
2. **تعديل طلب `approved` محسوم لا يزامن المخزون:** `governed_supreme_edit_order` يستبدل المحتوى دون استرجاع/إعادة خصم — هذه هي التبعية المعروفة (القسم 4 من الوثيقة المعمارية). يُعالَج في 8.3.
3. **`daily_deals.available_quantity` لم يعد يُخصم في المسار المحكوم** (ملاحظة مسجَّلة — القسم 9، والعروض مؤجَّلة خارج نطاق هذه المرحلة).

---

## 15. تسلسل التنفيذ المقترح (تصميم فقط — لا تنفيذ بعد)

> يُنفَّذ هذا التسلسل **بعد اعتماد هذا المستند** فقط، وكل خطوة تُسجَّل في `docs/08-FIXES-HISTORY/FIX_HISTORY.md` وفق `AGENTS.md`.

1. **Migration A:** توسيع `inventory_movements` (+3 أعمدة) + تحديث `governed_inventory_deduct`/`governed_inventory_restore` (reason/previous/new + `_to_pieces`).
2. **Migration B:** الدوال الداخلية `_to_pieces`, `_reserved_quantity_for_order`, `_reservation_capacity`.
3. **Migration C:** إضافة RPC عامة جديدة `governed_check_product_availability_v2` (السياسة العالمية + `max_allowed_units`) مع إبقاء `governed_check_product_availability` القديمة دون تغيير، وتوسيع `governed_get_order_inventory_snapshot`.
4. **Migration D:** ربط `governed_change_order_status` + `governed_supreme_edit_order` (استرجاع → إعادة خصم) + `governed_create_order`/`governed_replace_order_contents`/`governed_return_order_for_revision` (أحداث + فحص سعة).
5. **التحقق:** اختبار يدوي على بيئة التطوير: إنشاء→إرسال→مراجعة→اعتماد→تعديل أعلى إدارة (يُسترجَع ويُعاد خصمه)→إلغاء→إعادة مراجعة؛ والتحقق من سجل `inventory_movements` لكل خطوة.
6. **Frontend (مرحلة لاحقة منفصلة):** استخدام `max_allowed_units` في `ProductCard`/`cart-availability` بدل الحالة الثنائية فقط — **خارج نطاق هذا المستند (Database/RPC)**.

---

## 16. بوابة المراجعة — توقف قبل التنفيذ

### 16.1 قرارات المراجعة (2026-08-01)

| القرار | النتيجة |
|--------|---------|
| **1. نموذج الحجز المشتق (بدون جدول)** — القسم 3 | **معتمد** |
| **2. مجموعة حالات الحجز** — القسم 4 | **مُعدَّل**: `draft`=لا حجز، `submitted`=يبدأ الحجز، `approved`=يحدث الخصم وينتهي الحجز. لا سلوك حجز لأي حالة أخرى. |
| **3. توحيد تحويل القطع في الخصم (BR-SU-02)** — القسم 6.2 | **معتمد** |
| **4. العروض اليومية/الوميضية** — القسم 9 | **مؤجَّل** — خارج نطاق هذه المرحلة |
| **5. عقد RPC الإرشاد (BR-VIS-01)** — القسم 8.1 | **معتمد (2026-08-01):** `governed_check_product_availability` القديمة (معاملان) تُبقى دون تغيير للمتوافقية الرجعية، ويُحمَل السلوك الجديد الواعي بالوحدة والسعة في RPC عامة جديدة باسم منفصل `governed_check_product_availability_v2` — لا overload على RPC عامة (يمنع `PGRST203` في PostgREST، وفق `PUBLIC_RPC_CONTRACT_RULE.md`). |

### 16.2 الشروط الجارية

**هذا المستند تصميم فقط. لا يُنفَّذ أي من Migrations أو تغييرات RPC، ولا يُلتزَم أي commit، ولا تُنشأ أي Migrations، ولا تتغيّر أي كائنات قاعدة بيانات، حتى:**

1. يُنهى هذا المستند نهائياً وفق القرارات أعلاه، **و**
2. تُراجَع النسخة النهائية وتُعتمَد صراحةً من الأعمال.

- أي **حالة إضافية** يُطلَب لها سلوك حجز → **يوقف التنفيذ ويُطلَب قرار أعمال** أولاً (القسم 4.2).
- عند اعتماد النسخة النهائية يُحدَّث `docs/00-INDEX/DOCUMENTATION_INDEX.md` و`docs/00-INDEX/ANCHORED_SUMMARY.md` ويُسجَّل كل تنفيذ في `FIX_HISTORY.md`.

---

> **المرجع التنفيذي:** `docs/00-INDEX/DOCUMENTATION_INDEX.md`، `.opencode/AGENTS.md`، `docs/07-AUDITS/PROJECT_TRUTH_AUDIT.md`، `docs/07-AUDITS/SYSTEM_REFERENCE_CURRENT_STATE.md`.
> **وثيقة القواعد الرسمية:** `BUSINESS_SPECIFICATION_RESERVATION_ALLOCATION.md`.
> **الوثيقة المعمارية:** `RESERVATION_ALLOCATION_ARCHITECTURE.md` (بجانب هذا الملف).
