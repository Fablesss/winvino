import { z } from 'zod';

/** Compose подставляет незаданную необязательную переменную пустой строкой — считаем её отсутствующей. */
const emptyAsUndefined = (raw: unknown): unknown => (raw === '' ? undefined : raw);

/** Единственное место, где бот читает окружение. Дальше конфиг передаётся явно. */
const BotEnvSchema = z.object({
  /** Токен от @BotFather. В сообщения об ошибках не попадает. */
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/, 'ожидается токен от @BotFather вида 123456789:AA…'),
  /** API распознавания без завершающего слэша, например http://api:8787. */
  WINVINO_API_URL: z.url().default('http://127.0.0.1:8787'),
  /** Адрес веба (Mini App). Telegram открывает мини-аппы только по HTTPS. Не задан — кнопки нет. */
  WEB_APP_URL: z.preprocess(
    emptyAsUndefined,
    z.url({ protocol: /^https$/, error: 'нужен HTTPS-адрес веба: Telegram открывает Mini App только по HTTPS' }).optional(),
  ),
  /** Свой Bot API сервер или заглушка для локальной проверки. */
  TELEGRAM_API_URL: z.url().default('https://api.telegram.org'),
  /** Сколько секунд Telegram держит getUpdates, если апдейтов нет. */
  POLL_TIMEOUT_S: z.coerce.number().int().min(1).max(50).default(30),
});

export type BotConfig = {
  telegramBotToken: string;
  telegramApiOrigin: string;
  apiBaseUrl: string;
  webAppUrl: string | null;
  pollTimeoutSeconds: number;
};

export class BotConfigError extends Error {
  constructor(issues: string[]) {
    super(`неверное окружение бота:\n  ${issues.join('\n  ')}`);
    this.name = 'BotConfigError';
  }
}

export function loadBotConfig(env: Record<string, string | undefined>): BotConfig {
  const parsed = BotEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new BotConfigError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }
  const vars = parsed.data;
  return {
    telegramBotToken: vars.TELEGRAM_BOT_TOKEN,
    telegramApiOrigin: vars.TELEGRAM_API_URL.replace(/\/+$/, ''),
    apiBaseUrl: vars.WINVINO_API_URL.replace(/\/+$/, ''),
    webAppUrl: vars.WEB_APP_URL ?? null,
    pollTimeoutSeconds: vars.POLL_TIMEOUT_S,
  };
}
