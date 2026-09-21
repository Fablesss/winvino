import { createWinvinoClient, REQUEST_ID_HEADER, WinvinoApiError } from '@winvino/contract';
import { describeError, type BotLogger } from './log.ts';
import { pickLabelFile, type LabelFile } from './pickLabelFile.ts';
import {
  buildFailureReply,
  buildFileTooLargeReply,
  buildHelpReply,
  buildRecognitionReply,
  type BotReply,
  type ReplyContext,
} from './replies.ts';
import type { OutgoingMessage, TelegramBotApi, TelegramMessage, TelegramUpdate } from './telegram/botApi.ts';

/** Telegram показывает «печатает…» 5 секунд — повторяем чуть чаще, пока идёт распознавание. */
const CHAT_ACTION_REPEAT_MS = 4_500;
/** Лимит подписи к фото. HTML не короче видимого текста, так что проверка по нему — с запасом. */
const TELEGRAM_CAPTION_MAX_CHARS = 1024;

const PHOTO_DOWNLOAD_FAILED_MESSAGE = 'Не удалось получить фото из Telegram. Пришлите его ещё раз.';
const UNEXPECTED_FAILURE_MESSAGE = 'Что-то пошло не так. Попробуйте ещё раз.';

export type UpdateHandlerDeps = {
  telegram: TelegramBotApi;
  apiBaseUrl: string;
  /** fetch для API распознавания; по умолчанию глобальный. */
  apiFetch?: typeof fetch;
  webAppUrl: string | null;
  loadBottlePhoto: (imageUrl: string) => Promise<Blob>;
  log: BotLogger;
};

type UpdateScope = { updateId: number; message: TelegramMessage; context: ReplyContext; deps: UpdateHandlerDeps };

/** Ответ на одно сообщение. Не бросает: сбой уходит в лог, а пользователю — понятный текст. */
export async function handleUpdate(update: TelegramUpdate, deps: UpdateHandlerDeps): Promise<void> {
  const message = update.message;
  if (!message) return;
  const scope: UpdateScope = {
    updateId: update.update_id,
    message,
    context: { webAppUrl: message.chat.type === 'private' ? deps.webAppUrl : null },
    deps,
  };

  let reply: BotReply;
  try {
    reply = await buildReplyToMessage(scope);
  } catch (error) {
    deps.log('update_failed', { updateId: scope.updateId, message: describeError(error) });
    reply = buildFailureReply({ message: UNEXPECTED_FAILURE_MESSAGE, requestId: String(scope.updateId) }, scope.context);
  }

  try {
    await sendReply(scope, reply);
  } catch (error) {
    deps.log('reply_failed', { updateId: scope.updateId, message: describeError(error) });
  }
}

async function buildReplyToMessage(scope: UpdateScope): Promise<BotReply> {
  const labelFile = pickLabelFile(scope.message);
  switch (labelFile.kind) {
    case 'none':
      return buildHelpReply(scope.context);
    case 'too_large':
      return buildFileTooLargeReply();
    case 'file':
      return recognizeLabelFile(scope, labelFile);
  }
}

async function recognizeLabelFile(scope: UpdateScope, labelFile: Extract<LabelFile, { kind: 'file' }>): Promise<BotReply> {
  const { updateId, context, deps } = scope;
  const requestId = String(updateId);
  const stopTyping = keepShowingTyping(scope);
  try {
    let image: Blob;
    try {
      image = await deps.telegram.downloadFile(labelFile.fileId);
    } catch (error) {
      deps.log('photo_download_failed', { updateId, message: describeError(error) });
      return buildFailureReply({ message: PHOTO_DOWNLOAD_FAILED_MESSAGE, requestId }, context);
    }

    // Клиент на каждый апдейт — ради X-Request-Id: по id апдейта запрос ищется и в логах API, и в логах бота.
    const client = createWinvinoClient({ baseUrl: deps.apiBaseUrl, fetch: deps.apiFetch, headers: { [REQUEST_ID_HEADER]: requestId } });
    try {
      const recognition = await client.recognizeLabel(image, { filename: labelFile.filename });
      deps.log('recognized', {
        updateId,
        status: recognition.status,
        reason: recognition.reason,
        slug: recognition.match?.wine.slug ?? null,
        confidence: recognition.match?.confidence ?? null,
        processingMs: recognition.processingMs,
      });
      return buildRecognitionReply(recognition, context);
    } catch (error) {
      if (!(error instanceof WinvinoApiError)) throw error;
      deps.log('recognition_failed', { updateId, code: error.code, httpStatus: error.httpStatus });
      return buildFailureReply({ message: error.message, requestId: error.requestId ?? requestId }, context);
    }
  } finally {
    stopTyping();
  }
}

function keepShowingTyping({ updateId, message, deps }: UpdateScope): () => void {
  const sendTyping = () => {
    void deps.telegram.sendChatAction(message.chat.id, 'typing').catch((error: unknown) => {
      deps.log('chat_action_failed', { updateId, message: describeError(error) });
    });
  };
  sendTyping();
  const timer = setInterval(sendTyping, CHAT_ACTION_REPEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
}

/** С фото бутылки, если его удалось подготовить и Telegram его принял; иначе та же карточка текстом. */
async function sendReply({ updateId, message, deps }: UpdateScope, reply: BotReply): Promise<void> {
  const outgoing: OutgoingMessage = {
    chatId: message.chat.id,
    html: reply.html,
    buttons: reply.buttons,
    replyToMessageId: message.message_id,
  };

  if (reply.photoUrl && reply.html.length <= TELEGRAM_CAPTION_MAX_CHARS) {
    try {
      const photo = await deps.loadBottlePhoto(reply.photoUrl);
      await deps.telegram.sendPhoto({ ...outgoing, photo });
      return;
    } catch (error) {
      deps.log('bottle_photo_failed', { updateId, message: describeError(error) });
    }
  }
  await deps.telegram.sendMessage(outgoing);
}
