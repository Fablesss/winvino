import { z } from 'zod';

/**
 * Тонкий клиент Telegram Bot API: только методы, которые нужны боту.
 * Входящие объекты разбираются zod-схемами, в которых лишь читаемые ботом поля.
 */

const TELEGRAM_API_ORIGIN = 'https://api.telegram.org';
const TELEGRAM_REQUEST_TIMEOUT_MS = 30_000;
/** getUpdates висит до timeout секунд — HTTP-таймаут должен быть с запасом больше. */
const LONG_POLL_GRACE_MS = 10_000;

// ── Объекты Bot API ─────────────────────────────────────────────────────────

const PhotoSizeSchema = z.object({
  file_id: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  file_size: z.number().int().optional(),
});

const DocumentSchema = z.object({
  file_id: z.string(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
  file_size: z.number().int().optional(),
});

const MessageSchema = z.object({
  message_id: z.number().int(),
  chat: z.object({ id: z.number().int(), type: z.string() }),
  text: z.string().optional(),
  photo: z.array(PhotoSizeSchema).optional(),
  document: DocumentSchema.optional(),
});

/** Сообщение, которое не разобралось, не должно ронять пачку апдейтов: offset всё равно сдвигаем. */
const UpdateSchema = z.object({
  update_id: z.number().int(),
  message: MessageSchema.optional().catch(undefined),
});

const FileSchema = z.object({ file_path: z.string().optional() });

const UserSchema = z.object({ id: z.number().int(), username: z.string().optional() });

const EnvelopeSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  description: z.string().optional(),
  error_code: z.number().int().optional(),
  parameters: z.object({ retry_after: z.number().optional() }).optional(),
});

export type TelegramPhotoSize = z.infer<typeof PhotoSizeSchema>;
export type TelegramMessage = z.infer<typeof MessageSchema>;
export type TelegramUpdate = z.infer<typeof UpdateSchema>;
export type TelegramUser = z.infer<typeof UserSchema>;

export type InlineKeyboardButton = { text: string; url: string } | { text: string; web_app: { url: string } };

/** Ответ в чат: разметка — HTML Bot API, кнопки — inline-клавиатура под сообщением. */
export type OutgoingMessage = {
  chatId: number;
  html: string;
  buttons: InlineKeyboardButton[][];
  replyToMessageId: number;
};

export class TelegramApiError extends Error {
  readonly method: string;
  /** error_code Telegram (совпадает с HTTP-статусом); null — до Telegram не достучались или ответ не по формату. */
  readonly errorCode: number | null;
  /** Для 429: через сколько секунд можно повторить. */
  readonly retryAfterSeconds: number | null;

  constructor(init: { method: string; description: string; errorCode: number | null; retryAfterSeconds?: number | null; cause?: unknown }) {
    super(`${init.method}: ${init.description}`, { cause: init.cause });
    this.name = 'TelegramApiError';
    this.method = init.method;
    this.errorCode = init.errorCode;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }
}

export type TelegramBotApi = {
  fetchMe(): Promise<TelegramUser>;
  /** signal отменяет ожидание: отмену отдаём как есть, а не TelegramApiError. */
  fetchUpdates(options: { offset: number; timeoutSeconds: number; limit?: number; signal?: AbortSignal }): Promise<TelegramUpdate[]>;
  /** getFile + скачивание. Боту Telegram отдаёт файлы до 20 МБ. */
  downloadFile(fileId: string): Promise<Blob>;
  sendMessage(message: OutgoingMessage): Promise<void>;
  sendPhoto(message: OutgoingMessage & { photo: Blob }): Promise<void>;
  sendChatAction(chatId: number, action: 'typing'): Promise<void>;
};

export type TelegramBotApiOptions = {
  token: string;
  fetch?: typeof fetch;
  /** Свой Bot API сервер; по умолчанию api.telegram.org. */
  apiOrigin?: string;
};

type CallOptions = { signal?: AbortSignal; timeoutMs?: number };
type EncodedBody = { body: string | Blob; contentType: string };

function encodeJson(params: Record<string, unknown>): EncodedBody {
  return { body: JSON.stringify(params), contentType: 'application/json' };
}

/**
 * multipart/form-data собираем сами: FormData из undici по спецификации переводит \n в строковых
 * полях в \r\n, и подпись к фото уходила бы в Telegram с \r. Имена полей — наши константы.
 */
