const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const xlsx = require('xlsx');
const postgres = require('postgres');

if (!process.env.DATABASE_URL) throw new Error('Definí DATABASE_URL antes de ejecutar el seed.');
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
const workbook = xlsx.readFile(path.join(__dirname, '..', 'precios.xlsx'));
const rows = xlsx.utils.sheet_to_json(workbook.Sheets.PRECIO_MAY, { defval: null });

function categoryFor(code) {
  if (code.startsWith('AR')) return 'Aros';
  if (code.startsWith('DI')) return 'Dijes';
  return 'Anillos';
}

(async () => {
  for (const row of rows) {
    const code = String(row.COD || '').trim().toUpperCase();
    const price = Number(row.PRECIO);
    if (!code || !Number.isFinite(price)) continue;
    await sql`INSERT INTO products (code, name, category, price, image_url) VALUES (${code}, ${code}, ${categoryFor(code)}, ${price}, ${code + '.png'}) ON CONFLICT (code) DO UPDATE SET price = EXCLUDED.price, category = EXCLUDED.category, image_url = EXCLUDED.image_url, updated_at = NOW()`;
  }
  console.log(`Se importaron ${rows.length} productos desde precios.xlsx.`);
  await sql.end();
})().catch(async (error) => { console.error(error); await sql.end(); process.exit(1); });
