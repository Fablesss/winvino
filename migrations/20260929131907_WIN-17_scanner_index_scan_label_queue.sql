-- WIN-17: индексы под очередь разметки прод-сканов.
--
-- Очередь читает label_scans в одном порядке — самые свежие прод-сканы первыми, страницами по
-- курсору (created_at, id). Из индексов WIN-1 под это подходит только label_scans_source_idx по
-- одной колонке: порядок пришлось бы досортировывать, а таблица растёт на каждое распознавание.
--
-- Индексов два, потому что запросов два:
--   * полный — вкладка «размеченные», она смотрит всю историю прода;
--   * частичный — собственно очередь. Неразмеченных со временем становится малая доля таблицы,
--     и по полному индексу пришлось бы перебирать размеченные строки, чтобы набрать 20 новых.

CREATE INDEX IF NOT EXISTS label_scans_source_created_idx
  ON public.label_scans (source, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS label_scans_pending_truth_idx
  ON public.label_scans (source, created_at DESC, id DESC)
  WHERE truth_wine_slug IS NULL AND NOT truth_absent;
