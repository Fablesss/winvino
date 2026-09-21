import { describe, expect, it } from 'vitest';
import { FatalTelegramError, pollUpdates } from '../src/pollUpdates.ts';
import { TelegramApiError, type TelegramBotApi, type TelegramUpdate } from '../src/telegram/botApi.ts';

type FetchUpdatesCall = { offset: number; limit: number | undefined; isShutdownConfirm: boolean };
type FetchUpdatesStep = TelegramUpdate[] | Error;

const update = (updateId: number): TelegramUpdate => ({ update_id: updateId });
const networkError = () => new TelegramApiError({ method: 'getUpdates', description: 'нет связи с Telegram', errorCode: null });

/** Отдаёт шаги по очереди; шаги кончились — «останавливает бота», как SIGTERM посреди ожидания. */
function scriptedTelegram(steps: FetchUpdatesStep[]) {
  const shutdown = new AbortController();
  const calls: FetchUpdatesCall[] = [];
  const telegram: Pick<TelegramBotApi, 'fetchUpdates'> = {
    fetchUpdates: async ({ offset, limit, signal }) => {
      calls.push({ offset, limit, isShutdownConfirm: signal === undefined });
      if (signal === undefined) return [];
      const step = steps.shift();
      if (step === undefined) {
        shutdown.abort();
        throw new DOMException('aborted', 'AbortError');
      }
      if (step instanceof Error) throw step;
      return step;
    },
  };
  return { telegram, calls, signal: shutdown.signal };
}

async function runPolling(steps: FetchUpdatesStep[]) {
  const scripted = scriptedTelegram(steps);
  const handedOut: number[] = [];
  const sleeps: number[] = [];
  await pollUpdates({
    telegram: scripted.telegram,
    timeoutSeconds: 30,
    signal: scripted.signal,
    onUpdate: (handed) => handedOut.push(handed.update_id),
    log: () => {},
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { calls: scripted.calls, handedOut, sleeps };
}

describe('pollUpdates', () => {
  it('handsOutUpdatesAndConfirmsLastOffsetOnShutdown', async () => {
    const { calls, handedOut } = await runPolling([[update(10), update(11)], [update(12)]]);

    expect(handedOut).toEqual([10, 11, 12]);
    expect(calls).toEqual([
      { offset: 0, limit: undefined, isShutdownConfirm: false },
      { offset: 12, limit: undefined, isShutdownConfirm: false },
      { offset: 13, limit: undefined, isShutdownConfirm: false },
      { offset: 13, limit: 1, isShutdownConfirm: true },
    ]);
  });

  it('backsOffOnFailuresAndWaitsAsLongAsTelegramAsks', async () => {
    const tooManyRequests = new TelegramApiError({ method: 'getUpdates', description: 'Too Many Requests', errorCode: 429, retryAfterSeconds: 3 });
    const { sleeps, handedOut } = await runPolling([networkError(), tooManyRequests, networkError(), [update(5)], networkError()]);

    expect(sleeps).toEqual([1000, 3000, 4000, 1000]);
    expect(handedOut).toEqual([5]);
  });

  it('capsBackoffAtThirtySeconds', async () => {
    const { sleeps } = await runPolling(Array.from({ length: 8 }, networkError));
    expect(sleeps.at(-1)).toBe(30_000);
  });

  it('stopsOnRejectedToken', async () => {
    const unauthorized = new TelegramApiError({ method: 'getUpdates', description: 'Unauthorized', errorCode: 401 });
    await expect(runPolling([unauthorized])).rejects.toThrow(FatalTelegramError);
  });
});
