import { describe, expect, it } from 'vitest';
import { ApiConfigError, loadApiConfig } from '../src/config.ts';

describe('loadApiConfig', () => {
  it('startsWithMockAndOpenCorsByDefault', () => {
    expect(loadApiConfig({})).toMatchObject({ port: 8787, corsOrigins: '*', recognizer: 'mock', isAccessLogEnabled: true });
  });

  it('splitsCorsOriginList', () => {
    expect(loadApiConfig({ CORS_ORIGINS: 'https://a.test, https://b.test,' }).corsOrigins).toEqual(['https://a.test', 'https://b.test']);
  });

  it('namesTheBrokenVariable', () => {
    expect(() => loadApiConfig({ PORT: 'eighty' })).toThrow(ApiConfigError);
    expect(() => loadApiConfig({ RECOGNIZER: 'paddle' })).toThrow(/RECOGNIZER/);
  });

  it('requiresModelServiceAndDatabaseForModelRecognizer', () => {
    expect(() => loadApiConfig({ RECOGNIZER: 'model' })).toThrow(/RECOGNIZER_URL[\s\S]*DATABASE_URL/);
    expect(loadApiConfig({}).model).toBeNull();
  });

  it('readsModelThresholdsWithMetricBackedDefaults', () => {
    const env = { RECOGNIZER: 'model', RECOGNIZER_URL: 'http://recognizer:8080', DATABASE_URL: 'postgres://u:p@db/winvino' };
    expect(loadApiConfig(env).model).toMatchObject({
      url: 'http://recognizer:8080',
      thresholds: { matchedMinConfidence: 0.8, notInCatalogMaxVisual: 0.4, unreadableMaxOcrLetters: 3, maxAlternatives: 3 },
    });
    expect(loadApiConfig({ ...env, MODEL_MATCHED_MIN_CONFIDENCE: '0.9' }).model?.thresholds.matchedMinConfidence).toBe(0.9);
  });

  // Compose и Dokploy пишут незаданную переменную как `VAR=`; API не должен падать на старте.
  it('treatsEmptyVariableAsUnset', () => {
    const env = { SCAN_ARCHIVE: 'on', DATABASE_URL: 'postgres://u:p@db/winvino', MATCHER_VERSION: '', CORS_ORIGINS: '', RECOGNIZE_TIMEOUT_MS: '' };
    expect(loadApiConfig(env)).toMatchObject({ corsOrigins: '*', recognizeTimeoutMs: 30_000, scanArchive: { matcherVersion: null } });
  });

  it('keepsScanArchiveOffUntilAskedAndThenNeedsDatabase', () => {
    expect(loadApiConfig({}).scanArchive).toBeNull();
    expect(() => loadApiConfig({ SCAN_ARCHIVE: 'on' })).toThrow(/DATABASE_URL/);
    expect(loadApiConfig({ SCAN_ARCHIVE: 'on', DATABASE_URL: 'postgres://u:p@db/winvino' }).scanArchive).toEqual({
      dir: './data/scans',
      databaseUrl: 'postgres://u:p@db/winvino',
      matcherVersion: null,
    });
  });

  it('keepsAdminQueueOffUntilPasswordIsSet', () => {
    expect(loadApiConfig({}).admin).toBeNull();
    // Короткий пароль — это открытая наружу очередь: единственная защита от перебора тут длина.
    expect(() => loadApiConfig({ ADMIN_PASSWORD: 'korotkiy', DATABASE_URL: 'postgres://u:p@db/winvino' })).toThrow(/ADMIN_PASSWORD/);
    expect(() => loadApiConfig({ ADMIN_PASSWORD: 'razmetka-parol-12' })).toThrow(/DATABASE_URL/);
    expect(loadApiConfig({ ADMIN_PASSWORD: 'razmetka-parol-12', DATABASE_URL: 'postgres://u:p@db/winvino' }).admin).toEqual({
      password: 'razmetka-parol-12',
      databaseUrl: 'postgres://u:p@db/winvino',
      scansDir: './data/scans',
    });
  });
});
