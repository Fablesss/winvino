import { fetchBottlePhotoJpeg } from './bottlePhoto.ts';
import { loadBotConfig } from './config.ts';
import { handleUpdate, type UpdateHandlerDeps } from './handleUpdate.ts';
import { describeError, logJsonLine } from './log.ts';
import { pollUpdates } from './pollUpdates.ts';
import { createTelegramBotApi } from './telegram/botApi.ts';

/** Столько ждём недоделанные ответы при остановке; docker stop даёт 10 с до SIGKILL. */
const SHUTDOWN_GRACE_MS = 8_000;

const config = loadBotConfig(process.env);
const telegram = createTelegramBotApi({ token: config.telegramBotToken, apiOrigin: config.telegramApiOrigin });
const deps: UpdateHandlerDeps = {
  telegram,
  apiBaseUrl: config.apiBaseUrl,
  webAppUrl: config.webAppUrl,
  loadBottlePhoto: (imageUrl) => fetchBottlePhotoJpeg(imageUrl),
  log: logJsonLine,
};

try {
  const me = await telegram.fetchMe();
  logJsonLine('bot_started', { username: me.username ?? null, apiBaseUrl: config.apiBaseUrl, webAppUrl: config.webAppUrl });
} catch (error) {
  logJsonLine('bot_stopped', { message: `Telegram не принял токен или недоступен: ${describeError(error)}` });
  process.exit(1);
}

const shutdown = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => shutdown.abort());
}

const updatesInFlight = new Set<Promise<void>>();
try {
  await pollUpdates({
    telegram,
    timeoutSeconds: config.pollTimeoutSeconds,
    signal: shutdown.signal,
    log: logJsonLine,
    onUpdate: (update) => {
      const handling = handleUpdate(update, deps).finally(() => updatesInFlight.delete(handling));
      updatesInFlight.add(handling);
    },
  });
} catch (error) {
  logJsonLine('bot_stopped', { message: describeError(error) });
  process.exit(1);
}

await Promise.race([Promise.allSettled(updatesInFlight), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS).unref())]);
logJsonLine('bot_stopped', { unfinishedUpdates: updatesInFlight.size });
process.exit(0);
