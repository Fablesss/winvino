// Гейт: JS-нормализация normLabel() и SQL-функция public.norm_label() должны давать
// одинаковый результат. Два источника правды разъезжаются молча, поэтому проверяем
// на всех названиях каталога, а не на примерах.
import { connect } from './lib/db.mjs';
import { normLabel } from './lib/fuzzy.mjs';

const client = await connect();
let mismatches = 0;
try {
  const { rows } = await client.query(`
    SELECT title AS src, title_norm AS sql_norm FROM wines
    UNION ALL SELECT name, name_norm FROM manufacturers
    UNION ALL SELECT name, name_norm FROM grapes`);

  for (const r of rows) {
    const js = normLabel(r.src);
    if (js !== r.sql_norm) {
      mismatches += 1;
      if (mismatches <= 10) {
        console.error(`РАСХОЖДЕНИЕ: ${JSON.stringify(r.src)}`);
        console.error(`  sql: ${JSON.stringify(r.sql_norm)}`);
        console.error(`  js : ${JSON.stringify(js)}`);
      }
    }
  }
  console.log(`проверено строк: ${rows.length}, расхождений: ${mismatches}`);
} finally {
  await client.end();
}
process.exit(mismatches ? 1 : 0);
