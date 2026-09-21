import { describe, expect, it } from 'vitest';
import { BotConfigError, loadBotConfig } from '../src/config.ts';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

describe('loadBotConfig', () => {
  it('needsOnlyTokenAndDefaultsToLocalApiWithoutMiniApp', () => {
    expect(loadBotConfig({ TELEGRAM_BOT_TOKEN: TOKEN })).toEqual({
      telegramBotToken: TOKEN,
      telegramApiOrigin: 'https://api.telegram.org',
      apiBaseUrl: 'http://127.0.0.1:8787',
      webAppUrl: null,
      pollTimeoutSeconds: 30,
    });
  });

  it('dropsTrailingSlashOfApiUrl', () => {
    expect(loadBotConfig({ TELEGRAM_BOT_TOKEN: TOKEN, WINVINO_API_URL: 'http://api:8787/' }).apiBaseUrl).toBe('http://api:8787');
  });

  it('treatsEmptyWebAppUrlFromComposeAsMissing', () => {
    expect(loadBotConfig({ TELEGRAM_BOT_TOKEN: TOKEN, WEB_APP_URL: '' }).webAppUrl).toBeNull();
  });

  it('requiresHttpsForMiniApp', () => {
    expect(() => loadBotConfig({ TELEGRAM_BOT_TOKEN: TOKEN, WEB_APP_URL: 'http://winvino.test' })).toThrow(/WEB_APP_URL: нужен HTTPS/);
    expect(loadBotConfig({ TELEGRAM_BOT_TOKEN: TOKEN, WEB_APP_URL: 'https://winvino.test' }).webAppUrl).toBe('https://winvino.test');
  });

  it('namesMissingTokenWithoutEchoingBrokenOne', () => {
    expect(() => loadBotConfig({})).toThrow(BotConfigError);
    expect(() => loadBotConfig({})).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() => loadBotConfig({ TELEGRAM_BOT_TOKEN: 'secret-but-malformed' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secret-but-malformed') }),
    );
  });
});
