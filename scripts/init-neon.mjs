// Aplica el schema (db/init.sql) a una base PostgreSQL remota (Neon).
// Uso: DATABASE_URL="postgresql://..." node scripts/init-neon.mjs
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Falta DATABASE_URL. Ej: DATABASE_URL="postgresql://..." node scripts/init-neon.mjs');
  process.exit(1);
}

const sql = fs.readFileSync(path.resolve('db/init.sql'), 'utf8');
const client = new pg.Client({ connectionString: url });

try {
  await client.connect();
  await client.query(sql);
  console.log('✅ Schema aplicado correctamente en Neon.');
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`
  );
  console.log('Tablas creadas:', rows.map((r) => r.table_name).join(', '));
} catch (err) {
  console.error('❌ Error al aplicar el schema:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
