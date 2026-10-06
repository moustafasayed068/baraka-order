-- Delivery: one fixed fee per branch; the customer's location picks the nearest branch.
-- Each branch keeps one delivery_zones row (fee, min_order, max_km). More rows per branch
-- (e.g. a farther ring with a higher fee) still work: the server picks the cheapest row that covers the distance.

alter table branches add column lat double precision, add column lng double precision;
alter table delivery_zones add column max_km numeric(4, 1) not null default 7 check (max_km > 0 and max_km <= 50);

-- APPROXIMATE branch locations from street addresses. The owner must confirm each pin before launch.
update branches b set lat = v.lat, lng = v.lng
from (values
  ('bahary', 31.2008, 29.8950), ('camp-shezar', 31.2105, 29.9250), ('smouha', 31.2065, 29.9500),
  ('el-ezaa', 31.2367, 29.9661), ('el-mahrousa', 31.2700, 30.0000), ('sidi-bishr', 31.2560, 29.9880),
  ('el-mandara', 31.2830, 30.0170), ('mohandessin', 30.0530, 31.2010), ('mokattam', 30.0137, 31.2950),
  ('sheraton', 30.1050, 31.3740)
) v(slug, lat, lng)
where b.slug = v.slug;

-- Replace the "nearby / farther area (sample)" placeholders with one fixed-fee row per branch.
delete from delivery_zones where is_sample;
insert into delivery_zones (branch_id, name_ar, name_en, fee, min_order, max_km, is_sample)
select id, 'التوصيل', 'Delivery', 25, 140, 7, true from branches;
