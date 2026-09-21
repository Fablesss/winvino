import { z } from 'zod';
import { openApiComponents } from './schemaRegistry.ts';

/** Машинные коды цвета. Подпись для людей — в `Wine.categoryLabel`. */
export const WINE_COLORS = ['white', 'red', 'rose', 'orange'] as const;

/** Машинные коды сахара. `brut`/`extra_brut` — шкала игристых. */
export const WINE_SWEETNESS_LEVELS = ['dry', 'semi_dry', 'semi_sweet', 'sweet', 'brut', 'extra_brut'] as const;

export const WineColorSchema = z
  .enum(WINE_COLORS)
  .describe('Цвет вина')
  .register(openApiComponents, { id: 'WineColor' });

export const WineSweetnessSchema = z
  .enum(WINE_SWEETNESS_LEVELS)
  .describe('Содержание сахара')
  .register(openApiComponents, { id: 'WineSweetness' });

export const WineSchema = z
  .object({
    id: z.uuid().describe('Стабильный id вина в каталоге winvino'),
    slug: z.string().min(1).describe('Слаг вина в каталоге-источнике (vino-svoe.ru)'),
    title: z.string().min(1).describe('Название, как в каталоге'),
    manufacturer: z
      .object({ slug: z.string().min(1), name: z.string().min(1) })
      .nullable()
      .describe('Винодельня'),
    region: z.object({ name: z.string().min(1) }).nullable(),
    color: WineColorSchema.nullable(),
    sweetness: WineSweetnessSchema.nullable(),
    categoryLabel: z.string().nullable().describe('Готовая подпись для показа: «Белое полусухое»'),
    hue: z.string().nullable().describe('Описание оттенка: «Соломенный с золотистыми бликами»'),
    grapes: z.array(z.string()).describe('Сорта винограда'),
    pairings: z.array(z.string()).describe('Гастрономические сочетания'),
    alcoholPercent: z.number().min(0).max(100).nullable(),
    servingTemperatureC: z
      .object({ min: z.number(), max: z.number() })
      .nullable()
      .describe('Температура подачи, °C'),
    vintage: z.number().int().nullable().describe('Год урожая; у большинства вин каталога не указан'),
    rating: z.number().min(0).max(5).nullable().describe('Рейтинг каталога, 0–5'),
    description: z.string().nullable(),
    imageUrl: z.url().nullable().describe('Фото бутылки из каталога'),
    catalogUrl: z.url().nullable().describe('Карточка вина на сайте каталога'),
  })
  .register(openApiComponents, { id: 'Wine' });

export type WineColor = z.infer<typeof WineColorSchema>;
export type WineSweetness = z.infer<typeof WineSweetnessSchema>;
export type Wine = z.infer<typeof WineSchema>;
