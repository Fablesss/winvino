import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { loadApiConfig, type ApiConfig } from './config.ts';
import { createMockRecognizer } from './recognizer/mockRecognizer.ts';
import type { Recognizer } from './recognizer/recognizer.ts';

/** Сюда добавляется ветка настоящей модели, когда она будет готова. */
function createRecognizer(config: ApiConfig): Recognizer {
  switch (config.recognizer) {
    case 'mock':
      return createMockRecognizer({ delayMs: config.mockRecognizerDelayMs });
  }
}

const config = loadApiConfig(process.env);
const recognizer = createRecognizer(config);
const server = serve({ fetch: createApp({ config, recognizer }).fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`winvino api слушает http://${info.address}:${info.port} · распознаватель: ${recognizer.name}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
