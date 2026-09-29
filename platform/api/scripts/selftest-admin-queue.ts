/*
 * Самотест очереди разметки (WIN-17) против реальной базы: SQL из adminStore.ts руками не
 * переписан, проверяется именно тот код, который поедет в прод.
 *
 * Запуск: npm run selftest:admin -w @winvino/api (DATABASE_URL из .env в корне репозитория).
 *
 * Скан заводится свой, одноразовый, с пометкой в notes и удаляется в finally — общие строки
 * label_scans тест не трогает, метрики прода не портит.
 */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { createFileImageReader } from '../src/admin/adminImage.ts';
import { createPgAdminStore } from '../src/admin/adminStore.ts';
import { PRODUCTION_SCAN_SOURCE } from '../src/scans/scanArchive.ts';

const SELFTEST_NOTE = 'WIN-17 selftest admin queue';
/** Однопиксельный PNG: читателю фото важна сигнатура файла, а не картинка. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const checks: { name: string; ok: boolean; note: string }[] = [];
function check(name: string, ok: boolean, note = ''): void {
  checks.push({ name, ok, note });
  console.log(`${ok ? 'ок  ' : 'ПЛОХО'} ${name}${note ? ` — ${note}` : ''}`);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL не задан — проверьте .env в корне репозитория');

const store = createPgAdminStore(databaseUrl);
const setup = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const scansDir = await mkdtemp(path.join(tmpdir(), 'winvino-admin-selftest-'));
const scanIds: string[] = [];

try {
  // Два настоящих слага каталога: предсказание и «на самом деле это».
  const found = await store.searchWines('вино', 2);
  check('searchWinesНаходитВинаКаталога', found.length === 2, found.map((wine) => wine.slug).join(', '));
  const [predicted, other] = found;
  if (!predicted || !other) throw new Error('в каталоге не нашлось двух вин — дальше тест бессмыслен');

  const candidates = {
    status: 'ambiguous',
    reason: null,
    top: [
      { slug: predicted.slug, confidence: 0.61 },
      { slug: other.slug, confidence: 0.44 },
    ],
    processingMs: 640,
    recognizer: 'selftest',
  };

  /** Одноразовый прод-скан: фото в свой временный каталог, строка — с пометкой в notes. */
  async function addScan(name: string, predictedSlug: string): Promise<string> {
    const imagePath = `${PRODUCTION_SCAN_SOURCE}/00/win17-selftest-${name}.png`;
    await mkdir(path.join(scansDir, path.dirname(imagePath)), { recursive: true });
    await writeFile(path.join(scansDir, imagePath), PNG_BYTES);
    const inserted = await setup.query<{ id: string }>(
      `INSERT INTO label_scans (source, image_path, predicted_wine_slug, predicted_score, candidates, matcher_version, notes)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id`,
      [PRODUCTION_SCAN_SOURCE, imagePath, predictedSlug, 0.61, JSON.stringify(candidates), 'selftest', SELFTEST_NOTE],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error('тестовый скан не завёлся');
    scanIds.push(id);
    return id;
  }

  // Два скана: второй нужен, чтобы проверить страницы по курсору, а не только одну выдачу.
  const olderId = await addScan('older', predicted.slug);
  const scanId = await addScan('newer', predicted.slug);
  const imagePath = `${PRODUCTION_SCAN_SOURCE}/00/win17-selftest-newer.png`;

  const pending = await store.listScans({ filter: 'pending', limit: 20 });
  const queued = pending.items.find((scan) => scan.id === scanId);
  check('сканБезЭталонаПопадаетВОчередь', Boolean(queued), `в очереди всего ${pending.pendingTotal}`);
  check('кандидатыОбогащеныНазваниями', queued?.candidates[0]?.title === predicted.title, queued?.candidates[0]?.title ?? '—');
  check('статусИПричинаРазобраныИзJsonb', queued?.status === 'ambiguous' && queued.reason === null, String(queued?.status));
  check('эталонаПокаНет', queued?.truth.kind === 'none');

  // Оба тестовых скана — самые свежие в очереди, поэтому страницы по одному должны выдать их по
  // очереди и не повторить. Это проверка курсора (created_at, id), а не просто «выдача не пустая».
  const firstPage = await store.listScans({ filter: 'pending', limit: 1 });
  const secondPage = firstPage.nextCursor
    ? await store.listScans({ filter: 'pending', limit: 1, cursor: firstPage.nextCursor })
    : null;
  check('перваяСтраницаОчередиДаётКурсор', firstPage.items.length === 1 && firstPage.nextCursor !== null);
  check(
    'втораяСтраницаНеПовторяетПервую',
    firstPage.items[0]?.id === scanId && secondPage?.items[0]?.id === olderId,
    `${firstPage.items[0]?.id?.slice(0, 8)} → ${secondPage?.items[0]?.id?.slice(0, 8)}`,
  );

  const image = await createFileImageReader(scansDir)(imagePath);
  check('фотоЧитаетсяИТипПоСигнатуре', image?.contentType === 'image/png', image?.contentType ?? 'нет файла');
  check('выходЗаКаталогСкановЗакрыт', (await createFileImageReader(scansDir)('../../etc/passwd')) === null);
  check('путьФотоБерётсяИзБазы', (await store.scanImagePath(scanId)) === imagePath);
  check('одинСканЧитаетсяПоId', (await store.getScan(scanId))?.predicted?.slug === predicted.slug);
  check('чужогоIdНет', (await store.getScan(crypto.randomUUID())) === null);

  const confirmed = await store.setTruth(scanId, { kind: 'confirm' });
  check(
    'верно→эталонИзПредсказанияИRank1',
    confirmed.status === 'saved' && confirmed.scan.truth.wine?.slug === predicted.slug && confirmed.scan.truthRank === 1,
    confirmed.status === 'saved' ? `rank ${confirmed.scan.truthRank}` : confirmed.status,
  );

  const relabeled = await store.setTruth(scanId, { kind: 'wine', slug: other.slug });
  check(
    'переразметкаНаДругоеВино→rank2',
    relabeled.status === 'saved' && relabeled.scan.truth.wine?.slug === other.slug && relabeled.scan.truthRank === 2,
    relabeled.status === 'saved' ? `rank ${relabeled.scan.truthRank}` : relabeled.status,
  );

  const absent = await store.setTruth(scanId, { kind: 'absent' });
  check(
    'нетВКаталоге→truthAbsentБезСлага',
    absent.status === 'saved' && absent.scan.truth.kind === 'absent' && absent.scan.truthRank === null,
  );

  const unknown = await store.setTruth(scanId, { kind: 'wine', slug: 'takogo-vina-net-v-kataloge' });
  check('слагВнеКаталогаОтклонён', unknown.status === 'unknown_wine', unknown.status);
  check('сканаНетВБазе→scanNotFound', (await store.setTruth(crypto.randomUUID(), { kind: 'absent' })).status === 'scan_not_found');

  const labeled = await store.listScans({ filter: 'labeled', limit: 20 });
  check('размеченныйСканВидноВоВкладкеLabeled', labeled.items.some((scan) => scan.id === scanId));
  check('размеченныйСканУшёлИзОчереди', !(await store.listScans({ filter: 'pending', limit: 20 })).items.some((scan) => scan.id === scanId));
} finally {
  if (scanIds.length > 0) {
    await setup.query('DELETE FROM label_scans WHERE id = ANY($1::uuid[]) AND notes = $2', [scanIds, SELFTEST_NOTE]);
  }
  await setup.end();
  await store.close();
  await rm(scansDir, { recursive: true, force: true });
}

const failed = checks.filter((result) => !result.ok);
console.log(`\nпроверок: ${checks.length}, провалов: ${failed.length}`);
if (failed.length > 0) process.exitCode = 1;
