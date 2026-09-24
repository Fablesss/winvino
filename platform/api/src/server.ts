import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createCatalogStore, createPgCatalogLoader } from './catalog/catalogStore.ts';
import { loadApiConfig, type ApiConfig } from './config.ts';
import { createMockRecognizer } from './recognizer/mockRecognizer.ts';
import { createModelRecognizer } from './recognizer/modelRecognizer.ts';
import type { Recognizer } from './recognizer/recognizer.ts';
import { createScanArchive, type ScanArchive } from './scans/scanArchive.ts';
import { createFileScanStore, createPgScanWriter } from './scans/scanStorage.ts';

/** Распознаватель и то, что нужно закрыть при остановке. */
function createRecognizer(config: ApiConfig): { recognizer: Recognizer; close: () => Promise<void> } {
  switch (config.recognizer) {
    case 'mock':
      return { recognizer: createMockRecognizer({ delayMs: config.mockRecognizerDelayMs }), close: async () => {} };
    case 'model': {
      if (!config.model) throw new Error('RECOGNIZER=model без RECOGNIZER_URL/DATABASE_URL — loadApiConfig должен был это отклонить');
      const loader = createPgCatalogLoader(config.model.databaseUrl);
      const catalog = createCatalogStore({ load: loader.load, refreshMs: config.model.catalogRefreshMs });
      return {
        recognizer: createModelRecognizer({ url: config.model.url, catalog, thresholds: config.model.thresholds }),
        close: async () => {
          catalog.stop();
          await loader.close();
        },
      };
    }
  }
}

/** Архив прод-сканов: своё подключение к базе, чтобы запись не делила пул с каталогом. */
function createArchive(config: ApiConfig, recognizerName: string): { archive: ScanArchive | null; close: () => Promise<void> } {
  if (!config.scanArchive) return { archive: null, close: async () => {} };
  const writer = createPgScanWriter(config.scanArchive.databaseUrl);
  const archive = createScanArchive({
    store: createFileScanStore(config.scanArchive.dir),
    insert: writer.insert,
    matcherVersion: config.scanArchive.matcherVersion ?? recognizerName,
  });
  return { archive, close: writer.close };
}

const config = loadApiConfig(process.env);
const { recognizer, close } = createRecognizer(config);
const { archive, close: closeArchive } = createArchive(config, recognizer.name);
const server = serve({ fetch: createApp({ config, recognizer, archive }).fetch, hostname: config.host, port: config.port }, (info) => {
  const archiveNote = config.scanArchive ? `архив сканов: ${config.scanArchive.dir}` : 'архив сканов выключен';
  console.log(`winvino api слушает http://${info.address}:${info.port} · распознаватель: ${recognizer.name} · ${archiveNote}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => void Promise.all([close(), closeArchive()]).finally(() => process.exit(0))));
}
