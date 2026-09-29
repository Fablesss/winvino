import { serve } from '@hono/node-server';
import { createFileImageReader } from './admin/adminImage.ts';
import type { AdminDeps } from './admin/adminRoutes.ts';
import { createPgAdminStore } from './admin/adminStore.ts';
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

/** Очередь разметки: своё подключение, чтобы разметчик не занимал пул распознавания. */
function createAdmin(config: ApiConfig): { admin: AdminDeps | null; close: () => Promise<void> } {
  if (!config.admin) return { admin: null, close: async () => {} };
  const store = createPgAdminStore(config.admin.databaseUrl);
  return {
    admin: { password: config.admin.password, store, readImage: createFileImageReader(config.admin.scansDir) },
    close: store.close,
  };
}

const config = loadApiConfig(process.env);
const { recognizer, close } = createRecognizer(config);
const { archive, close: closeArchive } = createArchive(config, recognizer.name);
const { admin, close: closeAdmin } = createAdmin(config);
const server = serve({ fetch: createApp({ config, recognizer, archive, admin }).fetch, hostname: config.host, port: config.port }, (info) => {
  const archiveNote = config.scanArchive ? `архив сканов: ${config.scanArchive.dir}` : 'архив сканов выключен';
  const adminNote = config.admin ? 'очередь разметки: /v1/admin' : 'очередь разметки выключена';
  console.log(`winvino api слушает http://${info.address}:${info.port} · распознаватель: ${recognizer.name} · ${archiveNote} · ${adminNote}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () =>
    server.close(() => void Promise.all([close(), closeArchive(), closeAdmin()]).finally(() => process.exit(0))),
  );
}
