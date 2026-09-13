// Read-only: что сейчас в базе. Ничего не меняет, безопасно гонять когда угодно.
import { connect } from './lib/db.mjs';

const client = await connect();
try {
  const show = async (label, sql) => {
    const { rows } = await client.query(sql);
    console.log(`\n=== ${label} ===`);
    console.log(rows.length ? rows : '(пусто)');
  };

  await show('версия', 'SELECT version()');
  await show('текущая база и роль', 'SELECT current_database() AS db, current_user AS role, current_schema() AS schema');
  await show('суперюзер?', "SELECT rolsuper, rolcreatedb FROM pg_roles WHERE rolname = current_user");

  await show('нужные расширения: доступно / включено', `
    SELECT name, default_version, installed_version
    FROM pg_available_extensions
    WHERE name IN ('vector','pg_trgm','unaccent','fuzzystrmatch')
    ORDER BY name`);

  await show('уже включённые расширения', `
    SELECT e.extname, e.extversion, n.nspname AS schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    ORDER BY e.extname`);

  await show('схемы', `
    SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'
    ORDER BY nspname`);

  await show('существующие таблицы', `
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog','information_schema')
    ORDER BY table_schema, table_name`);

  await show('другие базы в кластере', `
    SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size
    FROM pg_database WHERE datistemplate = false ORDER BY datname`);
} finally {
  await client.end();
}
