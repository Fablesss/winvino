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
});
