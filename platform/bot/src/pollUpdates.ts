import { setTimeout as sleepFor } from 'node:timers/promises';
import { describeError, type BotLogger } from './log.ts';
import { TelegramApiError, type TelegramBotApi, type TelegramUpdate } from './telegram/botApi.ts';

const RETRY_DELAY_MIN_MS = 1_000;
const RETRY_DELAY_MAX_MS = 30_000;
/** Токен отозван или неверен — повторять бессмысленно. */
const FATAL_ERROR_CODES: ReadonlySet<number> = new Set([401, 404]);

export type PollUpdatesOptions = {
  telegram: Pick<TelegramBotApi, 'fetchUpdates'>;
  timeoutSeconds: number;
  signal: AbortSignal;
  /** Вызывается без ожидания: апдейты обрабатываются параллельно, опрос не ждёт распознавания. */
  onUpdate: (update: TelegramUpdate) => void;
  log: BotLogger;
  /** Пауза перед повтором; в тестах — мгновенная. Прерывается signal. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export class FatalTelegramError extends Error {
  constructor(cause: TelegramApiError) {
    super(`Telegram отклонил токен бота (${cause.message}) — проверьте TELEGRAM_BOT_TOKEN`, { cause });
    this.name = 'FatalTelegramError';
  }
}

async function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  await sleepFor(ms, undefined, { signal }).catch(() => undefined);
}

/** 429 — сколько просит Telegram; прочие сбои — растущая пауза 1 → 30 с. */
function retryDelayMs(error: unknown, consecutiveFailures: number): number {
  if (error instanceof TelegramApiError && error.retryAfterSeconds !== null) return error.retryAfterSeconds * 1000;
  return Math.min(RETRY_DELAY_MIN_MS * 2 ** (consecutiveFailures - 1), RETRY_DELAY_MAX_MS);
}

/**
 * Long polling getUpdates, пока не отменят signal. Апдейт подтверждается следующим запросом
 * с offset больше его id, то есть сразу после выдачи в onUpdate: упадёт процесс посреди
 * распознавания — это фото потеряется, а не придёт повторно (at-most-once).
 * Бросает только FatalTelegramError.
 */
export async function pollUpdates(options: PollUpdatesOptions): Promise<void> {
  const { telegram, timeoutSeconds, signal, onUpdate, log } = options;
  const sleep = options.sleep ?? sleepUnlessAborted;
  let offset = 0;
  let consecutiveFailures = 0;

  while (!signal.aborted) {
    let updates: TelegramUpdate[];
    try {
      updates = await telegram.fetchUpdates({ offset, timeoutSeconds, signal });
    } catch (error) {
      if (signal.aborted) break;
      if (error instanceof TelegramApiError && error.errorCode !== null && FATAL_ERROR_CODES.has(error.errorCode)) {
        throw new FatalTelegramError(error);
      }
      consecutiveFailures += 1;
      const delayMs = retryDelayMs(error, consecutiveFailures);
      // 409 Conflict — второй экземпляр бота или настроенный webhook: Telegram пишет это в description.
      log('poll_failed', { message: describeError(error), retryInMs: delayMs });
      await sleep(delayMs, signal);
      continue;
    }

    consecutiveFailures = 0;
    for (const update of updates) {
      offset = update.update_id + 1;
      onUpdate(update);
    }
  }

  await confirmHandedOutUpdates(options, offset);
}

/** Без этого выданные в последней пачке апдейты придут повторно после перезапуска. */
async function confirmHandedOutUpdates({ telegram, log }: PollUpdatesOptions, offset: number): Promise<void> {
  if (offset === 0) return;
  try {
    await telegram.fetchUpdates({ offset, timeoutSeconds: 0, limit: 1 });
  } catch (error) {
    log('confirm_updates_failed', { offset, message: describeError(error) });
  }
}
