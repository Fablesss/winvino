import { z } from 'zod';
import { openApiComponents } from './schemaRegistry.ts';
import { WineSchema } from './wine.ts';

// ── Вход: фото этикетки ─────────────────────────────────────────────────────

/** Имя поля multipart/form-data с фотографией. */
export const RECOGNITION_IMAGE_FIELD = 'image';

/** Форматы проверяются по сигнатуре файла, а не по Content-Type. HEIC не принимается — конвертируйте в JPEG на клиенте. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Меньше этого по короткой стороне текст этикетки не читается. */
export const MIN_IMAGE_SIDE_PX = 200;

/**
 * Клиентам стоит ужимать фото до этой длинной стороны перед отправкой: распознаванию
 * больше не нужно, а снимок телефона весит 3–12 МБ против ~300 КБ после ужатия.
 */
export const RECOMMENDED_MAX_IMAGE_SIDE_PX = 1600;

// ── Выход: результат распознавания ──────────────────────────────────────────

/** Почему не нашли: подсказка клиенту, предложить переснять или сказать «нет в каталоге». */
export const NOT_FOUND_REASONS = ['unreadable', 'not_in_catalog'] as const;

/**
 * Перечень значений `Recognition.status` списком — для кода, которому нужен не разбор ответа,
 * а именно набор значений: например разбор сохранённого скана в очереди разметки.
 */
export const RECOGNITION_STATUSES = ['matched', 'ambiguous', 'not_found'] as const;

export const WineCandidateSchema = z
  .object({
    wine: WineSchema,
    confidence: z.number().min(0).max(1).describe('Уверенность, 0–1'),
  })
  .register(openApiComponents, { id: 'WineCandidate' });

export const NotFoundReasonSchema = z
  .enum(NOT_FOUND_REASONS)
  .describe('unreadable — этикетку не удалось прочитать, стоит переснять; not_in_catalog — вина нет в каталоге')
  .register(openApiComponents, { id: 'NotFoundReason' });

const recognitionMeta = {
  id: z.uuid().describe('Id распознавания — для логов и обращений в поддержку'),
  processingMs: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
};

/** Ключи одинаковы у всех вариантов: клиентам без union-типов (Kotlin, Swift) проще разбирать. */
export const RecognitionSchema = z
  .discriminatedUnion('status', [
    z.object({
      status: z
        .enum(['matched', 'ambiguous'])
        .describe('matched — уверенное совпадение; ambiguous — лучшая догадка, стоит показать альтернативы'),
      reason: z.null(),
      match: WineCandidateSchema,
      alternatives: z.array(WineCandidateSchema).describe('Другие кандидаты по убыванию уверенности'),
      ...recognitionMeta,
    }),
    z.object({
      status: z.literal('not_found'),
      reason: NotFoundReasonSchema,
      match: z.null(),
      alternatives: z.array(WineCandidateSchema).max(0),
      ...recognitionMeta,
    }),
  ])
  .register(openApiComponents, { id: 'Recognition' });

export type WineCandidate = z.infer<typeof WineCandidateSchema>;
export type NotFoundReason = z.infer<typeof NotFoundReasonSchema>;
export type Recognition = z.infer<typeof RecognitionSchema>;
export type RecognitionStatus = Recognition['status'];
