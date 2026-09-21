import type { Recognition } from '@winvino/contract';
import type { InspectedImage } from '../image/inspectImage.ts';

type RecognitionMetaKey = 'id' | 'processingMs' | 'createdAt';

/** Что решает распознаватель. id, время и дату ставит API — у всех реализаций одинаково. */
export type RecognitionOutcome = Recognition extends infer Variant
  ? Variant extends Recognition
    ? Omit<Variant, RecognitionMetaKey>
    : never
  : never;

/**
 * Точка замены мока настоящей моделью: новая реализация этого типа + ветка в
 * createRecognizer (server.ts). Контракт и клиенты при этом не меняются.
 *
 * signal срабатывает по таймауту API или при обрыве клиента — тяжёлую работу стоит бросить.
 */
export type Recognizer = {
  name: string;
  recognizeLabel(image: InspectedImage, signal: AbortSignal): Promise<RecognitionOutcome>;
};

/** Распознаватель не может ответить сейчас (модель не поднята, таймаут). Клиент получит 503. */
export class RecognizerUnavailableError extends Error {
  readonly code = 'RECOGNIZER_UNAVAILABLE';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RecognizerUnavailableError';
  }
}
