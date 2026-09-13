-- WIN-1: расширения и общие помощники схемы.
--
-- ВАЖНО: CREATE EXTENSION действует в пределах ОДНОЙ базы. В этом кластере живёт
-- ещё 16 баз (lms, tv, tasktracker, fin*, ...) — они не затрагиваются.
-- Ни pg_trgm, ни unaccent, ни fuzzystrmatch не требуют shared_preload_libraries,
-- поэтому рестарт сервера не нужен и разделяемая память не расходуется.

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS pg_trgm       WITH SCHEMA extensions;  -- similarity(), gin_trgm_ops
CREATE EXTENSION IF NOT EXISTS unaccent      WITH SCHEMA extensions;  -- диакритика в латинских названиях
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions;  -- levenshtein() для коротких названий

-- pgvector на этом сервере НЕ установлен: pg_available_extensions не содержит 'vector'.
-- Эмбеддинги до его появления лежат как real[] (см. wine_photos ниже и docs/DATABASE.md).
-- Поставить пакет из строки подключения нельзя — нужен root на хосте.

-- search_path вешаем на БАЗУ, а не на роль: роль postgres общая для всех баз кластера,
-- ALTER ROLE ... SET search_path протёк бы в остальные 16 баз.
DO $do$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path = public, extensions', current_database());
END
$do$;

-- Нормализация текста под нечёткое сопоставление OCR с каталогом.
-- Что делает и почему:
--   lower()                     — регистр с этикетки непредсказуем (часто КАПСОМ);
--   translate(..,'ёъь','е')     — ё→е, а ъ и ь удаляются: винодельни любят старую
--                                 орфографию («Гусевъ», «Ведерниковъ»), OCR её теряет;
--   [^a-zа-я0-9] → пробел       — дефисы, точки, кавычки: «Абрау-Дюрсо» ≡ «АБРАУ ДЮРСО»;
--   латиница сохраняется        — 397 названий каталога вообще без кириллицы.
-- IMMUTABLE обязательно: функция используется в generated-колонках под индексами.
CREATE OR REPLACE FUNCTION public.norm_label(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE STRICT
AS $fn$
  SELECT btrim(regexp_replace(
           regexp_replace(translate(lower(txt), 'ёъь', 'е'), '[^a-zа-я0-9]+', ' ', 'g'),
           '\s+', ' ', 'g'))
$fn$;

COMMENT ON FUNCTION public.norm_label(text) IS
  'Канонизация названия для триграммного матчинга OCR: регистр, ё/ъ/ь, пунктуация.';

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;
