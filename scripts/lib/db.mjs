// Единственное место, где создаётся подключение к Postgres и печатается target-инстанс.
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });

export { projectRoot };

/** URL с замаскированным паролем — только это уходит в логи. */
export function maskUrl(url) {
  return String(url).replace(/:\/\/([^:/@]+):[^@]*@/, '://$1:***@');
}

/**
 * Подключается по DATABASE_URL. Сначала без TLS, при отказе сервера — с TLS
 * без проверки цепочки (у своего VPS обычно самоподписанный сертификат).
 */
export async function connect() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL не задан — проверь .env');

  console.log(`target: ${maskUrl(connectionString)}`);

  for (const ssl of [false, { rejectUnauthorized: false }]) {
    const client = new pg.Client({ connectionString, ssl, connectionTimeoutMillis: 15000 });
    try {
      await client.connect();
      if (ssl) console.log('(подключение по TLS без проверки сертификата)');
      return client;
    } catch (err) {
      await client.end().catch(() => {});
      const needsTls = /SSL|ssl/.test(err.message) && ssl === false;
      if (!needsTls) throw err;
    }
  }
  throw new Error('не удалось подключиться ни без TLS, ни с TLS');
}
