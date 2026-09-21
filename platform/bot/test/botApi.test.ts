import { describe, expect, it } from 'vitest';
import { createTelegramBotApi, TelegramApiError } from '../src/telegram/botApi.ts';

const TOKEN = '123:abc';
const ORIGIN = 'https://telegram.test';

type RecordedCall = { url: string; init: RequestInit | undefined };

function fakeTelegram(respond: (url: string) => Response) {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return respond(String(input));
  };
  return { api: createTelegramBotApi({ token: TOKEN, fetch: fetchImpl, apiOrigin: ORIGIN }), calls };
}

const okResponse = (result: unknown) => Response.json({ ok: true, result });

const outgoing = { chatId: 555, html: '<b>Вино</b>', buttons: [[{ text: 'Каталог', url: 'https://vino.test' }]], replyToMessageId: 42 };

describe('createTelegramBotApi', () => {
  it('sendsPhotoAsMultipartWithHtmlCaptionAndKeyboard', async () => {
    const telegram = fakeTelegram(() => okResponse({ message_id: 43 }));

    await telegram.api.sendPhoto({ ...outgoing, html: '<b>Вино</b>\nКрым', photo: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }) });

    const call = telegram.calls[0];
    expect(call?.url).toBe(`${ORIGIN}/bot${TOKEN}/sendPhoto`);
    // Разбираем то, что уйдёт по сети, а не объект в памяти.
    const form = await new Request(call?.url ?? '', { method: 'POST', body: call?.init?.body, headers: call?.init?.headers }).formData();
    expect(form.get('chat_id')).toBe('555');
    // Переводы строк подписи доходят как \n: FormData из undici превратил бы их в \r\n.
    expect(form.get('caption')).toBe('<b>Вино</b>\nКрым');
    expect(form.get('parse_mode')).toBe('HTML');
    expect(JSON.parse(String(form.get('reply_markup')))).toEqual({ inline_keyboard: outgoing.buttons });
    expect(JSON.parse(String(form.get('reply_parameters')))).toEqual({ message_id: 42, allow_sending_without_reply: true });
    expect(form.get('photo')).toBeInstanceOf(Blob);
  });

  it('sendsTextWithoutLinkPreviewAndWithoutEmptyKeyboard', async () => {
    const telegram = fakeTelegram(() => okResponse({ message_id: 43 }));

    await telegram.api.sendMessage({ ...outgoing, buttons: [] });

    const body = JSON.parse(String(telegram.calls[0]?.init?.body));
    expect(body).toMatchObject({ chat_id: 555, text: '<b>Вино</b>', parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    expect(body).not.toHaveProperty('reply_markup');
  });

  it('turnsErrorEnvelopeIntoTypedErrorWithRetryAfter', async () => {
    const telegram = fakeTelegram(() =>
      Response.json({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 7', parameters: { retry_after: 7 } }, { status: 429 }),
    );

    const error = await telegram.api.sendChatAction(1, 'typing').catch((rejection: unknown) => rejection);

    expect(error).toBeInstanceOf(TelegramApiError);
    expect(error).toMatchObject({ method: 'sendChatAction', errorCode: 429, retryAfterSeconds: 7 });
  });

  it('keepsUpdateIdWhenMessageIsMalformed', async () => {
    const telegram = fakeTelegram(() =>
      okResponse([
        { update_id: 1, message: { message_id: 'broken' } },
        { update_id: 2, message: { message_id: 7, chat: { id: 5, type: 'private' }, text: 'привет' } },
        { update_id: 3, edited_message: {} },
      ]),
    );

    const updates = await telegram.api.fetchUpdates({ offset: 0, timeoutSeconds: 30 });

    expect(updates).toEqual([
      { update_id: 1, message: undefined },
      { update_id: 2, message: { message_id: 7, chat: { id: 5, type: 'private' }, text: 'привет' } },
      { update_id: 3 },
    ]);
    expect(JSON.parse(String(telegram.calls[0]?.init?.body))).toMatchObject({ offset: 0, timeout: 30, allowed_updates: ['message'] });
  });

  it('downloadsFileByPathFromGetFile', async () => {
    const telegram = fakeTelegram((url) =>
      url.endsWith('/getFile') ? okResponse({ file_id: 'f', file_path: 'photos/file_1.jpg' }) : new Response(new Uint8Array([0xff, 0xd8])),
    );

    const file = await telegram.api.downloadFile('f');

    expect(telegram.calls.map((call) => call.url)).toEqual([`${ORIGIN}/bot${TOKEN}/getFile`, `${ORIGIN}/file/bot${TOKEN}/photos/file_1.jpg`]);
    expect(file.size).toBe(2);
  });

  it('reportsUnreachableTelegramAsNetworkError', async () => {
    const api = createTelegramBotApi({ token: TOKEN, apiOrigin: ORIGIN, fetch: () => Promise.reject(new TypeError('fetch failed')) });
    await expect(api.fetchMe()).rejects.toMatchObject({ name: 'TelegramApiError', errorCode: null, message: 'getMe: нет связи с Telegram' });
  });
});
