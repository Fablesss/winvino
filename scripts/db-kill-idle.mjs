// Снимает осиротевшие backend'ы базы winvino, зависшие в 'idle in transaction'.
// Их транзакции не закоммичены — откат не теряет ничего видимого, но освобождает локи.
import { connect } from './lib/db.mjs';

const client = await connect();
try {
  const { rows } = await client.query(`
    SELECT pid, now() - xact_start AS xact_age, left(query, 60) AS query
    FROM pg_stat_activity
    WHERE datname = 'winvino'
      AND pid <> pg_backend_pid()
      AND state = 'idle in transaction'
      AND now() - xact_start > interval '1 minute'`);

  if (!rows.length) {
    console.log('зависших транзакций нет');
  } else {
    for (const r of rows) {
      const killed = await client.query('SELECT pg_terminate_backend($1) AS ok', [r.pid]);
      console.log(`pid ${r.pid} (${r.xact_age.minutes ?? 0}м в транзакции) -> terminate=${killed.rows[0].ok}`);
    }
  }
} finally {
  await client.end();
}
