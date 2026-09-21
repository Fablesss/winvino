import { API_ROUTES } from '@winvino/contract';
import { describe, expect, it } from 'vitest';
import { handleUpdate, type UpdateHandlerDeps } from '../src/handleUpdate.ts';
import {
  TelegramApiError,
  type OutgoingMessage,
  type TelegramBotApi,
  type TelegramMessage,
  type TelegramUpdate,
} from '../src/telegram/botApi.ts';
import { sampleAmbiguous, sampleMatched, sampleUnreadable, sampleWine } from './sampleRecognition.ts';

const API_BASE_URL = 'https://api.winvino.test';
const WEB_APP_URL = 'https://winvino.test';
const UPDATE_ID = 700123;
const LABEL_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

type SentReply = { method: 'sendMessage' | 'sendPhoto'; message: OutgoingMessage; photo?: Blob };
type ApiRequest = { url: string; requestId: string | null; image: unknown };

function createHarness(options: { apiResponse?: () => Response | Promise<Response>; telegram?: Partial<TelegramBotApi>; loadBottlePhoto?: UpdateHandlerDeps['loadBottlePhoto'] } = {}) {
  const sent: SentReply[] = [];
  const downloadedFileIds: string[] = [];
  const apiRequests: ApiRequest[] = [];
  const logEvents: string[] = [];

  const telegram: TelegramBotApi = {
    fetchMe: async () => ({ id: 1, username: 'winvino_bot' }),
    fetchUpdates: async () => [],
    downloadFile: async (fileId) => {
      downloadedFileIds.push(fileId);
      return new Blob([LABEL_BYTES], { type: 'image/jpeg' });
    },
    sendMessage: async (message) => {
      sent.push({ method: 'sendMessage', message });
    },
    sendPhoto: async ({ photo, ...message }) => {
      sent.push({ method: 'sendPhoto', message, photo });
    },
    sendChatAction: async () => {},
    ...options.telegram,
  };

  const apiFetch: typeof fetch = async (input, init) => {
    const body = init?.body instanceof FormData ? init.body : null;
    apiRequests.push({ url: String(input), requestId: new Headers(init?.headers).get('X-Request-Id'), image: body?.get('image') ?? null });
    return (options.apiResponse ?? (() => jsonResponse(200, sampleMatched)))();
  };

  const deps: UpdateHandlerDeps = {
    telegram,
    apiBaseUrl: API_BASE_URL,
    apiFetch,
    webAppUrl: WEB_APP_URL,
    loadBottlePhoto: options.loadBottlePhoto ?? (async () => new Blob([new Uint8Array([1])], { type: 'image/jpeg' })),
    log: (event) => logEvents.push(event),
  };
  return { deps, sent, downloadedFileIds, apiRequests, logEvents };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function messageUpdate(message: Partial<TelegramMessage>): TelegramUpdate {
  return { update_id: UPDATE_ID, message: { message_id: 42, chat: { id: 555, type: 'private' }, ...message } };
}

const photoUpdate = messageUpdate({
  photo: [
    { file_id: 'thumb', width: 90, height: 120 },
    { file_id: 'fits-1600', width: 960, height: 1280 },
    { file_id: 'original', width: 1920, height: 2560 },
  ],
});

function onlyReply(sent: SentReply[]): SentReply {
  expect(sent).toHaveLength(1);
  return sent[0]!;
}

describe('handleUpdate: фото этикетки', () => {
  it('sendsLabelToApiWithUpdateIdAsRequestIdAndRepliesWithBottleCard', async () => {
    const harness = createHarness();

    await handleUpdate(photoUpdate, harness.deps);

    expect(harness.downloadedFileIds).toEqual(['fits-1600']);
    expect(harness.apiRequests).toEqual([
      { url: `${API_BASE_URL}${API_ROUTES.recognitions}`, requestId: String(UPDATE_ID), image: expect.any(Blob) },
    ]);
    const reply = onlyReply(harness.sent);
    expect(reply.method).toBe('sendPhoto');
    expect(reply.photo?.type).toBe('image/jpeg');
    expect(reply.message).toMatchObject({ chatId: 555, replyToMessageId: 42 });
    expect(reply.message.html).toContain('<b>Бельбек Рислинг Резерв</b>');
    expect(reply.message.buttons).toEqual([
      [{ text: 'Карточка в каталоге', url: sampleWine.catalogUrl }],
      [{ text: 'Открыть сканер', web_app: { url: WEB_APP_URL } }],
    ]);
  });

  it('ambiguousAnswerKeepsBottlePhotoAndSimilarWines', async () => {
    const harness = createHarness({ apiResponse: () => jsonResponse(200, sampleAmbiguous) });
    await handleUpdate(photoUpdate, harness.deps);

    const reply = onlyReply(harness.sent);
    expect(reply.method).toBe('sendPhoto');
    expect(reply.message.html).toMatch(/^Не уверены — похоже на это вино \(64 %\)/);
    expect(reply.message.html).toContain('Если не оно — похожие вина:');
  });

  it('notFoundAsksToRetakeAsPlainText', async () => {
    const harness = createHarness({ apiResponse: () => jsonResponse(200, sampleUnreadable) });
    await handleUpdate(photoUpdate, harness.deps);

    const reply = onlyReply(harness.sent);
    expect(reply.method).toBe('sendMessage');
    expect(reply.message.html).toMatch(/^<b>Не удалось прочитать этикетку<\/b>\nПришлите фото ближе/);
  });

  it('showsApiErrorMessageAndItsRequestId', async () => {
    const harness = createHarness({
      apiResponse: () =>
        jsonResponse(422, { error: { code: 'IMAGE_TOO_SMALL', message: 'Фото слишком маленькое — снимите этикетку крупнее.', requestId: '700123' } }),
    });
    await handleUpdate(photoUpdate, harness.deps);

    const reply = onlyReply(harness.sent);
    expect(reply.message.html).toBe(
      '<b>Не получилось распознать</b>\nФото слишком маленькое — снимите этикетку крупнее.\n\n' +
        'Номер запроса для поддержки: <code>700123</code>',
    );
    expect(harness.logEvents).toContain('recognition_failed');
  });

  it('answerBreakingContractBecomesClientMessageNotCrash', async () => {
    const harness = createHarness({ apiResponse: () => jsonResponse(200, { ...sampleMatched, status: 'maybe' }) });
    await handleUpdate(photoUpdate, harness.deps);

    expect(onlyReply(harness.sent).message.html).toContain('Сервер ответил в неожиданном формате');
  });

  it('unreachableApiBecomesNetworkMessage', async () => {
    const harness = createHarness({ apiResponse: () => Promise.reject(new TypeError('fetch failed')) });
    await handleUpdate(photoUpdate, harness.deps);

    expect(onlyReply(harness.sent).message.html).toContain('Нет связи с сервером');
  });

  it('fallsBackToTextCardWhenBottlePhotoCannotBePrepared', async () => {
    const harness = createHarness({
      loadBottlePhoto: async () => {
        throw new Error('фото бутылки не скачалось: HTTP 404');
      },
    });
    await handleUpdate(photoUpdate, harness.deps);

    const reply = onlyReply(harness.sent);
    expect(reply.method).toBe('sendMessage');
    expect(reply.message.html).toContain('<b>Бельбек Рислинг Резерв</b>');
    expect(harness.logEvents).toContain('bottle_photo_failed');
  });

  it('fallsBackToTextCardWhenTelegramRejectsPhoto', async () => {
    const harness = createHarness({
      telegram: {
        sendPhoto: async () => {
          throw new TelegramApiError({ method: 'sendPhoto', description: 'Bad Request: IMAGE_PROCESS_FAILED', errorCode: 400 });
        },
      },
    });
    await handleUpdate(photoUpdate, harness.deps);

    expect(onlyReply(harness.sent).method).toBe('sendMessage');
  });

  it('asksToResendWhenTelegramFileDownloadFails', async () => {
    const harness = createHarness({
      telegram: {
        downloadFile: async () => {
          throw new TelegramApiError({ method: 'getFile', description: 'Bad Request: file is too big', errorCode: 400 });
        },
      },
    });
    await handleUpdate(photoUpdate, harness.deps);

    expect(harness.apiRequests).toEqual([]);
    expect(onlyReply(harness.sent).message.html).toContain('Не удалось получить фото из Telegram. Пришлите его ещё раз.');
  });

  it('acceptsImageSentAsFile', async () => {
    const harness = createHarness();
    await handleUpdate(messageUpdate({ document: { file_id: 'doc', file_name: 'IMG_0042.png', mime_type: 'image/png', file_size: 2_000_000 } }), harness.deps);

    expect(harness.downloadedFileIds).toEqual(['doc']);
    expect(onlyReply(harness.sent).method).toBe('sendPhoto');
  });
});

describe('handleUpdate: не фото', () => {
  it('textGetsHelpWithMiniAppButton', async () => {
    const harness = createHarness();
    await handleUpdate(messageUpdate({ text: '/start' }), harness.deps);

    expect(harness.apiRequests).toEqual([]);
    const reply = onlyReply(harness.sent);
    expect(reply.message.html).toMatch(/^Пришлите фото этикетки/);
    expect(reply.message.buttons).toEqual([[{ text: 'Открыть сканер', web_app: { url: WEB_APP_URL } }]]);
  });

  it('groupChatGetsNoMiniAppButton', async () => {
    const harness = createHarness();
    await handleUpdate(messageUpdate({ text: 'что за вино?', chat: { id: -100, type: 'supergroup' } }), harness.deps);

    expect(onlyReply(harness.sent).message.buttons).toEqual([]);
  });

  it('imageFileOverApiLimitIsRefusedWithoutDownload', async () => {
    const harness = createHarness();
    await handleUpdate(messageUpdate({ document: { file_id: 'raw', mime_type: 'image/jpeg', file_size: 15 * 1024 * 1024 } }), harness.deps);

    expect(harness.downloadedFileIds).toEqual([]);
    expect(onlyReply(harness.sent).message.html).toMatch(/^Файл больше 10 МБ/);
  });

  it('ignoresUpdatesWithoutMessage', async () => {
    const harness = createHarness();
    await handleUpdate({ update_id: UPDATE_ID }, harness.deps);
    expect(harness.sent).toEqual([]);
  });

  it('survivesTelegramRefusingTheReply', async () => {
    const harness = createHarness({
      telegram: {
        sendMessage: async () => {
          throw new TelegramApiError({ method: 'sendMessage', description: 'Forbidden: bot was blocked by the user', errorCode: 403 });
        },
      },
    });
    await expect(handleUpdate(messageUpdate({ text: 'привет' }), harness.deps)).resolves.toBeUndefined();
    expect(harness.logEvents).toContain('reply_failed');
  });
});
