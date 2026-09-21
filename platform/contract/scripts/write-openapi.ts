// Пишет openapi.json рядом с пакетом — из него генерируют клиентов бот и нативные приложения.
// Тест openapi.test.ts падает, если файл отстал от схем: перегенерировать этой командой.
import { writeFileSync } from 'node:fs';
import { buildOpenApiDocument } from '../src/openapi.ts';

const outputUrl = new URL('../openapi.json', import.meta.url);
writeFileSync(outputUrl, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
console.log(`записан ${outputUrl.pathname}`);
