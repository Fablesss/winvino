import { randomUUID } from 'node:crypto';
import { MAX_IMAGE_BYTES, RECOGNITION_IMAGE_FIELD, RecognitionSchema } from '@winvino/contract';
import type { Context } from 'hono';
import { respondWithApiError } from './apiError.ts';
import { inspectImage, type InspectedImage } from './image/inspectImage.ts';
import { RecognizerUnavailableError, type RecognitionOutcome, type Recognizer } from './recognizer/recognizer.ts';

/** Запас на multipart-обёртку сверх самого файла: границы, заголовки частей. */
export const MULTIPART_ENVELOPE_BYTES = 64 * 1024;

/** Гонка распознавателя с таймаутом API и обрывом клиента: зависшая модель не держит запрос вечно. */
async function recognizeWithDeadline(
  recognizer: Recognizer,
  image: InspectedImage,
  timeoutMs: number,
  clientSignal: AbortSignal,
): Promise<RecognitionOutcome> {
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), clientSignal]);
  const deadline = new Promise<never>((_, reject) => {
    const rejectAsUnavailable = () =>
      reject(new RecognizerUnavailableError(`распознаватель ${recognizer.name} не ответил за ${timeoutMs} мс`));
    if (signal.aborted) rejectAsUnavailable();
    signal.addEventListener('abort', rejectAsUnavailable, { once: true });
  });
  return Promise.race([recognizer.recognizeLabel(image, signal), deadline]);
}

export function createRecognizeHandler(deps: { recognizer: Recognizer; recognizeTimeoutMs: number }) {
  return async function handleRecognize(c: Context): Promise<Response> {
    const contentType = c.req.header('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('multipart/form-data')) {
      return respondWithApiError(c, 'INVALID_REQUEST', { details: { receivedContentType: contentType || null } });
    }

    let form: Record<string, string | File>;
    try {
      form = await c.req.parseBody();
    } catch {
      return respondWithApiError(c, 'INVALID_REQUEST', { message: 'Не удалось разобрать multipart/form-data.' });
    }

    const file = form[RECOGNITION_IMAGE_FIELD];
    if (!(file instanceof File)) return respondWithApiError(c, 'IMAGE_REQUIRED');
    if (file.size > MAX_IMAGE_BYTES) {
      return respondWithApiError(c, 'IMAGE_TOO_LARGE', { details: { maxBytes: MAX_IMAGE_BYTES, receivedBytes: file.size } });
    }

    const inspection = await inspectImage(new Uint8Array(await file.arrayBuffer()));
    if (!inspection.ok) return respondWithApiError(c, inspection.rejection.code, inspection.rejection);

    const startedAt = performance.now();
    let outcome: RecognitionOutcome;
    try {
      outcome = await recognizeWithDeadline(deps.recognizer, inspection.image, deps.recognizeTimeoutMs, c.req.raw.signal);
    } catch (error) {
      if (!(error instanceof RecognizerUnavailableError)) throw error;
      console.error(JSON.stringify({ event: 'recognizer_unavailable', requestId: c.get('requestId'), message: error.message }));
      return respondWithApiError(c, 'RECOGNIZER_UNAVAILABLE');
    }

    // Распознаватель — граница: мок сегодня, Python-модель завтра. Кривой ответ не уходит
    // четырём клиентам, а становится 500 с понятной записью в логе.
    const recognition = RecognitionSchema.safeParse({
      ...outcome,
      id: randomUUID(),
      processingMs: Math.round(performance.now() - startedAt),
      createdAt: new Date().toISOString(),
    });
    if (!recognition.success) {
      console.error(
        JSON.stringify({ event: 'recognizer_contract_violation', requestId: c.get('requestId'), recognizer: deps.recognizer.name, issues: recognition.error.issues }),
      );
      return respondWithApiError(c, 'INTERNAL_ERROR');
    }
    return c.json(recognition.data);
  };
}
