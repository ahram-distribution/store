-- ============================================================================
-- SEED: Governorates — 27 Egyptian Governorates
-- Idempotent: can be run multiple times (ON CONFLICT DO NOTHING)
-- ============================================================================

INSERT INTO reference_governorates (code, name_ar, name_en, display_order) VALUES
  ('CAI', 'القاهرة',          'Cairo',       1),
  ('GIZ', 'الجيزة',           'Giza',        2),
  ('ALX', 'الإسكندرية',       'Alexandria',  3),
  ('SHQ', 'الشرقية',          'Sharqia',     4),
  ('DQL', 'الدقهلية',         'Dakahlia',    5),
  ('BHR', 'البحيرة',          'Beheira',     6),
  ('QLY', 'القليوبية',        'Qalyubia',    7),
  ('MNF', 'المنوفية',         'Monufia',     8),
  ('GHR', 'الغربية',          'Gharbia',     9),
  ('KFS', 'كفر الشيخ',        'Kafr El Sheikh', 10),
  ('DMT', 'دمياط',            'Damietta',    11),
  ('PST', 'بورسعيد',          'Port Said',   12),
  ('ISM', 'الإسماعيلية',      'Ismailia',    13),
  ('SUZ', 'السويس',           'Suez',        14),
  ('NSN', 'شمال سيناء',       'North Sinai', 15),
  ('SSN', 'جنوب سيناء',       'South Sinai', 16),
  ('BNS', 'بني سويف',         'Beni Suef',   17),
  ('FYM', 'الفيوم',           'Fayoum',      18),
  ('MIN', 'المنيا',           'Minya',       19),
  ('AST', 'أسيوط',            'Assiut',      20),
  ('SHG', 'سوهاج',            'Sohag',       21),
  ('QNA', 'قنا',              'Qena',        22),
  ('LXR', 'الأقصر',           'Luxor',       23),
  ('ASW', 'أسوان',            'Aswan',       24),
  ('RED', 'البحر الأحمر',     'Red Sea',     25),
  ('WAD', 'الوادي الجديد',    'New Valley',  26),
  ('MTH', 'مطروح',            'Matrouh',     27)
ON CONFLICT (code) DO NOTHING;
