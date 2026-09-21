import { MAX_IMAGE_BYTES, type NotFoundReason, type Recognition, type Wine, type WineCandidate } from '@winvino/contract';
import type { InlineKeyboardButton } from './telegram/botApi.ts';

/**
 * Тексты бота. Чистые функции: вход — ответ API или ошибка, выход — сообщение для чата.
 * Разметка — HTML Bot API, поэтому всё, что пришло извне, проходит через escapeHtml.
 */

export type BotReply = {
  html: string;
  /** Фото бутылки над текстом; null — только текст. */
  photoUrl: string | null;
  buttons: InlineKeyboardButton[][];
};

export type ReplyContext = {
  /** null — без кнопки Mini App: адрес не задан или чат не личный (web_app-кнопки Telegram пускает только в личку). */
  webAppUrl: string | null;
};

/** Что показать при сбое: сообщение уже для человека. */
export type ReplyFailure = { message: string; requestId: string | null };

const WEB_APP_BUTTON_LABEL = 'Открыть сканер';
const CATALOG_BUTTON_LABEL = 'Карточка в каталоге';

const HELP_HTML = [
  'Пришлите фото этикетки — расскажу, что за вино: винодельня, сорт, крепость и при какой температуре подавать.',
  '',
  'Снимайте этикетку крупно и без бликов. Пока узнаём российские вина из каталога vino-svoe.ru.',
].join('\n');

const NOT_FOUND_COPY: Record<NotFoundReason, { title: string; hint: string }> = {
  unreadable: {
    title: 'Не удалось прочитать этикетку',
    hint: 'Пришлите фото ближе и без бликов: текст этикетки должен быть чётким и занимать почти весь кадр.',
  },
  not_in_catalog: {
    title: 'Этого вина нет в каталоге',
    hint: 'Пока мы узнаём только российские вина из каталога vino-svoe.ru. Можно прислать другую бутылку.',
  },
};

const decimalFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function webAppButtons(context: ReplyContext): InlineKeyboardButton[][] {
  return context.webAppUrl ? [[{ text: WEB_APP_BUTTON_LABEL, web_app: { url: context.webAppUrl } }]] : [];
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)} %`;
}

function formatTemperatureRange({ min, max }: { min: number; max: number }): string {
  return min === max ? `${min} °C` : `${min}–${max} °C`;
}

/** «Бельбек, Крым» — кто и где сделал вино. */
function describeOrigin(wine: Wine): string | null {
  const parts = [wine.manufacturer?.name, wine.region?.name].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Строки фактов в порядке, в каком их ищут у полки. Пустые поля пропускаются. */
function listWineFacts(wine: Wine): string[] {
  const facts: Array<[label: string, value: string] | null> = [
    wine.grapes.length > 0 ? [wine.grapes.length > 1 ? 'Сорта' : 'Сорт', wine.grapes.join(', ')] : null,
    wine.vintage !== null ? ['Урожай', String(wine.vintage)] : null,
    wine.alcoholPercent !== null ? ['Крепость', `${decimalFormat.format(wine.alcoholPercent)} %`] : null,
    wine.servingTemperatureC !== null ? ['Подавать при', formatTemperatureRange(wine.servingTemperatureC)] : null,
  ];
  return facts.filter((fact) => fact !== null).map(([label, value]) => `${label}: ${escapeHtml(value)}`);
}

function describeWineCard(wine: Wine): string[] {
  const origin = describeOrigin(wine);
  const facts = listWineFacts(wine);
  return [
    `<b>${escapeHtml(wine.title)}</b>`,
    ...(origin ? [escapeHtml(origin)] : []),
    ...(wine.categoryLabel ? [escapeHtml(wine.categoryLabel)] : []),
    ...(facts.length > 0 ? ['', ...facts] : []),
  ];
}

function describeCandidateLine({ wine, confidence }: WineCandidate): string {
  const title = wine.catalogUrl ? `<a href="${escapeHtml(wine.catalogUrl)}">${escapeHtml(wine.title)}</a>` : escapeHtml(wine.title);
  const origin = describeOrigin(wine);
  return `• ${title}${origin ? ` — ${escapeHtml(origin)}` : ''} · ${formatConfidence(confidence)}`;
}

export function buildHelpReply(context: ReplyContext): BotReply {
  return { html: HELP_HTML, photoUrl: null, buttons: webAppButtons(context) };
}

/** matched и ambiguous — карточка лучшего кандидата; not_found — подсказка по reason. */
export function buildRecognitionReply(recognition: Recognition, context: ReplyContext): BotReply {
  if (recognition.status === 'not_found') {
    const copy = NOT_FOUND_COPY[recognition.reason];
    return { html: `<b>${copy.title}</b>\n${copy.hint}`, photoUrl: null, buttons: webAppButtons(context) };
  }

  const { match, alternatives } = recognition;
  const isAmbiguous = recognition.status === 'ambiguous';
  const lines = [
    ...(isAmbiguous ? [`Не уверены — похоже на это вино (${formatConfidence(match.confidence)}).`, ''] : []),
    ...describeWineCard(match.wine),
    ...(isAmbiguous ? [] : ['', `Совпадение ${formatConfidence(match.confidence)}`]),
    ...(alternatives.length > 0
      ? ['', isAmbiguous ? 'Если не оно — похожие вина:' : 'Не то вино?', ...alternatives.map(describeCandidateLine)]
      : []),
  ];
  const catalogButtons: InlineKeyboardButton[][] = match.wine.catalogUrl
    ? [[{ text: CATALOG_BUTTON_LABEL, url: match.wine.catalogUrl }]]
    : [];
  return { html: lines.join('\n'), photoUrl: match.wine.imageUrl, buttons: [...catalogButtons, ...webAppButtons(context)] };
}

/** Сообщение ошибки API уже по-русски и годится для показа; номер запроса — чтобы найти его в логах. */
export function buildFailureReply(failure: ReplyFailure, context: ReplyContext): BotReply {
  const lines = [
    '<b>Не получилось распознать</b>',
    escapeHtml(failure.message),
    ...(failure.requestId ? ['', `Номер запроса для поддержки: <code>${escapeHtml(failure.requestId)}</code>`] : []),
  ];
  return { html: lines.join('\n'), photoUrl: null, buttons: webAppButtons(context) };
}

export function buildFileTooLargeReply(): BotReply {
  const limitMb = MAX_IMAGE_BYTES / 1024 / 1024;
  return {
    html: `Файл больше ${limitMb} МБ. Пришлите этикетку как фото, а не файлом — Telegram сам его сожмёт.`,
    photoUrl: null,
    buttons: [],
  };
}
