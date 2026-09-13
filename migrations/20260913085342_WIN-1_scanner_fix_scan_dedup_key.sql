-- WIN-1: ключ дедупликации сканов был выбран неверно.
--
-- Было: UNIQUE (image_sha256). Это ломается на реальных данных сразу двумя способами:
--   1) 4 файла каталога переиспользуют два вина каждый (одна бутылка разных урожаев),
--      то есть один и тот же sha должен лежать с двумя разными эталонами;
--   2) в настоящем eval-наборе у одного вина будет много разных фото.
--
-- Стало: UNIQUE (source, image_path, truth_wine_slug) — «этот кадр с этим эталоном
-- в этом наборе учтён один раз». Повторный прогон self-test'а идемпотентен.
-- Оговорка: строки с truth_wine_slug IS NULL (truth_absent, вина нет в каталоге)
-- так не дедуплицируются — NULL в уникальном индексе не равен NULL.

DROP INDEX IF EXISTS public.label_scans_image_sha256_key;

CREATE UNIQUE INDEX IF NOT EXISTS label_scans_source_image_truth_key
  ON public.label_scans (source, image_path, truth_wine_slug);

-- sha остаётся полезным для поиска дублей кадров, но уже без уникальности.
CREATE INDEX IF NOT EXISTS label_scans_image_sha256_idx
  ON public.label_scans (image_sha256);
