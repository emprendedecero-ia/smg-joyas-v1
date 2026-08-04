import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { pool, query } from './db.js';

const MAX_PER_ITEM = 50;

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function resolveExcelPath() {
  const candidates = [
    process.env.EXCEL_PATH,
    '/app/precios.xlsx',
    path.resolve(process.cwd(), '../precios.xlsx'),
    path.resolve(process.cwd(), 'precios.xlsx'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error('No se encontró precios.xlsx');
}

function resolveAssetsDir() {
  const candidates = [
    process.env.ASSETS_DIR,
    '/app/products-assets',
    path.resolve(process.cwd(), '../products-assets'),
    path.resolve(process.cwd(), 'products-assets'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function imageForReference(assetsDir, reference) {
  if (!assetsDir) return null;
  const filename = `${reference}.png`;
  return fs.existsSync(path.join(assetsDir, filename)) ? filename : null;
}

export function parseProductsFromExcel(excelPath, assetsDir) {
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  return rows
    .map((row) => {
      const reference = String(row.PRODUCTO || row.producto || '').trim();
      if (!reference) return null;

      const category = String(row['CATEGORÍA'] || row.CATEGORIA || row.categoria || 'SIN CATEGORIA').trim();
      const description = String(row['Descripción'] || row.Descripcion || row.descripcion || '').trim();
      const stock = Math.max(0, Math.floor(Number(row.Stock ?? row.stock ?? 0)));
      const cost = Number(row.Costo ?? row.costo ?? 0) || 0;
      const priceWholesale = Number(row['PRECIO mayorista'] ?? row.precio_mayorista ?? 0) || 0;
      const priceRetail = Number(row['PRECIO minorista'] ?? row.precio_minorista ?? 0) || 0;
      const priceMl = Number(row['PRECIO ML'] ?? row.precio_ml ?? 0) || 0;

      return {
        reference,
        category,
        description,
        stock,
        cost,
        priceWholesale,
        priceRetail,
        priceMl,
        imagePath: imageForReference(assetsDir, reference),
      };
    })
    .filter(Boolean);
}

export async function seedDatabase() {
  const excelPath = resolveExcelPath();
  const assetsDir = resolveAssetsDir();
  const products = parseProductsFromExcel(excelPath, assetsDir);

  const { rows: existing } = await query('SELECT COUNT(*)::int AS count FROM products');
  if (existing[0].count > 0) {
    console.log(`Seed omitido: ya hay ${existing[0].count} productos en la base.`);
    return;
  }

  console.log(`Importando ${products.length} productos desde ${excelPath}...`);

  for (const product of products) {
    const { rows: categoryRows } = await query(
      `INSERT INTO categories (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [product.category, slugify(product.category)]
    );

    await query(
      `INSERT INTO products (
        reference, category_id, description, stock, cost,
        price_wholesale, price_retail, price_ml, image_path
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (reference) DO UPDATE SET
        category_id = EXCLUDED.category_id,
        description = EXCLUDED.description,
        stock = EXCLUDED.stock,
        cost = EXCLUDED.cost,
        price_wholesale = EXCLUDED.price_wholesale,
        price_retail = EXCLUDED.price_retail,
        price_ml = EXCLUDED.price_ml,
        image_path = EXCLUDED.image_path,
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

  console.log('Seed completado.');
}

export { MAX_PER_ITEM };

import { fileURLToPath } from 'url';

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  seedDatabase()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
