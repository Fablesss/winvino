-- WIN-1: хранить результаты разных движков OCR на одних и тех же кадрах.
--
-- Ключ (source, image_path, truth_wine_slug) допускает ровно один скан кадра на набор.
-- Для сравнения движков (tesseract.js против PaddleOCR) это не годится: второй движок
-- затёр бы результаты первого, и сравнивать стало бы не с чем. В ключ добавлен
-- ocr_provider. Оговорка: строки с ocr_provider IS NULL так не дедуплицируются —
-- NULL в уникальном индексе не равен NULL, поэтому провайдер нужно указывать всегда.
--
-- Заодно нормализуются пути. Первый прогон tesseract писал image_path через
-- path.join на Windows, то есть с обратными слешами, а новые записи идут с прямыми.
-- Без нормализации один и тот же кадр у двух движков не сопоставился бы при JOIN.
-- LIKE здесь не подходит: обратный слеш в нём — управляющий символ, поэтому strpos.

UPDATE public.label_scans
SET image_path = replace(image_path, E'\\', '/')
WHERE strpos(image_path, E'\\') > 0;

DROP INDEX IF EXISTS public.label_scans_source_image_truth_key;

CREATE UNIQUE INDEX IF NOT EXISTS label_scans_source_image_truth_provider_key
  ON public.label_scans (source, image_path, truth_wine_slug, ocr_provider);

CREATE INDEX IF NOT EXISTS label_scans_ocr_provider_idx
  ON public.label_scans (ocr_provider);
