# تقرير فحص قوالب طباعة برنامج سهل (SAHL Print Templates Scan)

**تاريخ المسح:** 2026-06-29  
**الدور:** مهندس أنظمة (صلاحيات قراءة فقط)  
**الهدف:** تحديد موقع ونوع قوالب طباعة الفواتير في برنامج "سهل" المحلي  

---

## 1. ملخص النتائج

| البند | القيمة |
|-------|--------|
| نوع القوالب | **Microsoft Excel (.xlsx)** — تستخدم تقنية Excel Automation |
| عدد القوالب الإجمالي | ~200 ملف (بين .xlsx و .png المصغرات) |
| مجلدات القوالب الرئيسية | 3 مجلدات |
| إصدار القوالب في Options.ini | `ExcelTemplatesVersion=2` |

**لا توجد ملفات** Crystal Reports (.rpt)، FastReport (.frx)، Stimulsoft (.mrt)، أو DevExpress (.repx).

---

## 2. مجلدات القوالب

### 2.1 القوالب المدمجة (Built-in) — `Program\Reports`

```
\\SERVER-PC\joker\SAHL\Program\Reports\
├── ar\          ← القوالب العربية (تحتوي على ملفات إضافية بأسماء عربية)
└── en\          ← القوالب الإنجليزية
```

- كل قالب يتكون من ملفين: `.xlsx` (القالب الفعلي) + `.png` (صورة مصغرة للمعاينة)
- القوالب مرقمة بنظام 4 أرقام: `form-sale-0040 - A4.xlsx` ← `form-sale-0050 - A4.xlsx` (للإصدارات المختلفة)

### 2.2 قوالب المستخدم (User) — `UserReports\`

```
\\SERVER-PC\joker\SAHL\UserReports\
├── (ملفات xlsx فقط — لا توجد مجلدات فرعية)
```

- هذه القوالب هي النسخ المعدلة من قبل المستخدم
- أسماء الملفات هنا باللغة العربية (تظهر مشوشة في PowerShell بسبب ترميز cp720)
- القوالب المكررة من `Program\Reports\ar` مع إضافات عربية

### 2.3 ملفات Excel عادية — `Program\UserReports\`

> ⚠️ تبين وجود تداخل في التسمية: المجلد `UserReports` الذي يظهر في جذر `SAHL` هو نفسه `Program\UserReports` (رابط رمزي أو نسخة).

---

## 3. أنواع القوالب حسب الوظيفة

| المجموعة | البادئة | أمثلة الأحجام |
|----------|---------|----------------|
| **فواتير البيع** 🧾 | `form-sale-*` | 57mm، 80mm، A4، A5، DotMatrix، Electronic Invoice |
| **مرتجعات البيع** ↩️ | `form-returnsale-*` | 80mm، A4، A5 |
| **عروض الأسعار** 📋 | `form-salequote-*` | 80mm، A4، A5 |
| **فواتير الشراء** 📥 | `form-purchase-*` | 80mm، A4، A5، DotMatrix |
| **مرتجعات الشراء** ↩️ | `form-returnpur-*` | 80mm، A4، A5 |
| **المدفوعات** 💰 | `form-payment-*` | 80mm، A4 |
| **المقبوضات** 💳 | `form-receipt-*` | 80mm، A4 |
| **جرد المخزون** 📦 | `form-invent-*` | 80mm، A4 |
| **تحويلات** 🔄 | `form-transfer-*` | 80mm، A4 |
| **تسويات** ⚖️ | `form-adjust-*` | 80mm، A4 |
| **كشف حساب** 📊 | `account-statement-*` | A4، A5، 80mm |
| **تقرير يومي** 📅 | `report-daily-*` | 80mm، A4 |
| **قوالب عامة** 📐 | `Template*.xlsx` | عينة للاستنساخ |

---

## 4. أحجام القوالب المتوفرة

| الحجم | الأبعاد التقريبية | الاستخدام |
|-------|-------------------|-----------|
| `57mm` | 57mm × — | فاتورة حرارية صغيرة (Thermal Receipt) |
| `80mm` | 80mm × — | فاتورة حرارية عادية (Thermal Receipt) |
| `A5` | 148mm × 210mm | فاتورة نصف ورقة |
| `A4` | 210mm × 297mm | فاتورة كاملة |
| `DotMatrix` | — | طابعة إبرية (Dot Matrix Printer) |
| `Electronic Invoice` | — | فاتورة إلكترونية (للضرائب) |

---

## 5. قوالب الفاتورة الرئيسية (Sale Invoice) — التفاصيل

### القوالب العربية المتوفرة حاليأ (الأكثر صلة بالمشروع):

