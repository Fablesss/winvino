-- WIN-1: зеркало каталога vino-svoe.ru (2041 вино, 135 виноделен).
-- Источник: открытый API api.vino-svoe.ru/v1 — /wines (список) + /wines/{slug} (детали).

CREATE TABLE IF NOT EXISTS public.manufacturers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,            -- латинский слаг из API: готовая транслитерация
  name        text NOT NULL,
  -- Обе формы под матчинг: на этикетке может стоять и «Абрау-Дюрсо», и «Abrau-Durso».
  name_norm   text GENERATED ALWAYS AS (public.norm_label(name)) STORED,
  slug_norm   text GENERATED ALWAYS AS (public.norm_label(replace(slug, '-', ' '))) STORED,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.regions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  image_url  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.grapes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL UNIQUE,
  name_norm            text GENERATED ALWAYS AS (public.norm_label(name)) STORED,
  image_url            text,
  background_image_url text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dishes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  image_url  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,
  title             text NOT NULL,
  title_norm        text GENERATED ALWAYS AS (public.norm_label(title)) STORED,
  slug_norm         text GENERATED ALWAYS AS (public.norm_label(replace(slug, '-', ' '))) STORED,

  manufacturer_id   uuid REFERENCES public.manufacturers(id) ON DELETE SET NULL,
  region_id         uuid REFERENCES public.regions(id)        ON DELETE SET NULL,

  -- category в API — склейка цвета и сахара: «Белое полусухое», «Белое экстра брют».
  -- Держим и склейку (как пришла), и разбор: оба слова печатают на этикетке,
  -- и именно они разводят 69 коллизий вида (производитель + название).
  category_name     text,
  wine_color        text,   -- Белое / Красное / Розовое / Оранжевое
  sweetness         text,   -- сухое / полусухое / полусладкое / сладкое / брют / экстра брют

  -- ВНИМАНИЕ: поле "color" в API — это НЕ цвет вина, а описание оттенка
  -- («Соломенный с золотистыми переливами»). Поэтому здесь оно называется hue.
  hue               text,

  public_rating     smallint,
  alcohol           numeric(4,1),
  serve_temperature text,          -- как в API: строка-диапазон «10-12»
  description       text,
  image_url         text,          -- путь /uploads/xxx.webp, без хоста и ресайза

  -- Год урожая есть только у 112 названий из 2041, поэтому это слабый тайбрейкер,
  -- а не ключ. NULL — норма, не признак недогруженных данных.
  vintage           smallint,

  detail_synced_at  timestamptz,   -- когда дотягивали /wines/{slug}
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wine_grapes (
  wine_id  uuid NOT NULL REFERENCES public.wines(id)  ON DELETE CASCADE,
  grape_id uuid NOT NULL REFERENCES public.grapes(id) ON DELETE CASCADE,
  PRIMARY KEY (wine_id, grape_id)
);

CREATE TABLE IF NOT EXISTS public.wine_dishes (
  wine_id uuid NOT NULL REFERENCES public.wines(id)  ON DELETE CASCADE,
  dish_id uuid NOT NULL REFERENCES public.dishes(id) ON DELETE CASCADE,
  PRIMARY KEY (wine_id, dish_id)
);

CREATE TABLE IF NOT EXISTS public.wine_photos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wine_id         uuid NOT NULL REFERENCES public.wines(id) ON DELETE CASCADE,
  source_url      text NOT NULL,              -- /uploads/xxx.webp
  kind            text NOT NULL DEFAULT 'catalog_render',
  width           integer,
  height          integer,
  sha256          text,

  -- Два эмбеддинга намеренно: референс в каталоге — рендер бутылки целиком с вырезанным
  -- фоном, а запрос от пользователя — кроп этикетки. Сравнивать их напрямую нельзя,
  -- поэтому храним и полный кадр, и кроп, чтобы измерить, какой из них действительно
  -- работает, вместо того чтобы угадать.
  -- Тип real[], а НЕ vector: pgvector на сервере не установлен. Переход, когда появится:
  --   ALTER TABLE wine_photos ALTER COLUMN embedding_full TYPE extensions.vector(512)
  --     USING embedding_full::extensions.vector(512);
  -- На 2041 строке полный перебор всё равно быстрее накладных расходов HNSW,
  -- так что до индексов дело дойдёт не скоро.
  embedding_full  real[],
  embedding_label real[],
  embedding_model text,
  embedded_at     timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Один файл каталога переиспользуют два вина (4 таких пары), поэтому source_url
  -- уникален только в паре с вином.
  UNIQUE (wine_id, source_url)
);

-- Триграммные индексы — рабочая лошадь матчера: и по кириллице, и по латинице.
CREATE INDEX IF NOT EXISTS manufacturers_name_norm_trgm
  ON public.manufacturers USING gin (name_norm extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS manufacturers_slug_norm_trgm
  ON public.manufacturers USING gin (slug_norm extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS wines_title_norm_trgm
  ON public.wines USING gin (title_norm extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS wines_slug_norm_trgm
  ON public.wines USING gin (slug_norm extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS grapes_name_norm_trgm
  ON public.grapes USING gin (name_norm extensions.gin_trgm_ops);

-- Ступень B матчера всегда идёт «внутри винодельни» — этот индекс её и обслуживает.
CREATE INDEX IF NOT EXISTS wines_manufacturer_id_idx ON public.wines (manufacturer_id);
CREATE INDEX IF NOT EXISTS wines_region_id_idx       ON public.wines (region_id);
-- Обратная сторона связей: составной PK покрывает только свой префикс.
CREATE INDEX IF NOT EXISTS wine_grapes_grape_id_idx  ON public.wine_grapes (grape_id);
CREATE INDEX IF NOT EXISTS wine_dishes_dish_id_idx   ON public.wine_dishes (dish_id);
CREATE INDEX IF NOT EXISTS wine_photos_wine_id_idx   ON public.wine_photos (wine_id);

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'wines_touch_updated_at') THEN
    CREATE TRIGGER wines_touch_updated_at BEFORE UPDATE ON public.wines
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'manufacturers_touch_updated_at') THEN
    CREATE TRIGGER manufacturers_touch_updated_at BEFORE UPDATE ON public.manufacturers
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END
$do$;
