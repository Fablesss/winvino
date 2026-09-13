// Применяет файлы из migrations/ по порядку имён, по одному в транзакции.
// Состояние — в public.schema_migrations. Повторный прогон ничего не делает.
//   node scripts/migrate.mjs            применить недостающие
//   node scripts/migrate.mjs --status   только показать состояние
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { connect, projectRoot } from './lib/db.mjs';

const MIGRATIONS_DIR = path.join(projectRoot, 'migrations');
const statusOnly = process.argv.includes('--status');

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const client = await connect();
let failed = false;
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename   text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await client.query('SELECT filename, checksum FROM public.schema_migrations');
  const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

  for (const file of files) {
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const sum = sha256(sql);
    const was = applied.get(file);

    if (was === sum) {
      console.log(`= ${file} (уже применена)`);
      continue;
    }
    if (was && was !== sum) {
      // Менять применённую миграцию нельзя: база и файл разъедутся молча.
      console.error(`! ${file} применена, но файл изменился — заведи новую миграцию вместо правки этой`);
      failed = true;
      continue;
    }
    if (statusOnly) {
      console.log(`+ ${file} (ожидает применения)`);
      continue;
    }

    process.stdout.write(`> ${file} ... `);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)',
        [file, sum],
      );
      await client.query('COMMIT');
      console.log('ок');
    } catch (err) {
      await client.query('ROLLBACK');
      console.log('УПАЛА');
      console.error(`  ${err.message}`);
      failed = true;
      break; // порядок миграций важен — дальше не идём
    }
  }
} finally {
  await client.end();
}
process.exit(failed ? 1 : 0);