function encodeMultipart(fields: Record<string, unknown>, file: { field: string; filename: string; content: Blob }): EncodedBody {
  const boundary = `winvino-${crypto.randomUUID()}`;
  const parts: Array<string | Blob> = Object.entries(fields).map(
    ([name, value]) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${typeof value === 'string' ? value : JSON.stringify(value)}\r\n`,
  );
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n`,
    `Content-Type: ${file.content.type || 'application/octet-stream'}\r\n\r\n`,
    file.content,
    `\r\n--${boundary}--\r\n`,
  );
  return { body: new Blob(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function toReplyFields(message: OutgoingMessage): Record<string, unknown> {
  return {
    chat_id: message.chatId,
    parse_mode: 'HTML',
    // Исходное фото успели удалить — всё равно ответить, просто без цитаты.
    reply_parameters: { message_id: message.replyToMessageId, allow_sending_without_reply: true },
    ...(message.buttons.length > 0 ? { reply_markup: { inline_keyboard: message.buttons } } : {}),
  };
}

export function createTelegramBotApi(options: TelegramBotApiOptions): TelegramBotApi {
  const origin = options.apiOrigin ?? TELEGRAM_API_ORIGIN;
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function callMethod<T>(
    method: string,
    { body, contentType }: EncodedBody,
    resultSchema: z.ZodType<T>,
    { signal, timeoutMs = TELEGRAM_REQUEST_TIMEOUT_MS }: CallOptions = {},
  ): Promise<T> {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(`${origin}/bot${options.token}/${method}`, {
        method: 'POST',
        body,
        headers: { 'Content-Type': contentType },
        signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      const description = timeoutSignal.aborted ? `нет ответа за ${timeoutMs} мс` : 'нет связи с Telegram';
      throw new TelegramApiError({ method, description, errorCode: null, cause });
    }

    const envelope = EnvelopeSchema.safeParse(await response.json().catch(() => undefined));
    if (!envelope.success) {
      throw new TelegramApiError({ method, description: `ответ не в формате Bot API, HTTP ${response.status}`, errorCode: null });
    }
    if (!envelope.data.ok) {
      throw new TelegramApiError({
        method,
        description: envelope.data.description ?? 'Telegram не объяснил причину',
        errorCode: envelope.data.error_code ?? response.status,
        retryAfterSeconds: envelope.data.parameters?.retry_after ?? null,
      });
    }
    const result = resultSchema.safeParse(envelope.data.result);
    if (!result.success) {
      throw new TelegramApiError({ method, description: `неожиданный result: ${z.prettifyError(result.error)}`, errorCode: null });
    }
    return result.data;
  }

  return {
    fetchMe() {
      return callMethod('getMe', encodeJson({}), UserSchema);
    },

    fetchUpdates({ offset, timeoutSeconds, limit, signal }) {
      return callMethod(
        'getUpdates',
        encodeJson({ offset, timeout: timeoutSeconds, ...(limit ? { limit } : {}), allowed_updates: ['message'] }),
        z.array(UpdateSchema),
        { signal, timeoutMs: timeoutSeconds * 1000 + LONG_POLL_GRACE_MS },
      );
    },

    async downloadFile(fileId) {
      const file = await callMethod('getFile', encodeJson({ file_id: fileId }), FileSchema);
      if (!file.file_path) {
        throw new TelegramApiError({ method: 'getFile', description: 'Telegram не дал путь к файлу', errorCode: null });
      }
      let response: Response;
      try {
        response = await fetchImpl(`${origin}/file/bot${options.token}/${file.file_path}`, {
          signal: AbortSignal.timeout(TELEGRAM_REQUEST_TIMEOUT_MS),
        });
      } catch (cause) {
        throw new TelegramApiError({ method: 'downloadFile', description: 'нет связи с Telegram', errorCode: null, cause });
      }
      if (!response.ok) {
        throw new TelegramApiError({ method: 'downloadFile', description: `HTTP ${response.status}`, errorCode: response.status });
      }
      return response.blob();
    },

    async sendMessage(message) {
      await callMethod(
        'sendMessage',
        encodeJson({ ...toReplyFields(message), text: message.html, link_preview_options: { is_disabled: true } }),
        z.unknown(),
      );
    },

    async sendPhoto(message) {
      const body = encodeMultipart(
        { ...toReplyFields(message), caption: message.html },
        { field: 'photo', filename: 'bottle.jpg', content: message.photo },
      );
      await callMethod('sendPhoto', body, z.unknown());
    },

    async sendChatAction(chatId, action) {
      await callMethod('sendChatAction', encodeJson({ chat_id: chatId, action }), z.unknown());
    },
  };
}
