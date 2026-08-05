import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { pool, query } from './db.js';

const MAX_PER_ITEM = 1000;

export function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// El catálogo vive en bijou.xlsx (cod interno, precios redondeados, costo).
// precios.xlsx se dejó de usar: es un listado viejo que generaba duplicados.
const EXCEL_FILENAMES = ['bijou.xlsx'];

export function resolveExcelPath() {
  // El directorio actual tiene prioridad sobre el padre: evita que un archivo
  // suelto en la carpeta superior (p.ej. precios.xlsx) tape al catálogo vigente.
  const candidates = [
    process.env.EXCEL_PATH,
    ...EXCEL_FILENAMES.map((name) => `/app/${name}`),
    ...EXCEL_FILENAMES.map((name) => path.resolve(process.cwd(), name)),
    ...EXCEL_FILENAMES.map((name) => path.resolve(process.cwd(), `../${name}`)),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error('No se encontró bijou.xlsx');
}

function resolveAssetsDir() {
  const candidates = [
    process.env.ASSETS_DIR,
    '/app/products-assets',
    path.resolve(process.cwd(), 'products-assets'),
    path.resolve(process.cwd(), '../products-assets'),
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

// Parsea las filas de una hoja Excel (XLSX) al formato interno de productos.
// Funciona tanto para archivos del servidor (bijou.xlsx) como para los que
// sube el admin (Importar Excel): el código de referencia es "Cod interno"
// (ej. AN1064) y los precios se toman de las columnas "REDONDEO ...".
export function parseProductRows(rows, assetsDir) {
  return rows
    .map((row) => {
      const reference = String(
        row['Cod interno'] ?? row['COD INTERNO'] ?? row.cod_interno ?? row.PRODUCTO ?? row.producto ?? ''
      ).trim();
      if (!reference) return null;

      // Se aceptan los nombres del export ("Categoria", "Stock viaje") y los
      // de bijou.xlsx ("CATEGORÍA", "Stock") para que el round-trip funcione.
      const category =
        String(
          row['Categoria'] ?? row['Categoría'] ?? row['CATEGORÍA'] ?? row.CATEGORIA ?? row.categoria ?? ''
        ).trim() || 'SIN CATEGORIA';
      const description = String(row['Descripción'] ?? row.Descripcion ?? row.descripcion ?? '').trim();
      const stock = Math.max(0, Math.floor(Number(row['Stock viaje'] ?? row['Stock'] ?? row.Stock ?? row.stock ?? 0)));
      const cost = Number(row.Costo ?? row.costo ?? 0) || 0;
      // Se usa el precio REDONDEADO (ej. "REDONDEO MAYORISTA") que es el que
      // se muestra en la página, con el precio original como respaldo.
      const priceWholesale = Number(row['REDONDEO MAYORISTA'] ?? row.redondeo_mayorista ?? row['PRECIO mayorista'] ?? row.precio_mayorista ?? 0) || 0;
      const priceRetail = Number(row['REDONDEO MINORISTA'] ?? row.redondeo_minorista ?? row['PRECIO minorista'] ?? row.precio_minorista ?? 0) || 0;
      const priceMl = Number(row['REDONDEO ML'] ?? row.redondeo_ml ?? row['PRECIO ML'] ?? row.precio_ml ?? 0) || 0;

      // Stock de oficina: solo se toca si el archivo trae la columna; si no,
      // se conserva el valor actual de la base (null = no modificar).
      const rawStockOficina = row['Stock oficina'] ?? row['Stock casa'] ?? row.stock_oficina ?? row.stock_casa;
      const stockCasa = rawStockOficina !== undefined && rawStockOficina !== ''
        ? Math.max(0, Math.floor(Number(rawStockOficina) || 0))
        : null;

      // Activo: SÍ/NO (o 1/0/true/false). Sin la columna, no se modifica.
      const rawActive = row['Activo'] ?? row.activo ?? row.ACTIVO;
      let active = null;
      if (rawActive !== undefined && rawActive !== '') {
        const value = String(rawActive).trim().toLowerCase();
        active = !['no', 'n', 'false', '0'].includes(value);
      }

      return {
        reference,
        category,
        description,
        stock,
        stockCasa,
        cost,
        priceWholesale,
        priceRetail,
        priceMl,
        active,
        imagePath: imageForReference(assetsDir, reference),
      };
    })
    .filter(Boolean);
}

export function parseProductsFromExcel(excelPath, assetsDir) {
  const workbook = XLSX.readFile(excelPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return parseProductRows(rows, assetsDir);
}

export async function seedDatabase() {
  // Si la base ya tiene productos, no hace falta el Excel: el seed se omite
  // sin exigir que bijou.xlsx exista (relevante en deploys donde el archivo
  // no viajó con la imagen o se actualizó la base en otro entorno).
  const { rows: existing } = await query('SELECT COUNT(*)::int AS count FROM products');
  if (existing[0].count > 0) {
    console.log(`Seed omitido: ya hay ${existing[0].count} productos en la base.`);
    return;
  }

  const excelPath = resolveExcelPath();
  const assetsDir = resolveAssetsDir();
  const products = parseProductsFromExcel(excelPath, assetsDir);

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