| القالب | الحجم | المسار |
|--------|-------|--------|
| `form-sale-0010 - 80mm` | 80mm حرارية | `Program\Reports\ar\` |
| `form-sale-0020 - 80mm` | 80mm حرارية | `Program\Reports\ar\` |
| `form-sale-0030 - 57mm` | 57mm حرارية | `Program\Reports\ar\` |
| `form-sale-0040 - A4` | A4 | `Program\Reports\ar\` |
| `form-sale-0050 - A4` | A4 | `Program\Reports\ar\` |
| `form-sale-0060 - A4` | A4 | `Program\Reports\ar\` |
| `form-sale-0070 - A5` | A5 | `Program\Reports\ar\` |
| `form-sale-0080 - A4 - Delivery` | A4 (توصيل) | `Program\Reports\ar\` |
| `form-sale-0090 - A4 - Instal Contract` | A4 (عقد تقسيط) | `Program\Reports\ar\` |
| `form-sale-0100 - 80mm - Cafe1` | 80mm (كافيه) | `Program\Reports\ar\` |
| `form-sale-0110 - 80mm - Cafe2` | 80mm (كافيه) | `Program\Reports\ar\` |
| `form-sale-0111 - 80mm - Cafe3` | 80mm (كافيه) | `Program\Reports\ar\` |
| `form-sale-0120 - A4 - ArEn` | A4 عربي/إنجليزي | `Program\Reports\ar\` |
| `form-sale-0125 - 80mm - ArEn` | 80mm عربي/إنجليزي | `Program\Reports\ar\` |
| `form-sale-0130 - DotMatrix` | Dot Matrix | `Program\Reports\ar\` |
| `form-sale-0140 - Electronic Invoice` | إلكترونية | `Program\Reports\ar\` |
| `form-sale-����` | A5 (اسم عربي) | `UserReports\` |
| `form-sale-埢��� ���` | (اسم عربي) | `UserReports\` |
| `form-sale-埢��� ��蟢` | (اسم عربي) | `UserReports\` |
| `form-sale-埢��� �� ��` | (اسم عربي) | `UserReports\` |

> ملاحظة: الأسماء العربية في `UserReports\` تظهر مشوشة بسبب تعارض ترميز cp720 مع UTF-8 في PowerShell.

### القوالب المحددة في Options.ini حالياً (قيد الاستخدام):

| النوع | القالب النشط | الرقم |
|------|-------------|-------|
| فاتورة بيع (`form-sale`) | `����` (اسم عربي) | #1 |
| مرتجع بيع (`form-returnsale`) | `ꩢ�� ���` (اسم عربي) | #1 |
| عرض سعر (`form-salequote`) | `����` (اسم عربي) | #1 |
| أمر شراء (`form-purchase`) | `jmknk` | #1 |
| مرتجع شراء (`form-returnpur`) | `ꩢ�� ����` (اسم عربي) | #1 |
| المخزون (`form-invent`) | `0020 - A4` (قياسي) | #0 (غير مفعل) |
| تحويل (`form-transfer`) | `0020 - A4` (قياسي) | #0 (غير مفعل) |
| تسوية (`form-adjust`) | `0020 - A4` (قياسي) | #0 (غير مفعل) |
| دفع (`form-payment`) | `�� ���` (اسم عربي) | #1 |
| قبض (`form-receipt`) | `�� ��` (اسم عربي) | #1 |
| تقرير يومي (`report-daily`) | `���` (اسم عربي) | #1 |
| كشف حساب (`account-statement`) | (غير محدد) | — |

---

## 6. آلية عمل الطباعة في برنامج سهل

بناءً على التحليل:

1. **التقنية الأساسية:** Excel Automation — يستخدم البرنامج مكتبة Excel لتعبئة قالب `.xlsx` بالبيانات ثم الطباعة
2. **لا توجد تقارير تقليدية:** لا Crystal Reports، لا FastReport، لا Stimulsoft
3. **إصدار القوالب:** `ExcelTemplatesVersion=2` في `Options.ini`
4. **تخزين القوالب:** مجلدان رئيسيان (Built-in `Program\Reports\ar\` و `en\`) ومجلد المستخدم `UserReports\`
5. **اختيار القالب:** يتم عبر إعدادات `[GalleryTemplates]` في `Options.ini` — كل نوع فاتورة له قالب نشط واحد
6. **دعم الطابعات المتعددة:** يوجد إعداد `PrinterName=` لطابعة رئيسية، و `cafe_printer1..6_*` لطابعات إضافية في الكافيه
7. **معاينة الطباعة:** `PrinterPreview.Orientation=0` يشير إلى وجود خاصية معاينة قبل الطباعة

---

## 7. الملاحظات والتوصيات

| # | الملاحظة | التفصيل |
|---|---------|---------|
| 1 | القوالب هي ملفات **Excel وليس تقارير تقليدية** | لا حاجة لمحرر تقارير متخصص. يمكن تعديل القوالب مباشرة بفتحها في Excel |
| 2 | الأسماء العربية تحتاج ترميزاً صحيحاً | PowerShell يعرضها مشوشة بسبب cp720. يجب فتحها في Excel أو استخدام notepad مع ترميز UTF-16LE |
| 3 | قوالب A4 و A5 موجودة مسبقاً | `form-sale-0040 - A4` و `form-sale-0070 - A5` |
| 4 | يوجد قالب فاتورة إلكترونية | `form-sale-0140 - Electronic Invoice.xlsx` — قد يكون متوافقاً مع هيئة الزكاة والضريبة |
| 5 | القوالب العربية موجودة في مجلد `ar` | يجب التأكد من أن التعديلات تنطبق على النسخة العربية (وليست الإنجليزية فقط) |

---

*تم إنشاء هذا التقرير تلقائياً — صلاحيات قراءة فقط، لم يتم تعديل أي ملف.*
