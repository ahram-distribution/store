-- ============================================================
-- SEED: Default sectors + governorate assignments
-- Idempotent: skips if sectors already exist
-- ============================================================

DO $$
DECLARE
    v_cairo    uuid; v_alex      uuid; v_delta    uuid;
    v_canal    uuid; v_north_s   uuid; v_mid_s    uuid; v_south_s   uuid;
    v_gov_id   uuid;
BEGIN
    IF EXISTS (SELECT 1 FROM public.sectors LIMIT 1) THEN RETURN; END IF;

    INSERT INTO public.sectors (name, name_ar, description) VALUES ('Cairo Greater', 'قطاع القاهرة الكبرى', 'القاهرة والجيزة والقليوبية') RETURNING id INTO v_cairo;
    INSERT INTO public.sectors (name, name_ar, description) VALUES ('Alexandria Coast', 'قطاع الإسكندرية والساحل', 'الإسكندرية والبحيرة ومطروح') RETURNING id INTO v_alex;
    INSERT INTO public.sectors (name, name_ar, description) VALUES ('Delta', 'قطاع الدلتا', 'الدقهلية ودمياط وكفر الشيخ والغربية والمنوفية والشرقية') RETURNING id INTO v_delta;
    INSERT INTO public.sectors (name, name_ar, description) VALUES ('Canal Sinai', 'قطاع القناة وسيناء', 'بورسعيد والإسماعيلية والسويس وشمال وجنوب سيناء') RETURNING id INTO v_canal;
    INSERT INTO public.sectors (name, name_ar, description) VALUES ('North Upper Egypt', 'قطاع شمال الصعيد', 'الفيوم وبني سويف والمنيا') RETURNING id INTO v_north_s;
    INSERT INTO public.sectors (name, name_ar, description) VALUES ('Mid Upper Egypt', 'قطاع وسط الصعيد', 'أسيوط والوادي الجديد') RETURNING id INTO v_mid_s;
    INSERT INTO public.sectors (name, name_ar, description) VALUES ('South Upper Egypt', 'قطاع جنوب الصعيد', 'سوهاج وقنا وأسوان والأقصر والبحر الأحمر') RETURNING id INTO v_south_s;

    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'CAI';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_cairo, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'GIZ';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_cairo, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'QLY';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_cairo, v_gov_id) ON CONFLICT DO NOTHING; END IF;

    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'ALX';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_alex, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'BHR';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_alex, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'MTH';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_alex, v_gov_id) ON CONFLICT DO NOTHING; END IF;

    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'DQL';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_delta, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'DMT';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_delta, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'KFS';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_delta, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'GHR';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_delta, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'MNF';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_delta, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'SHQ';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_delta, v_gov_id) ON CONFLICT DO NOTHING; END IF;

    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'PST';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_canal, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'ISM';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_canal, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'SUZ';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_canal, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'NSN';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_canal, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'SSN';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_canal, v_gov_id) ON CONFLICT DO NOTHING; END IF;

    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'FYM';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_north_s, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'BNS';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_north_s, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'MIN';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_north_s, v_gov_id) ON CONFLICT DO NOTHING; END IF;

    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'AST';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_mid_s, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'WAD';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_mid_s, v_gov_id) ON CONFLICT DO NOTHING; END IF;

    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'SHG';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_south_s, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'QNA';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_south_s, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'LXR';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_south_s, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'ASW';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_south_s, v_gov_id) ON CONFLICT DO NOTHING; END IF;
    SELECT id INTO v_gov_id FROM public.reference_governorates WHERE code = 'RED';
    IF v_gov_id IS NOT NULL THEN INSERT INTO public.sector_governorates (sector_id, governorate_id) VALUES (v_south_s, v_gov_id) ON CONFLICT DO NOTHING; END IF;

END $$;
