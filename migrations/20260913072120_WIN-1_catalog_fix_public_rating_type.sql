-- WIN-1: publicRating — средняя оценка, а не целое.
--
-- В списке /v1/wines значения выглядят целыми (2, 4), но /v1/wines/{slug} отдаёт
-- дробные: «2.25». Исходный smallint падал с
--   invalid input syntax for type smallint: "2.25"
-- Меняем тип на numeric(3,2): диапазон 0.00–9.99 покрывает шкалу 1–5 с запасом.

ALTER TABLE public.wines
  ALTER COLUMN public_rating TYPE numeric(3,2)
  USING public_rating::numeric(3,2);

COMMENT ON COLUMN public.wines.public_rating IS
  'Народный рейтинг vino-svoe.ru — среднее, приходит дробным.';
