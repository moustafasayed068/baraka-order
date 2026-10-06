-- Seed from El Baraka's 2026 take-away menu. Take-away/delivery prices (dine-in is not ordered online).

insert into branches (slug, name_ar, name_en, city, address_ar, address_en, sort) values
  ('bahary',       'بحري',            'Bahary',          'alexandria', '19 ش 26 يوليو، على البحر', '19 26th of July St, on the Corniche', 1),
  ('camp-shezar',  'كامب شيزار',      'Camp Shezar',     'alexandria', 'كامب شيزار',               'Camp Shezar', 2),
  ('smouha',       'سموحة',           'Smouha',          'alexandria', 'سموحة',                    'Smouha', 3),
  ('el-ezaa',      'الإذاعة',          'El Ezaa',         'alexandria', '30 ش الإذاعة، باكوس',       '30 El Ezaa St, Bacos', 4),
  ('el-mahrousa',  'المحروسة',        'El Mahrousa',     'alexandria', 'طريق الجيش',               'El Geish Rd', 5),
  ('sidi-bishr',   'سيدي بشر',        'Sidi Bishr',      'alexandria', 'ش العيسوي',                'El Esawy St', 6),
  ('el-mandara',   'المندرة',          'El Mandara',      'alexandria', 'طريق الجيش',               'El Geish Rd', 7),
  ('mohandessin',  'المهندسين',        'Mohandessin',     'cairo',      '45 ش البطل أحمد عبدالعزيز', '45 El Batal Ahmed Abdel Aziz St', 8),
  ('mokattam',     'المقطم',           'Mokattam',        'cairo',      'ش 9 امتداد ميدان النافورة', '9th St, off El Nafoura Sq', 9),
  ('sheraton',     'مساكن الشيراتون',  'Sheraton',        'cairo',      '43 ش أنقرة',                '43 Ankara St', 10);

insert into categories (slug, name_ar, name_en, sort) values
  ('meals', 'الوجبات', 'Meals', 1),
  ('fatta', 'الفتات والرز', 'Fatta & rice', 2),
  ('extras', 'الإضافات', 'Extras', 3);

insert into menu_items (category_id, slug, name_ar, name_en, desc_ar, desc_en, base_price, is_meal, sort)
select c.id, v.slug, v.name_ar, v.name_en, v.desc_ar, v.desc_en, v.price, v.is_meal, v.sort
from (values
  ('meals', 'quarter',  'ربع فرخة بروستد', 'Quarter Broasted Chicken', 'ورك بروستد + بطاطس + عيش + ثومية صغيرة + كاتشب', 'Broasted leg + fries + bun + small garlic sauce + ketchup', 140, true, 1),
  ('meals', 'strips',   'وجبة ستربس',      'Strips Meal',              'بطاطس + عيش + ثومية + كاتشب', 'Fries + bun + garlic sauce + ketchup', 155, true, 2),
  ('meals', 'baraka',   'وجبة البركة',      'El Baraka Meal',           'نص فرخة بروستد + بطاطس + عيش + ثومية + كول سلو + كاتشب', 'Half broasted chicken + fries + bun + garlic sauce + coleslaw + ketchup', 240, true, 3),
  ('fatta', 'fatta',    'فتة البركة',       'El Baraka Fatta',          'رز بسمتي + صوص من اختيارك + ستربس + كول سلو', 'Basmati rice + your sauce + strips + coleslaw', 165, true, 1),
  ('fatta', 'basmatio', 'بسمتيو',          'Basmatio Bowl',            'رز بسمتي وستربس بالصوص اللي تحبه', 'Basmati rice and strips with the sauce you like', 110, true, 2),
  ('fatta', 'combo',    'كومبو',           'Combo',                    'باكت بطاطس + مشروب', 'Fries pack + drink', 55, false, 3),
  ('extras', 'x-strip',       'قطعة ستربس',      'Strip piece',        '', '', 40, false, 1),
  ('extras', 'x-rice',        'أرز بسمتي',       'Basmati rice',       '', '', 30, false, 2),
  ('extras', 'x-fries',       'باكيت بطاطس',     'Fries pack',         '', '', 40, false, 3),
  ('extras', 'x-cheesy-fries','تشيزي فرايز',     'Cheesy fries',       '', '', 60, false, 4),
  ('extras', 'x-garlic',      'ثومية كبير',      'Large garlic sauce', '', '', 20, false, 5),
  ('extras', 'x-coleslaw',    'كول سلو',         'Coleslaw',           '', '', 20, false, 6),
  ('extras', 'x-bbq',         'صوص باربيكيو',    'BBQ sauce',          '', '', 30, false, 7),
  ('extras', 'x-cheddar',     'صوص شيدر',        'Cheddar sauce',      '', '', 40, false, 8),
  ('extras', 'x-ranch',       'صوص رانش',        'Ranch sauce',        '', '', 30, false, 9),
  ('extras', 'x-chili',       'صوص سويت تشيلي',  'Sweet chili sauce',  '', '', 30, false, 10),
  ('extras', 'x-bun',         'عيش كيزر',        'Kaiser bun',         '', '', 5, false, 11),
  ('extras', 'x-drink',       'مشروب',           'Soft drink',         '', '', 25, false, 12),
  ('extras', 'x-water',       'مياه',            'Water',              '', '', 10, false, 13)
) v(cat, slug, name_ar, name_en, desc_ar, desc_en, price, is_meal, sort)
join categories c on c.slug = v.cat;

-- Strips sizes: 3 pcs 155, 5 pcs 215 (base 155 + 60)
insert into item_options (item_id, kind, name_ar, name_en, price_delta, sort)
select i.id, 'size', v.ar, v.en, v.delta, v.sort
from (values ('3 قطع', '3 pcs', 0, 1), ('5 قطع', '5 pcs', 60, 2)) v(ar, en, delta, sort)
cross join menu_items i where i.slug = 'strips';

-- Sauce choice for fatta and basmatio
insert into item_options (item_id, kind, name_ar, name_en, price_delta, sort)
select i.id, 'sauce', v.ar, v.en, 0, v.sort
from (values ('باربكيو + ثومية', 'BBQ + garlic', 1), ('رانش', 'Ranch', 2), ('سويت تشيلي', 'Sweet chili', 3), ('تشيزي', 'Cheesy', 4)) v(ar, en, sort)
cross join menu_items i where i.slug in ('fatta', 'basmatio');

-- SAMPLE delivery zones: real areas, fees and minimums are not known yet. Edit in admin.
insert into delivery_zones (branch_id, name_ar, name_en, fee, min_order, is_sample)
select b.id, v.ar || ' (تجريبي)', v.en || ' (sample)', v.fee, v.min_order, true
from branches b
cross join (values ('المنطقة القريبة', 'Nearby area', 20, 150), ('المنطقة البعيدة', 'Farther area', 35, 200)) v(ar, en, fee, min_order);

-- DEV ONLY: every branch PIN is 1234 for local testing. Real PINs are set per branch before launch.
insert into branch_pins (branch_id, pin_hash) select id, extensions.crypt('1234', extensions.gen_salt('bf')) from branches;
