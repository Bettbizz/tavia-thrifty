-- Tavia Thrifty — starting price list
-- Run once in Supabase: SQL Editor → New query → paste → Run
-- "Lowest" prices are a starting guess (about 80% of normal).
-- Change any of them later in Table Editor → grades, or in the owner screens.

insert into public.categories (name, sort_order) values
  ('Pallazos', 1),
  ('Crop tops', 2),
  ('Body suits', 3),
  ('Crop jackets', 4);

insert into public.grades (category_id, name, normal_price, min_price, sort_order)
select c.id, v.grade, v.normal_price, v.min_price, v.sort_order
from (values
  ('Pallazos',     '1st Cam', 500, 400, 1),
  ('Pallazos',     '2nd Cam', 350, 280, 2),
  ('Pallazos',     '3rd Cam', 200, 160, 3),
  ('Crop tops',    '1st Cam', 250, 200, 1),
  ('Crop tops',    '2nd Cam', 150, 120, 2),
  ('Crop tops',    '3rd Cam', 100,  80, 3),
  ('Body suits',   '1st Cam', 400, 320, 1),
  ('Body suits',   '2nd Cam', 300, 240, 2),
  ('Body suits',   '3rd Cam', 200, 160, 3),
  ('Crop jackets', '1st Cam', 600, 480, 1),
  ('Crop jackets', '2nd Cam', 450, 360, 2),
  ('Crop jackets', '3rd Cam', 250, 200, 3)
) as v(category, grade, normal_price, min_price, sort_order)
join public.categories c on c.name = v.category;
