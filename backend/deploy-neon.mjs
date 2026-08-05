// Despliega el esquema (db/init.sql) y el catálogo (bijou.xlsx) en una base
// PostgreSQL remota (Neon). El catálogo queda exactamente como el Excel:
// upsert de todos los productos + desactivación de los que no figuren.
//
// Uso:
//   DATABASE_URL="postgresql://..." node backend/deploy-neon.mjs
//   DATABASE_URL="..." RESET=1 node backend/deploy-neon.mjs   # resetea pedidos y catálogo
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { parseProductsFromExcel, resolveExcelPath } from './src/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL. Ej: DATABASE_URL="postgresql://..." node backend/deploy-neon.mjs');
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });
const slugify = (name) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-');

try {
  await client.connect();

  // 1) Esquema primero: se aplica solo si la base está vacía (evita el error
  // de "relation already exists" en re-deploys sobre la misma base).
  const { rows: existingTables } = await client.query(
    `SELECT COUNT(*)::int AS c FROM pg_tables WHERE schemaname = 'public' AND tablename = 'products'`
  );
  if (existingTables[0].c === 0) {
    const schema = fs.readFileSync(path.join(__dirname, '../db/init.sql'), 'utf8');
    await client.query(schema);
    console.log('1) Esquema aplicado.');
  } else {
    console.log('1) Esquema ya existente (se omite).');
  }

  // 0) Con RESET=1 se borran pedidos y catálogo para dejar la base 100% limpia.
  // Sin el flag, el catálogo solo se resetea cuando no hay pedidos (para que el
  // historial nunca se pierda por accidente).
  const { rows: orderCount } = await client.query('SELECT COUNT(*)::int AS c FROM orders');
  if (process.env.RESET === '1' || orderCount[0].c === 0) {
    if (process.env.RESET === '1') {
      console.warn('⚠️  RESET=1: se borran TODOS los pedidos y el catálogo. Si es producción y hay pedidos reales, abortá ahora (Ctrl+C).');
    }
    await client.query('TRUNCATE order_items, orders, products, categories RESTART IDENTITY CASCADE');
    console.log(`0) Base ${process.env.RESET === '1' ? '(RESET pedido)' : 'sin pedidos'}: catálogo reseteado.`);
  } else {
    console.log('0) Hay pedidos: no se resetea, se actualiza por upsert.');
  }

  // 2) Catálogo desde bijou.xlsx: upsert de todos los productos del Excel y
  // desactivación de los que ya no estén (no se borran: se conserva el historial).
  const excelPath = resolveExcelPath();
  const assetsDir = process.env.ASSETS_DIR || path.join(__dirname, '../products-assets');
  const products = parseProductsFromExcel(excelPath, assetsDir);
  console.log(`2) Importando ${products.length} productos desde ${path.basename(excelPath)}...`);

  for (const product of products) {
    const { rows: categoryRows } = await client.query(
      `INSERT INTO categories (name, slug) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [product.category, slugify(product.category)]
    );

    await client.query(
      `INSERT INTO products (
        reference, category_id, description, stock, cost,
        price_wholesale, price_retail, price_ml, image_path, active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
      ON CONFLICT (reference) DO UPDATE SET
        category_id = EXCLUDED.category_id,
        description = EXCLUDED.description,
        stock = EXCLUDED.stock,
        cost = EXCLUDED.cost,
        price_wholesale = EXCLUDED.price_wholesale,
        price_retail = EXCLUDED.price_retail,
        price_ml = EXCLUDED.price_ml,
        image_path = EXCLUDED.image_path,
        active = TRUE,
        updated_at = NOW()`,
      [
        product.reference,
        categoryRows[0].id,
        product.description,
        product.stock,
        product.cost,
        product.priceWholesale,
        product.priceRetail,
        product.priceMl,
        product.imagePath,
      ]
    );
  }

  // Los productos que ya no figuran en el Excel quedan inactivos (historial
  // intacto). Solo si el Excel trajo productos: un array vacío en $1
  // desactivaría TODO el catálogo.
  const references = products.map((product) => product.reference);
  let deactivated = 0;
  if (references.length > 0) {
    const { rowCount } = await client.query(
      'UPDATE products SET active = FALSE, updated_at = NOW() WHERE reference <> ALL($1)',
      [references]
    );
    deactivated = rowCount;
  }
  console.log(`3) ${deactivated} productos fuera del Excel desactivados.`);

  // 4) Verificación.
  const { rows: counts } = await client.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE active)::int AS activos
     FROM products`
  );
  const { rows: noImage } = await client.query(
    `SELECT COUNT(*)::int AS c FROM products
     WHERE active AND (image_path IS NULL OR image_path = '')`
  );
  console.log(`4) Productos: ${counts[0].total} totales, ${counts[0].activos} activos, ${noImage[0].c} activos sin imagen.`);

  const { rows: orders } = await client.query('SELECT COUNT(*)::int AS c FROM orders');
  console.log(`Pedidos: ${orders[0].c}.`);
} catch (error) {
  console.error('ERROR:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
