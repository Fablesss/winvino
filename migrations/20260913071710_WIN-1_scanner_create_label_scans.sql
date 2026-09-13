-- WIN-1: eval-набор сканера этикеток.
--
-- Это измерительный прибор проекта. Без него подкрутка порогов матчера — гадание:
-- непонятно, что именно ломается (OCR, ступень A по винодельне или ступень B внутри
-- портфеля) и стало ли после правки лучше. Поэтому таблица появляется ДО эмбеддингов.

CREATE TABLE IF NOT EXISTS public.label_scans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Входное фото
  image_path    text NOT NULL,           -- где лежит файл (локально или в объектном хранилище)
  image_sha256  text,                    -- чтобы не заводить один и тот же кадр дважды
  captured_at   timestamptz,
  source        text NOT NULL DEFAULT 'eval_set',   -- eval_set | production

  -- Результат OCR
  ocr_provider  text,                    -- yandex_vision | apple_vision | tesseract | ...
  ocr_text      text,
  ocr_raw       jsonb,                   -- ответ провайдера целиком: боксы, уверенности
  ocr_ms        integer,

  -- Эталон. NULL при truth_absent = true: вина нет в каталоге (импорт), и правильное
  -- поведение сканера — честный отказ, а не ближайшее совпадение. Такие кадры в наборе
  -- нужны обязательно, иначе метрика не увидит уверенного вранья.
  truth_wine_slug text REFERENCES public.wines(slug) ON UPDATE CASCADE ON DELETE SET NULL,
  truth_absent    boolean NOT NULL DEFAULT false,

  -- Предсказание матчера
  predicted_wine_slug text REFERENCES public.wines(slug) ON UPDATE CASCADE ON DELETE SET NULL,
  predicted_score     real,
  -- Позиция эталона в выдаче: 1 = top-1, NULL = не попал в топ вообще.
  -- Даёт top-1 и top-5 из одной колонки.
  truth_rank          integer,
  -- Топ-N кандидатов со скорами: видно, проиграл ли правильный ответ на ступени A или B.
  candidates          jsonb,
  matcher_version     text,
  matched_at          timestamptz,

  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT label_scans_truth_consistent
    CHECK (NOT (truth_absent AND truth_wine_slug IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS label_scans_image_sha256_key
  ON public.label_scans (image_sha256) WHERE image_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS label_scans_source_idx     ON public.label_scans (source);
CREATE INDEX IF NOT EXISTS label_scans_truth_idx      ON public.label_scans (truth_wine_slug);
CREATE INDEX IF NOT EXISTS label_scans_truth_rank_idx ON public.label_scans (truth_rank);

COMMENT ON TABLE public.label_scans IS
  'Eval-набор сканера: фото, OCR, эталон и предсказание. Источник метрик top-1/top-5.';

-- Сводка точности по версиям матчера. Считается по eval-набору, прод-сканы не мешают.
CREATE OR REPLACE VIEW public.label_scan_accuracy AS
SELECT
  matcher_version,
  count(*)                                                  AS scans,
  count(*) FILTER (WHERE truth_rank = 1)                    AS top1,
  count(*) FILTER (WHERE truth_rank BETWEEN 1 AND 5)        AS top5,
  count(*) FILTER (WHERE truth_rank IS NULL)                AS missed,
  -- Уверенное враньё: вина в каталоге нет, а сканер что-то назвал.
  count(*) FILTER (WHERE truth_absent AND predicted_wine_slug IS NOT NULL) AS false_positives,
  round(100.0 * count(*) FILTER (WHERE truth_rank = 1) / nullif(count(*), 0), 1) AS top1_pct,
  round(100.0 * count(*) FILTER (WHERE truth_rank BETWEEN 1 AND 5) / nullif(count(*), 0), 1) AS top5_pct
FROM public.label_scans
WHERE source = 'eval_set'
GROUP BY matcher_version;
