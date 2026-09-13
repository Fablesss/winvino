// Read-only: кто сейчас висит в базе winvino и сколько строк уже есть.
import { connect } from './lib/db.mjs';

const client = await connect();
try {
  const act = await client.query(`
    SELECT pid, state, now() - xact_start AS xact_age, left(query, 70) AS query
    FROM pg_stat_activity
    WHERE datname = 'winvino' AND pid <> pg_backend_pid()
    ORDER BY xact_start NULLS LAST`);
  console.log('=== активные подключения ===');
  console.log(act.rows.length ? act.rows : '(нет)');

  const counts = await client.query(`
    SELECT (SELECT count(*) FROM wines)         AS wines,
           (SELECT count(*) FROM manufacturers) AS manufacturers,
           (SELECT count(*) FROM regions)       AS regions,
           (SELECT count(*) FROM grapes)        AS grapes,
           (SELECT count(*) FROM dishes)        AS dishes,
           (SELECT count(*) FROM wine_photos)   AS photos`);
  console.log('=== закоммиченные счётчики ===');
  console.log(counts.rows[0]);
} finally {
  await client.end();
}
