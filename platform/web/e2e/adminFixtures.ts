import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import sharp from "sharp";
import { ADMIN_E2E } from "./adminEnv";

/**
 * Прод-сканы для e2e разметки: заводятся свои, одноразовые, с пометкой в notes — и удаляются в
 * конце прогона. Настоящие строки label_scans тест не трогает: их эталон ставит человек.
 */
const SEED_NOTE = "e2e admin queue";
const SOURCE = "production";

export type SeededScan = {
  id: string;
  imagePath: string;
  /** Что «распознала» модель: это вино показано как предсказание. */
  predicted: { slug: string; title: string };
  /** Альтернатива в выдаче — ею проверяется выбор кандидата одним нажатием. */
  alternative: { slug: string; title: string };
};

function pool(): pg.Pool {
  if (!ADMIN_E2E.databaseUrl) throw new Error("DATABASE_URL не задан — сиды разметки невозможны");
  return new pg.Pool({ connectionString: ADMIN_E2E.databaseUrl, max: 1 });
}

/** Снимок этикетки: важен формат и то, что файл читается, а не сама картинка. */
async function renderScanPhoto(title: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">
    <rect width="600" height="800" fill="#5b4a3a"/>
    <rect x="90" y="140" width="420" height="520" rx="20" fill="#f3ead2"/>
    <text x="300" y="400" font-size="34" text-anchor="middle" font-family="Georgia" fill="#2b2b2b">${title}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

export async function seedProductionScans(count: number): Promise<SeededScan[]> {
  const db = pool();
  try {
    // DISTINCT ON (title): в каталоге есть вина-двойники с одинаковым названием (docs/CATALOG-DUPES.md),
    // а тесту нужны два различимых — иначе не понять, по какому из них сработал поиск.
    const { rows: wines } = await db.query<{ slug: string; title: string }>(
      "SELECT DISTINCT ON (title) slug, title FROM wines ORDER BY title, slug LIMIT 2",
    );
    const [predicted, alternative] = wines;
    if (!predicted || !alternative) throw new Error("в каталоге меньше двух вин — сид разметки невозможен");

    const seeded: SeededScan[] = [];
    for (let index = 0; index < count; index += 1) {
      const imagePath = `${SOURCE}/e2e/admin-${Date.now()}-${index}.jpg`;
      const target = path.join(ADMIN_E2E.scansDir, imagePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await renderScanPhoto(predicted.title));

      const candidates = {
        status: "ambiguous",
        reason: null,
        top: [
          { slug: predicted.slug, confidence: 0.62 },
          { slug: alternative.slug, confidence: 0.41 },
        ],
        processingMs: 700,
        recognizer: "e2e",
      };
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO label_scans (source, image_path, predicted_wine_slug, predicted_score, candidates, matcher_version, notes)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7) RETURNING id`,
        [SOURCE, imagePath, predicted.slug, 0.62, JSON.stringify(candidates), "e2e", SEED_NOTE],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error("скан не завёлся");
      seeded.push({ id, imagePath, predicted, alternative });
    }
    return seeded;
  } finally {
    await db.end();
  }
}

/** Как размечен скан — проверка того, что действие дошло до базы, а не только до экрана. */
export async function readTruth(scanId: string): Promise<{ truthWineSlug: string | null; truthAbsent: boolean; truthRank: number | null }> {
  const db = pool();
  try {
    const { rows } = await db.query<{ truth_wine_slug: string | null; truth_absent: boolean; truth_rank: number | null }>(
      "SELECT truth_wine_slug, truth_absent, truth_rank FROM label_scans WHERE id = $1",
      [scanId],
    );
    const row = rows[0];
    if (!row) throw new Error(`скана ${scanId} нет в базе`);
    return { truthWineSlug: row.truth_wine_slug, truthAbsent: row.truth_absent, truthRank: row.truth_rank };
  } finally {
    await db.end();
  }
}

export async function removeSeededScans(): Promise<void> {
  const db = pool();
  try {
    await db.query("DELETE FROM label_scans WHERE notes = $1", [SEED_NOTE]);
  } finally {
    await db.end();
  }
  await rm(path.join(ADMIN_E2E.scansDir, SOURCE, "e2e"), { recursive: true, force: true });
}
