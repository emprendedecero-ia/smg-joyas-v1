// Restaura la categoría de cada producto según bijou.xlsx (columna CATEGORÍA),
// emparejando por "Cod interno" (reference).
//
// Uso:
//   DATABASE_URL="postgres://..." node backend/fix-categories.mjs
import pg from 'pg';
import { parseProductsFromExcel, resolveExcelPath } from './src/seed.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}

const slugify = (name) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-');

const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();

  const excelPath = resolveExcelPath();
  const products = parseProductsFromExcel(excelPath, null);
  console.log(`Excel: ${products.length} productos con categoría.`);

  let updated = 0;
  let missing = [];
  for (const product of products) {
    const { rows: categoryRows } = await client.query(
      `INSERT INTO categories (name, slug) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [product.category, slugify(product.category)]
    );

    const { rowCount } = await client.query(
      `UPDATE products SET category_id = $1, updated_at = NOW()
       WHERE reference = $2 AND (category_id IS DISTINCT FROM $1)`,
      [categoryRows[0].id, product.reference]
    );
    if (rowCount > 0) updated += rowCount;
  }

  // Productos en la DB que no están en el Excel (para reportar).
  const refs = products.map((p) => p.reference);
  if (refs.length > 0) {
    const { rows } = await client.query(
      `SELECT p.reference, p.description FROM products p
       WHERE p.reference <> ALL($1) ORDER BY p.reference`,
      [refs]
    );
    missing = rows;
  }

  const { rows: counts } = await client.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE category_id IS NOT NULL)::int AS con_cat,
            COUNT(*) FILTER (WHERE category_id IS NULL)::int AS sin_cat
     FROM products`
  );
  const { rows: cats } = await client.query(
    `SELECT c.name, COUNT(p.id) AS cant FROM products p
     JOIN categories c ON c.id = p.category_id
     GROUP BY c.name ORDER BY cant DESC`
  );

  console.log(`\nActualizados: ${updated}`);
  console.log(`Totales: ${counts[0].total} | con categoría: ${counts[0].con_cat} | sin categoría: ${counts[0].sin_cat}`);
  console.log('\nCategorías resultantes:');
  for (const c of cats) console.log(`  ${c.cant}  ${c.name}`);
  if (missing.length) {
    console.log(`\nProductos en DB que NO están en el Excel (${missing.length}):`);
    for (const m of missing) console.log(`  ${m.reference} - ${m.description}`);
  }
} catch (error) {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
