import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import jwt from 'jsonwebtoken';
import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { pool, query, withTransaction } from './db.js';
import {
  MAX_PER_ITEM,
  parseProductRows,
  parseProductsFromExcel,
  resolveExcelPath,
  seedDatabase,
  slugify,
} from './seed.js';

function formatMoney(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(value);
}

// Fechas siempre en hora de Buenos Aires (UTC-3), aunque el servidor corra en
// UTC: los presupuestos y los pedidos deben reflejar la hora local argentina.
const BA_TZ = 'America/Argentina/Buenos_Aires';

function formatBaDate(date) {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: BA_TZ,
  }).format(date);
}

// '2026-08-05' en Buenos Aires, para nombres de archivo.
function baYmd(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Migraciones idempotentes: se ejecutan en cada arranque para que la base
// existente se actualice sin intervención manual.
async function migrate() {
  await query(`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS discount_type VARCHAR(10),
      ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''
  `);

  // Depósitos: "viaje" (stock que lleva el vendedor, se descuenta al vender)
  // y "casa" (stock de reposición). El stock viaje puede quedar en negativo
  // (política flexible), por eso se elimina el CHECK (stock >= 0).
  await query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_casa INTEGER NOT NULL DEFAULT 0`);
  await query(`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_stock_check`);

  // Timestamp de última modificación del pedido (para la edición admin).
  await query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

  // Costo unitario congelado al momento de la venta, para el informe de
  // rentabilidad (no se afecta si el costo del producto cambia después).
  await query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0`);

  // Límite de unidades por producto en un pedido (se amplió de 50 a un valor
  // mayor). Se re-crea el CHECK en cada arranque para bases existentes.
  await query(`ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_quantity_check`);
  await query(`
    ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_check
      CHECK (quantity > 0 AND quantity <= ${MAX_PER_ITEM})
  `);
}

function buildInvoicePdf(order, items) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 52 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const GOLD = '#B98A2F';
    const GOLD_DARK = '#8F6A22';
    const INK = '#2B241C';
    const MUTED = '#8D8377';
    const LINE = '#E9E0D2';

    const pageW = doc.page.width;
    const left = doc.page.margins.left;
    const rightEdge = pageW - doc.page.margins.right;
    const contentW = rightEdge - left;

    // Columnas de la tabla
    const colRef = 96;
    const colDesc = 168;
    const colQty = 52;
    const colUnit = 96;
    const colTotal = contentW - colRef - colDesc - colQty - colUnit;

    // Banda superior
    doc.rect(0, 0, pageW, 108).fill('#F6F0E4');
    doc.fillColor(GOLD).rect(left, 90, 60, 3);

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(24).text('SMG JOYERÍA', left, 32);
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(10)
      .text('Catálogo mayorista · Presupuesto', left, 62);

    doc
      .fillColor(GOLD_DARK)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text('PRESUPUESTO', rightEdge - 120, 32, { width: 120, align: 'right' });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text(`N.º ${String(order.id).padStart(5, '0')}`, rightEdge - 120, 58, { width: 120, align: 'right' });

    // Datos del pedido (fecha y hora de Buenos Aires)
    const dateStr = formatBaDate(new Date(order.created_at));

    let y = 136;
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('CLIENTE', left, y);
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(order.customer_name, left, y + 15);

    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text('FECHA', rightEdge - 200, y, { width: 200, align: 'right' });
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(dateStr, rightEdge - 200, y + 15, { width: 200, align: 'right' });

    y += 62;

    // Cabecera de la tabla
    doc.rect(left, y, contentW, 26).fill('#F6F0E4');
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(8);
    doc.text('CÓDIGO', left + 10, y + 9);
    doc.text('DESCRIPCIÓN', left + colRef + 10, y + 9);
    doc.text('CANT', left + colRef + colDesc + 10, y + 9);
    doc.text('P. UNITARIO', left + colRef + colDesc + colQty + 8, y + 9, {
      width: colUnit - 16,
      align: 'right',
    });
    doc.text('SUBTOTAL', left + colRef + colDesc + colQty + colUnit + 6, y + 9, {
      width: colTotal - 14,
      align: 'right',
    });

    y += 26;

    // Filas
    items.forEach((item, index) => {
      if (index % 2 === 1) {
        doc.rect(left, y, contentW, 26).fill('#FBF8F1');
      }
      doc.fillColor(INK).font('Helvetica').fontSize(9);
      doc.text(String(item.product_reference), left + 10, y + 8);
      doc.text(String(item.product_description), left + colRef + 10, y + 8, {
        width: colDesc - 20,
        height: 22,
        ellipsis: true,
      });
      doc.text(String(item.quantity), left + colRef + colDesc + 10, y + 8);
      doc.text(formatMoney(item.unit_price), left + colRef + colDesc + colQty + 8, y + 8, {
        width: colUnit - 16,
        align: 'right',
      });
      doc.text(formatMoney(item.line_total), left + colRef + colDesc + colQty + colUnit + 6, y + 8, {
        width: colTotal - 14,
        align: 'right',
      });
      y += 26;
    });

    // Observaciones de la venta
    if (order.notes) {
      const notesText = String(order.notes);
      const notesHeight = Math.min(
        110,
        40 + doc.heightOfString(notesText, { width: contentW - 32 })
      );
      y += 12;
      doc
        .rect(left, y, contentW, notesHeight)
        .fill('#FDFBF7')
        .strokeColor(LINE)
        .lineWidth(1)
        .stroke();
      doc
        .fillColor(GOLD_DARK)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text('OBSERVACIONES', left + 16, y + 12);
      doc
        .fillColor(INK)
        .font('Helvetica')
        .fontSize(9)
        .text(notesText, left + 16, y + 28, { width: contentW - 32 });
      y += notesHeight;
    }

    // Recuadro de totales
    const subtotal = items.reduce((sum, item) => sum + Number(item.line_total), 0);
    const discountAmount = Number(order.discount_amount) || 0;
    const total = Number(order.total);

    const totalsW = 230;
    const totalsX = rightEdge - totalsW;
    const boxH = discountAmount > 0 ? 122 : 82;
    y += 18;

    doc
      .rect(totalsX, y, totalsW, boxH)
      .fill('#FDFBF7')
      .strokeColor(LINE)
      .lineWidth(1)
      .stroke();

    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Subtotal', totalsX + 16, y + 14);
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(formatMoney(subtotal), totalsX + 16, y + 28, { width: totalsW - 32, align: 'right' });

    let totalY = y + 52;
    if (discountAmount > 0) {
      const discountLabel =
        order.discount_type === 'percent'
          ? `Descuento (${Number(order.discount_value)}%)`
          : 'Descuento';
      doc.fillColor(GOLD_DARK).font('Helvetica').fontSize(9).text(discountLabel, totalsX + 16, y + 52);
      doc
        .fillColor(GOLD_DARK)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(`-${formatMoney(discountAmount)}`, totalsX + 16, y + 66, {
          width: totalsW - 32,
          align: 'right',
        });
      totalY = y + 84;
    }

    doc
      .moveTo(totalsX + 16, totalY)
      .lineTo(totalsX + totalsW - 16, totalY)
      .strokeColor(LINE)
      .lineWidth(1)
      .stroke();

    doc.fillColor(GOLD_DARK).font('Helvetica-Bold').fontSize(11).text('TOTAL', totalsX + 16, totalY + 12);
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(formatMoney(total), totalsX + 16, totalY + 28, { width: totalsW - 32, align: 'right' });

    // Pie
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text(
        'Documento generado por SMG Joyería — presupuesto de venta mayorista. No es comprobante fiscal.',
        left,
        doc.page.height - 56,
        { width: contentW, align: 'center' }
      );

    doc.end();
  });
}

const app = Fastify({ logger: true });

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';

// El costo solo se expone en endpoints de admin (con withCost: true); el
// catálogo público no debe revelar el margen de ganancia.
function formatProduct(row, { withCost = false } = {}) {
  const product = {
    id: row.id,
    reference: row.reference,
    description: row.description,
    category: row.category_name,
    categorySlug: row.category_slug,
    stock: row.stock,
    stockCasa: Number(row.stock_casa ?? 0),
    priceWholesale: Number(row.price_wholesale),
    priceRetail: Number(row.price_retail),
    priceMl: Number(row.price_ml),
    imageUrl: row.image_path ? `/assets/products/${row.image_path}` : null,
    active: row.active,
  };
  if (withCost) {
    product.cost = Number(row.cost ?? 0);
  }
  return product;
}

function authHook(request, reply, done) {
  const header = request.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    reply.code(401).send({ error: 'No autorizado' });
    return;
  }

  try {
    request.admin = jwt.verify(token, JWT_SECRET);
    done();
  } catch {
    reply.code(401).send({ error: 'Token inválido' });
  }
}

await app.register(cors, { origin: CORS_ORIGIN, credentials: true });

// Upload del Excel para el import de productos (cambios masivos).
await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

const assetsCandidates = [
  process.env.ASSETS_DIR,
  '/app/products-assets',
  path.resolve(process.cwd(), '../products-assets'),
].filter(Boolean);

const assetsDir = assetsCandidates.find((dir) => fs.existsSync(dir));
if (assetsDir) {
  await app.register(fastifyStatic, {
    root: assetsDir,
    prefix: '/assets/products/',
    decorateReply: false,
  });
}

app.get('/health', async () => ({ ok: true }));

app.get('/api/categories', async () => {
  const { rows } = await query(
    `SELECT c.id, c.name, c.slug, COUNT(p.id)::int AS product_count
     FROM categories c
     LEFT JOIN products p ON p.category_id = c.id AND p.active = TRUE
     GROUP BY c.id
     ORDER BY c.name`
  );
  return rows;
});

app.get('/api/products', async (request) => {
  const { category, q } = request.query;
  const params = [];
  const conditions = ['p.active = TRUE'];

  if (category) {
    params.push(category);
    conditions.push(`c.slug = $${params.length}`);
  }

  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(p.reference ILIKE $${params.length} OR p.description ILIKE $${params.length})`);
  }

  const { rows } = await query(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.name, p.reference`,
    params
  );

  return rows.map((row) => formatProduct(row));
});

app.get('/api/products/:reference', async (request, reply) => {
  const { rows } = await query(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.reference = $1 AND p.active = TRUE`,
    [request.params.reference]
  );

  if (!rows[0]) {
    return reply.code(404).send({ error: 'Producto no encontrado' });
  }

  return formatProduct(rows[0]);
});


app.post('/api/orders', async (request, reply) => {
  const { customerName, items, discountType, discountValue, notes } = request.body || {};

  if (!customerName?.trim()) {
    return reply.code(400).send({ error: 'El nombre del cliente es obligatorio' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return reply.code(400).send({ error: 'El pedido debe tener al menos un producto' });
  }

  const discount = discountType || null;
  if (discount !== null && !['percent', 'amount'].includes(discount)) {
    return reply.code(400).send({ error: 'Tipo de descuento inválido' });
  }

  const discountValueNum = discount === null ? 0 : Number(discountValue) || 0;
  if (discount !== null && (!Number.isFinite(discountValueNum) || discountValueNum < 0)) {
    return reply.code(400).send({ error: 'Valor de descuento inválido' });
  }

  try {
    const order = await withTransaction(async (client) => {
      let subtotal = 0;
      const lineItems = [];

      for (const item of items) {
        const quantity = Number(item.quantity);
        const productId = Number(item.productId);

        if (!productId || !Number.isInteger(quantity) || quantity < 1) {
          throw Object.assign(new Error('Cantidad inválida'), { statusCode: 400 });
        }

        if (quantity > MAX_PER_ITEM) {
          throw Object.assign(new Error(`Máximo ${MAX_PER_ITEM} unidades por producto`), { statusCode: 400 });
        }

        const { rows } = await client.query(
          `SELECT p.*, c.name AS category_name, c.slug AS category_slug
           FROM products p
           JOIN categories c ON c.id = p.category_id
           WHERE p.id = $1 AND p.active = TRUE
           FOR UPDATE`,
          [productId]
        );

        const product = rows[0];
        if (!product) {
          throw Object.assign(new Error('Producto no encontrado'), { statusCode: 404 });
        }

        // Política de stock flexible: se permite vender aunque el stock viaje
        // esté en 0 o negativo (queda en negativo y se muestra como aviso).
        // Precio preferencial: el carrito permite ajustar el precio por unidad
        // para clientes con acuerdos especiales; si no llega, se usa el
        // mayorista vigente del producto.
        let unitPrice = Number(product.price_wholesale);
        if (item.unitPrice !== undefined && item.unitPrice !== null && String(item.unitPrice).trim() !== '') {
          const custom = Number(item.unitPrice);
          if (!Number.isFinite(custom) || custom < 0) {
            throw Object.assign(new Error('Precio unitario inválido'), { statusCode: 400 });
          }
          unitPrice = custom;
        }
        const lineTotal = unitPrice * quantity;
        subtotal += lineTotal;

        lineItems.push({ product, quantity, unitPrice, lineTotal });
      }

      let discountAmount = 0;
      if (discount === 'percent') {
        discountAmount = Math.min(subtotal, Math.round((subtotal * discountValueNum) / 100));
      } else if (discount === 'amount') {
        discountAmount = Math.min(subtotal, Math.round(discountValueNum * 100) / 100);
      }

      const total = Math.max(0, subtotal - discountAmount);

      const { rows: orderRows } = await client.query(
        `INSERT INTO orders (customer_name, total, discount_type, discount_value, discount_amount, notes, status, stock_applied)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', FALSE)
         RETURNING *`,
        [customerName.trim(), total, discount, discountValueNum, discountAmount, String(notes || '').trim()]
      );

      const orderRecord = orderRows[0];

      for (const line of lineItems) {
        await client.query(
          `INSERT INTO order_items (
            order_id, product_id, product_reference, product_description,
            quantity, unit_price, unit_cost, line_total
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            orderRecord.id,
            line.product.id,
            line.product.reference,
            line.product.description,
            line.quantity,
            line.unitPrice,
            Number(line.product.cost ?? 0),
            line.lineTotal,
          ]
        );
      }

      const { rows: itemRows } = await client.query(
        `SELECT * FROM order_items WHERE order_id = $1 ORDER BY id`,
        [orderRecord.id]
      );

      return { ...orderRecord, items: itemRows };
    });

    return {
      id: order.id,
      customerName: order.customer_name,
      status: order.status,
      subtotal: Number(order.total) + Number(order.discount_amount),
      discountType: order.discount_type,
      discountValue: Number(order.discount_value),
      discountAmount: Number(order.discount_amount),
      notes: order.notes || '',
      total: Number(order.total),
      createdAt: order.created_at,
      items: order.items.map((item) => ({
        reference: item.product_reference,
        description: item.product_description,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        lineTotal: Number(item.line_total),
      })),
    };
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({ error: error.message || 'Error al crear pedido' });
  }
});

// Edición de pedidos pendientes: permite ajustar cantidades, agregar/quitar
// productos y modificar cliente, descuento y notas. Los precios se recalculan
// con el precio mayorista vigente del producto (herramienta de presupuesto).
app.put('/api/orders/:id', { preHandler: authHook }, async (request, reply) => {
  const orderId = Number(request.params.id);
  const { customerName, items, discountType, discountValue, notes } = request.body || {};

  if (!customerName?.trim()) {
    return reply.code(400).send({ error: 'El nombre del cliente es obligatorio' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return reply.code(400).send({ error: 'El pedido debe tener al menos un producto' });
  }

  const discount = discountType || null;
  if (discount !== null && !['percent', 'amount'].includes(discount)) {
    return reply.code(400).send({ error: 'Tipo de descuento inválido' });
  }

  const discountValueNum = discount === null ? 0 : Number(discountValue) || 0;
  if (discount !== null && (!Number.isFinite(discountValueNum) || discountValueNum < 0)) {
    return reply.code(400).send({ error: 'Valor de descuento inválido' });
  }

  try {
    const order = await withTransaction(async (client) => {
      const { rows: orderRows } = await client.query(
        'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
        [orderId]
      );
      const current = orderRows[0];
      if (!current) {
        throw Object.assign(new Error('Pedido no encontrado'), { statusCode: 404 });
      }
      if (current.status !== 'pending') {
        throw Object.assign(new Error('Solo se pueden editar pedidos pendientes'), { statusCode: 400 });
      }

      let subtotal = 0;
      const lineItems = [];
      const seen = new Set();

      for (const item of items) {
        const quantity = Number(item.quantity);
        const productId = Number(item.productId);

        if (!productId || !Number.isInteger(quantity) || quantity < 1) {
          throw Object.assign(new Error('Cantidad inválida'), { statusCode: 400 });
        }
        if (quantity > MAX_PER_ITEM) {
          throw Object.assign(new Error(`Máximo ${MAX_PER_ITEM} unidades por producto`), { statusCode: 400 });
        }
        if (seen.has(productId)) {
          throw Object.assign(new Error('Producto duplicado en el pedido'), { statusCode: 400 });
        }
        seen.add(productId);

        const { rows } = await client.query(
          'SELECT id, reference, description, price_wholesale, cost FROM products WHERE id = $1',
          [productId]
        );
        const product = rows[0];
        if (!product) {
          throw Object.assign(new Error('Producto no encontrado'), { statusCode: 404 });
        }

        const unitPrice =
          item.unitPrice !== undefined && item.unitPrice !== null && String(item.unitPrice).trim() !== ''
            ? Number(item.unitPrice)
            : Number(product.price_wholesale);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw Object.assign(new Error('Precio unitario inválido'), { statusCode: 400 });
        }
        const lineTotal = unitPrice * quantity;
        subtotal += lineTotal;
        lineItems.push({ product, quantity, unitPrice, lineTotal });
      }

      let discountAmount = 0;
      if (discount === 'percent') {
        discountAmount = Math.min(subtotal, Math.round((subtotal * discountValueNum) / 100));
      } else if (discount === 'amount') {
        discountAmount = Math.min(subtotal, Math.round(discountValueNum * 100) / 100);
      }
      const total = Math.max(0, subtotal - discountAmount);

      await client.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
      for (const line of lineItems) {
        await client.query(
          `INSERT INTO order_items (
            order_id, product_id, product_reference, product_description,
            quantity, unit_price, unit_cost, line_total
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            orderId,
            line.product.id,
            line.product.reference,
            line.product.description,
            line.quantity,
            line.unitPrice,
            Number(line.product.cost ?? 0),
            line.lineTotal,
          ]
        );
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE orders
         SET customer_name = $1, total = $2, discount_type = $3, discount_value = $4,
             discount_amount = $5, notes = $6, updated_at = NOW()
         WHERE id = $7
         RETURNING *`,
        [customerName.trim(), total, discount, discountValueNum, discountAmount, String(notes || '').trim(), orderId]
      );

      const { rows: itemRows } = await client.query(
        'SELECT * FROM order_items WHERE order_id = $1 ORDER BY id',
        [orderId]
      );

      return { ...updatedRows[0], items: itemRows };
    });

    return {
      id: order.id,
      customerName: order.customer_name,
      status: order.status,
      subtotal: Number(order.total) + Number(order.discount_amount),
      discountType: order.discount_type,
      discountValue: Number(order.discount_value),
      discountAmount: Number(order.discount_amount),
      notes: order.notes || '',
      total: Number(order.total),
      createdAt: order.created_at,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.product_id,
        reference: item.product_reference,
        description: item.product_description,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        lineTotal: Number(item.line_total),
      })),
    };
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({ error: error.message || 'Error al editar el pedido' });
  }
});

app.get('/api/orders', { preHandler: authHook }, async (request) => {
  const { status } = request.query;
  const params = [];
  let where = '';

  if (status) {
    params.push(status);
    where = `WHERE o.status = $${params.length}`;
  }

  const { rows: orders } = await query(
    `SELECT o.* FROM orders o ${where} ORDER BY o.created_at DESC`,
    params
  );

  const result = [];
  for (const order of orders) {
    const { rows: items } = await query(
      `SELECT * FROM order_items WHERE order_id = $1 ORDER BY id`,
      [order.id]
    );
    result.push({
      id: order.id,
      customerName: order.customer_name,
      status: order.status,
      subtotal: Number(order.total) + Number(order.discount_amount),
      discountType: order.discount_type,
      discountValue: Number(order.discount_value),
      discountAmount: Number(order.discount_amount),
      notes: order.notes || '',
      total: Number(order.total),
      stockApplied: order.stock_applied,
      createdAt: order.created_at,
      deliveredAt: order.delivered_at,
      items: items.map((item) => ({
        id: item.id,
        productId: item.product_id,
        reference: item.product_reference,
        description: item.product_description,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        lineTotal: Number(item.line_total),
      })),
    });
  }

  return result;
});

app.get('/api/orders/:id/invoice', async (request, reply) => {
  const orderId = Number(request.params.id);

  const { rows: orderRows } = await query('SELECT * FROM orders WHERE id = $1', [orderId]);
  const order = orderRows[0];
  if (!order) {
    return reply.code(404).send({ error: 'Pedido no encontrado' });
  }

  const { rows: items } = await query(
    'SELECT * FROM order_items WHERE order_id = $1 ORDER BY id',
    [orderId]
  );

  if (!items.length) {
    return reply.code(404).send({ error: 'El pedido no tiene productos' });
  }

  try {
    const pdf = await buildInvoicePdf(order, items);
    const baDate = baYmd(new Date(order.created_at));
    return reply
      .type('application/pdf')
      .header(
        'Content-Disposition',
        `attachment; filename="presupuesto-SMG-${String(orderId).padStart(4, '0')}-${baDate}.pdf"`
      )
      .send(pdf);
  } catch (error) {
    app.log.error(error);
    return reply.code(500).send({ error: 'Error al generar el presupuesto' });
  }
});

app.patch('/api/orders/:id/deliver', { preHandler: authHook }, async (request, reply) => {
  const orderId = Number(request.params.id);

  try {
    const order = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      const current = rows[0];

      if (!current) {
        throw Object.assign(new Error('Pedido no encontrado'), { statusCode: 404 });
      }

      if (current.status === 'delivered') {
        throw Object.assign(new Error('El pedido ya fue entregado'), { statusCode: 400 });
      }

      if (current.status === 'cancelled') {
        throw Object.assign(new Error('No se puede entregar un pedido cancelado'), { statusCode: 400 });
      }

      const { rows: items } = await client.query(
        'SELECT * FROM order_items WHERE order_id = $1',
        [orderId]
      );

      if (!current.stock_applied) {
        // Stock flexible: se descuenta del depósito "viaje" aunque quede
        // negativo (la venta ya está registrada y facturada).
        for (const item of items) {
          await client.query(
            'UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2',
            [item.quantity, item.product_id]
          );
        }
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE orders
         SET status = 'delivered', stock_applied = TRUE, delivered_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [orderId]
      );

      return updatedRows[0];
    });

    return {
      id: order.id,
      status: order.status,
      stockApplied: order.stock_applied,
      deliveredAt: order.delivered_at,
    };
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({ error: error.message || 'Error al marcar entregado' });
  }
});

app.patch('/api/orders/:id/cancel', { preHandler: authHook }, async (request, reply) => {
  const orderId = Number(request.params.id);

  try {
    const order = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      const current = rows[0];

      if (!current) {
        throw Object.assign(new Error('Pedido no encontrado'), { statusCode: 404 });
      }

      if (current.status !== 'pending') {
        throw Object.assign(new Error('Solo se pueden cancelar pedidos pendientes'), { statusCode: 400 });
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE orders SET status = 'cancelled' WHERE id = $1 RETURNING *`,
        [orderId]
      );

      return updatedRows[0];
    });

    return { id: order.id, status: order.status };
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({ error: error.message || 'Error al cancelar pedido' });
  }
});

// Restablecer un pedido cancelado para retomarlo (vuelve a Pendiente).
app.patch('/api/orders/:id/restore', { preHandler: authHook }, async (request, reply) => {
  const orderId = Number(request.params.id);

  try {
    const order = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      const current = rows[0];

      if (!current) {
        throw Object.assign(new Error('Pedido no encontrado'), { statusCode: 404 });
      }

      if (current.status !== 'cancelled') {
        throw Object.assign(new Error('Solo se pueden restablecer pedidos cancelados'), { statusCode: 400 });
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE orders SET status = 'pending' WHERE id = $1 RETURNING *`,
        [orderId]
      );

      return updatedRows[0];
    });

    return { id: order.id, status: order.status };
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({ error: error.message || 'Error al restablecer pedido' });
  }
});

// Reabrir un pedido entregado: vuelve a Pendiente y devuelve el stock
// descontado al depósito "viaje". Si se vuelve a entregar, el stock se
// descuenta de nuevo (stock_applied vuelve a FALSE).
app.patch('/api/orders/:id/reopen', { preHandler: authHook }, async (request, reply) => {
  const orderId = Number(request.params.id);

  try {
    const order = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
      const current = rows[0];

      if (!current) {
        throw Object.assign(new Error('Pedido no encontrado'), { statusCode: 404 });
      }

      if (current.status !== 'delivered') {
        throw Object.assign(new Error('Solo se pueden reabrir pedidos entregados'), { statusCode: 400 });
      }

      if (current.stock_applied) {
        const { rows: items } = await client.query(
          'SELECT * FROM order_items WHERE order_id = $1',
          [orderId]
        );
        for (const item of items) {
          await client.query(
            'UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2',
            [item.quantity, item.product_id]
          );
        }
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE orders SET status = 'pending', stock_applied = FALSE, delivered_at = NULL
         WHERE id = $1 RETURNING *`,
        [orderId]
      );

      return updatedRows[0];
    });

    return { id: order.id, status: order.status, stockApplied: order.stock_applied };
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({ error: error.message || 'Error al reabrir pedido' });
  }
});

app.get('/api/admin/reports/summary', { preHandler: authHook }, async () => {
  const { rows: totals } = await query(`
    SELECT
      COUNT(*)::int AS total_orders,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_orders,
      COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered_orders,
      COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_orders,
      COALESCE(SUM(total) FILTER (WHERE status = 'delivered'), 0) AS delivered_revenue,
      COALESCE(SUM(total) FILTER (WHERE status = 'pending'), 0) AS pending_revenue
    FROM orders
  `);

  // Rentabilidad de los pedidos entregados: costo congelado en el pedido
  // (unit_cost) o costo vigente del producto como respaldo. El descuento del
  // pedido reduce lo cobrado pero no el costo.
  const { rows: profit } = await query(`
    SELECT
      COALESCE(SUM(
        COALESCE(NULLIF(oi.unit_cost, 0), p.cost, 0) * oi.quantity
      ), 0) AS delivered_cost,
      COALESCE(SUM(
        oi.line_total * (1 - CASE WHEN (o.total + o.discount_amount) > 0
             THEN o.discount_amount::numeric / (o.total + o.discount_amount)
             ELSE 0 END)
        - COALESCE(NULLIF(oi.unit_cost, 0), p.cost, 0) * oi.quantity
      ), 0) AS delivered_profit
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.status = 'delivered'
  `);

  const { rows: topProducts } = await query(`
    SELECT oi.product_reference AS reference,
           oi.product_description AS description,
           SUM(oi.quantity)::int AS units,
           SUM(oi.line_total) AS total
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status <> 'cancelled'
    GROUP BY oi.product_reference, oi.product_description
    ORDER BY units DESC
    LIMIT 10
  `);

  const { rows: daily } = await query(`
    SELECT to_char(date_trunc('day', o.created_at), 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS orders,
           COALESCE(SUM(o.total), 0) AS total
    FROM orders o
    WHERE o.status <> 'cancelled' AND o.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY 1
    ORDER BY 1 DESC
  `);

  return {
    totals: {
      totalOrders: totals[0].total_orders,
      pending: totals[0].pending_orders,
      delivered: totals[0].delivered_orders,
      cancelled: totals[0].cancelled_orders,
      deliveredRevenue: Number(totals[0].delivered_revenue),
      pendingRevenue: Number(totals[0].pending_revenue),
      deliveredCost: Number(profit[0].delivered_cost),
      deliveredProfit: Number(profit[0].delivered_profit),
    },
    topProducts: topProducts.map((row) => ({
      reference: row.reference,
      description: row.description,
      units: row.units,
      total: Number(row.total),
    })),
    daily: daily.map((row) => ({ day: row.day, orders: row.orders, total: Number(row.total) })),
  };
});

app.get('/api/admin/reports/sales', { preHandler: authHook }, async (request, reply) => {
  const { from, to, groupBy } = request.query;
  const group = groupBy === 'client' ? 'client' : 'product';

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const fromDate = from || '1970-01-01';
  const toDate = to || '9999-12-31';
  if (!datePattern.test(fromDate) || !datePattern.test(toDate)) {
    return reply.code(400).send({ error: 'Formato de fecha inválido. Usá YYYY-MM-DD' });
  }
  if (fromDate > toDate) {
    return reply.code(400).send({ error: 'La fecha "desde" no puede ser posterior a "hasta"' });
  }

  // Costo congelado en el pedido (unit_cost) o costo vigente del producto como
  // respaldo para pedidos anteriores al snapshot.
  const costExpr = 'COALESCE(NULLIF(oi.unit_cost, 0), p.cost, 0)';

  if (group === 'client') {
    const { rows } = await query(
      `SELECT o.customer_name AS customer,
              COUNT(o.id)::int AS orders,
              COUNT(o.id) FILTER (WHERE o.status = 'delivered')::int AS delivered_orders,
              COALESCE(SUM(item.qty), 0)::int AS units,
              SUM(o.total) AS revenue,
              COALESCE(SUM(item.cost), 0) AS cost
       FROM orders o
       LEFT JOIN (
         SELECT oi.order_id,
                SUM(oi.quantity)::int AS qty,
                SUM(${costExpr} * oi.quantity) AS cost
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         GROUP BY oi.order_id
       ) item ON item.order_id = o.id
       WHERE o.status <> 'cancelled'
         AND o.created_at >= $1::date
         AND o.created_at < ($2::date + INTERVAL '1 day')
       GROUP BY o.customer_name
       ORDER BY revenue DESC`,
      [fromDate, toDate]
    );

    const { rows: totals } = await query(
      `SELECT COUNT(*)::int AS orders,
              COALESCE(SUM(o.total), 0) AS revenue,
              COALESCE(SUM(item.cost), 0) AS cost
       FROM orders o
       LEFT JOIN (
         SELECT oi.order_id,
                SUM(${costExpr} * oi.quantity) AS cost
         FROM order_items oi
         LEFT JOIN products p ON p.id = oi.product_id
         GROUP BY oi.order_id
       ) item ON item.order_id = o.id
       WHERE o.status <> 'cancelled'
         AND o.created_at >= $1::date
         AND o.created_at < ($2::date + INTERVAL '1 day')`,
      [fromDate, toDate]
    );

    return {
      groupBy: 'client',
      from: fromDate,
      to: toDate,
      totals: {
        orders: totals[0].orders,
        revenue: Number(totals[0].revenue),
        cost: Number(totals[0].cost),
        profit: Number(totals[0].revenue) - Number(totals[0].cost),
      },
      rows: rows.map((row) => {
        const revenue = Number(row.revenue);
        const cost = Number(row.cost);
        return {
          customer: row.customer,
          orders: row.orders,
          deliveredOrders: row.delivered_orders,
          units: row.units,
          revenue,
          cost,
          profit: revenue - cost,
        };
      }),
    };
  }

  // El descuento es por pedido; lo repartimos proporcionalmente entre los
  // items para que "Facturado" coincida con el informe por cliente.
  const discountRatio = `
    (1 - CASE WHEN (o.total + o.discount_amount) > 0
         THEN o.discount_amount::numeric / (o.total + o.discount_amount)
         ELSE 0 END)`;

  const { rows } = await query(
    `SELECT oi.product_reference AS reference,
            oi.product_description AS description,
            COUNT(DISTINCT o.id)::int AS orders,
            SUM(oi.quantity)::int AS units,
            SUM(oi.line_total * ${discountRatio}) AS revenue,
            SUM(${costExpr} * oi.quantity) AS cost
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.status <> 'cancelled'
       AND o.created_at >= $1::date
       AND o.created_at < ($2::date + INTERVAL '1 day')
     GROUP BY oi.product_reference, oi.product_description
     ORDER BY revenue DESC`,
    [fromDate, toDate]
  );

  const { rows: stocks } = await query('SELECT reference, stock, stock_casa FROM products');
  const stockByReference = new Map(
    stocks.map((product) => [
      product.reference,
      { stockViaje: Number(product.stock), stockCasa: Number(product.stock_casa ?? 0) },
    ])
  );

  const { rows: totals } = await query(
    `SELECT COUNT(DISTINCT o.id)::int AS orders,
            COALESCE(SUM(oi.quantity), 0)::int AS units,
            COALESCE(SUM(oi.line_total * ${discountRatio}), 0) AS revenue,
            COALESCE(SUM(${costExpr} * oi.quantity), 0) AS cost
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.status <> 'cancelled'
       AND o.created_at >= $1::date
       AND o.created_at < ($2::date + INTERVAL '1 day')`,
    [fromDate, toDate]
  );

  return {
    groupBy: 'product',
    from: fromDate,
    to: toDate,
    totals: {
      orders: totals[0].orders,
      units: totals[0].units,
      revenue: Number(totals[0].revenue),
      cost: Number(totals[0].cost),
      profit: Number(totals[0].revenue) - Number(totals[0].cost),
    },
    rows: rows.map((row) => {
      const revenue = Number(row.revenue);
      const cost = Number(row.cost);
      return {
        reference: row.reference,
        description: row.description,
        orders: row.orders,
        units: row.units,
        revenue,
        cost,
        profit: revenue - cost,
        stockViaje: stockByReference.get(row.reference)?.stockViaje ?? 0,
        stockCasa: stockByReference.get(row.reference)?.stockCasa ?? 0,
      };
    }),
  };
});

app.post('/api/admin/login', async (request, reply) => {
  const { password } = request.body || {};
  if (password !== ADMIN_PASSWORD) {
    return reply.code(401).send({ error: 'Contraseña incorrecta' });
  }

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
  return { token };
});

app.get('/api/admin/products', { preHandler: authHook }, async () => {
  const { rows } = await query(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
     FROM products p
     JOIN categories c ON c.id = p.category_id
     ORDER BY p.reference`
  );
  return rows.map((row) => formatProduct(row, { withCost: true }));
});

// Alta manual de un producto (no pasa por el Excel): útil para piezas nuevas
// o códigos puntuales. Crea la categoría si no existe y queda activo.
app.post('/api/admin/products', { preHandler: authHook }, async (request, reply) => {
  const {
    reference,
    description,
    category,
    stock,
    stockCasa,
    cost,
    priceWholesale,
    priceRetail,
    priceMl,
  } = request.body || {};

  const ref = String(reference || '').trim().toUpperCase();
  if (!ref) {
    return reply.code(400).send({ error: 'El código es obligatorio' });
  }
  if (ref.length > 50) {
    return reply.code(400).send({ error: 'El código no puede superar 50 caracteres' });
  }

  const numbers = {
    stock: Number(stock) || 0,
    stockCasa: Number(stockCasa) || 0,
    cost: Number(cost) || 0,
    priceWholesale: Number(priceWholesale) || 0,
    priceRetail: Number(priceRetail) || 0,
    priceMl: Number(priceMl) || 0,
  };
  for (const [key, value] of Object.entries(numbers)) {
    if (!Number.isFinite(value) || value < 0) {
      return reply.code(400).send({ error: `El campo ${key} no puede ser negativo` });
    }
  }

  const categoryName = String(category || '').trim() || 'SIN CATEGORIA';

  try {
    const product = await withTransaction(async (client) => {
      const { rows: categoryRows } = await client.query(
        `INSERT INTO categories (name, slug) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [categoryName, categoryName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')]
      );

      const { rows } = await client.query(
        `INSERT INTO products (
          reference, category_id, description, stock, stock_casa, cost,
          price_wholesale, price_retail, price_ml, active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
        RETURNING *`,
        [
          ref,
          categoryRows[0].id,
          String(description || '').trim(),
          Math.floor(numbers.stock),
          Math.floor(numbers.stockCasa),
          numbers.cost,
          numbers.priceWholesale,
          numbers.priceRetail,
          numbers.priceMl,
        ]
      );

      return rows[0];
    });

    const { rows: full } = await query(
      `SELECT p.*, c.name AS category_name, c.slug AS category_slug
       FROM products p
       JOIN categories c ON c.id = p.category_id
       WHERE p.id = $1`,
      [product.id]
    );

    return reply.code(201).send(formatProduct(full[0], { withCost: true }));
  } catch (error) {
    if (error.code === '23505') {
      return reply.code(400).send({ error: `Ya existe un producto con el código ${ref}` });
    }
    return reply.code(500).send({ error: error.message || 'Error al crear el producto' });
  }
});

app.put('/api/admin/products/:id', { preHandler: authHook }, async (request, reply) => {
  const id = Number(request.params.id);
  const {
    description,
    stock,
    stockCasa,
    cost,
    priceWholesale,
    priceRetail,
    priceMl,
    active,
  } = request.body || {};

  const { rows } = await query(
    `UPDATE products SET
      description = COALESCE($2, description),
      stock = COALESCE($3, stock),
      stock_casa = COALESCE($4, stock_casa),
      cost = COALESCE($5, cost),
      price_wholesale = COALESCE($6, price_wholesale),
      price_retail = COALESCE($7, price_retail),
      price_ml = COALESCE($8, price_ml),
      active = COALESCE($9, active),
      updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, description, stock, stockCasa, cost, priceWholesale, priceRetail, priceMl, active]
  );

  if (!rows[0]) {
    return reply.code(404).send({ error: 'Producto no encontrado' });
  }

  const { rows: full } = await query(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
     FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.id = $1`,
    [id]
  );

  return formatProduct(full[0], { withCost: true });
});

// Guardado masivo: actualiza todos los productos modificados en una sola
// transacción (botón "Guardar todos los cambios" del panel admin).
app.put('/api/admin/products/bulk', { preHandler: authHook }, async (request, reply) => {
  const products = request.body?.products;
  if (!Array.isArray(products) || products.length === 0) {
    return reply.code(400).send({ error: 'No hay productos para guardar' });
  }

  try {
    let updated = 0;
    await withTransaction(async (client) => {
      for (const product of products) {
        const id = Number(product.id);
        if (!id) {
          throw Object.assign(new Error('Producto con id inválido'), { statusCode: 400 });
        }

        const stock = product.stock != null ? Number(product.stock) : null;
        const stockCasa = product.stockCasa != null ? Number(product.stockCasa) : null;
        const cost = product.cost != null ? Number(product.cost) : null;
        const priceWholesale = product.priceWholesale != null ? Number(product.priceWholesale) : null;

        for (const value of [stock, stockCasa, cost, priceWholesale]) {
          if (value !== null && (!Number.isFinite(value) || value < 0)) {
            throw Object.assign(
              new Error('Stock, costo y precios no pueden ser negativos'),
              { statusCode: 400 }
            );
          }
        }

        const { rowCount } = await client.query(
          `UPDATE products SET
            description = COALESCE($2, description),
            stock = COALESCE($3, stock),
            stock_casa = COALESCE($4, stock_casa),
            cost = COALESCE($5, cost),
            price_wholesale = COALESCE($6, price_wholesale),
            active = COALESCE($7, active),
            updated_at = NOW()
           WHERE id = $1`,
          [
            id,
            product.description != null ? String(product.description) : null,
            stock,
            stockCasa,
            cost,
            priceWholesale,
            product.active != null ? Boolean(product.active) : null,
          ]
        );
        updated += rowCount;
      }
    });

    return { updated };
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({ error: error.message || 'Error al guardar productos' });
  }
});

app.post('/api/admin/products/:id/transfer', { preHandler: authHook }, async (request, reply) => {
  const productId = Number(request.params.id);
  const { from, to, quantity } = request.body || {};

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) {
    return reply.code(400).send({ error: 'Cantidad inválida' });
  }

  // El depósito de reposición se llama "oficina" (antes "casa"). Se acepta
  // también el valor viejo para no romper clientes existentes.
  const normalizeDeposit = (deposit) =>
    deposit === 'casa' || deposit === 'oficina' ? 'oficina' : deposit;
  const fromNorm = normalizeDeposit(from);
  const toNorm = normalizeDeposit(to);

  if (!['oficina', 'viaje'].includes(fromNorm) || !['oficina', 'viaje'].includes(toNorm) || fromNorm === toNorm) {
    return reply.code(400).send({ error: 'Origen o destino de traslado inválido' });
  }

  const fromColumn = fromNorm === 'oficina' ? 'stock_casa' : 'stock';
  const toColumn = toNorm === 'oficina' ? 'stock_casa' : 'stock';
  const fromLabel = fromNorm;

  try {
    const product = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT * FROM products WHERE id = $1 FOR UPDATE',
        [productId]
      );
      const current = rows[0];
      if (!current) {
        throw Object.assign(new Error('Producto no encontrado'), { statusCode: 404 });
      }

      if (current[fromColumn] < qty) {
        throw Object.assign(
          new Error(`Stock insuficiente en ${fromLabel}. Disponible: ${current[fromColumn]}`),
          { statusCode: 400 }
        );
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE products
         SET ${fromColumn} = ${fromColumn} - $1,
             ${toColumn} = ${toColumn} + $1,
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [qty, productId]
      );
      return updatedRows[0];
    });

    return {
      id: product.id,
      reference: product.reference,
      stock: Number(product.stock),
      stockCasa: Number(product.stock_casa),
    };
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({ error: error.message || 'Error al trasladar stock' });
  }
});

// Sumar stock (mercadería nueva que entra): con un "+" desde el listado se
// registra lo que llegó, sin tener que editar el input a mano.
app.post('/api/admin/products/:id/add-stock', { preHandler: authHook }, async (request, reply) => {
  const productId = Number(request.params.id);
  const { deposit, quantity } = request.body || {};

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) {
    return reply.code(400).send({ error: 'Cantidad inválida' });
  }

  const normalized = deposit === 'casa' || deposit === 'oficina' ? 'oficina' : deposit;
  if (!['oficina', 'viaje'].includes(normalized)) {
    return reply.code(400).send({ error: 'Depósito inválido (oficina o viaje)' });
  }

  const column = normalized === 'oficina' ? 'stock_casa' : 'stock';

  try {
    const product = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT * FROM products WHERE id = $1 FOR UPDATE',
        [productId]
      );
      if (!rows[0]) {
        throw Object.assign(new Error('Producto no encontrado'), { statusCode: 404 });
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE products
         SET ${column} = ${column} + $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [qty, productId]
      );
      return updatedRows[0];
    });

    return {
      id: product.id,
      reference: product.reference,
      stock: Number(product.stock),
      stockCasa: Number(product.stock_casa),
    };
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return reply.code(statusCode).send({ error: error.message || 'Error al sumar stock' });
  }
});

// Exporta todo el catálogo a un Excel editable (cambios masivos de precios,
// descripciones, stocks...). Las columnas coinciden con las que entiende el
// import, así el mismo archivo se puede volver a subir actualizado.
app.get('/api/admin/products/export', { preHandler: authHook }, async (request, reply) => {
  try {
    const { rows } = await query(
      `SELECT p.*, c.name AS category_name
       FROM products p
       JOIN categories c ON c.id = p.category_id
       ORDER BY p.reference`
    );

    const data = rows.map((product) => ({
      'Cod interno': product.reference,
      'Categoria': product.category_name,
      'Descripción': product.description,
      'Costo': Number(product.cost ?? 0),
      'REDONDEO MAYORISTA': Number(product.price_wholesale),
      'REDONDEO MINORISTA': Number(product.price_retail ?? 0),
      'REDONDEO ML': Number(product.price_ml ?? 0),
      'Stock viaje': Number(product.stock ?? 0),
      'Stock oficina': Number(product.stock_casa ?? 0),
      'Activo': product.active ? 'SÍ' : 'NO',
    }));

    const sheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Productos');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return reply
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="productos-${baYmd(new Date())}.xlsx"`)
      .send(buffer);
  } catch (error) {
    return reply.code(500).send({ error: error.message || 'Error al exportar productos' });
  }
});

// Importa un Excel subido (editado a partir del export) y aplica los cambios
// masivos: alta de productos nuevos, actualización de precios/descripciones/
// stocks y el estado Activo. El stock de oficina y el estado solo se tocan si
// el archivo trae esas columnas; el historial de pedidos no se modifica.
app.post('/api/admin/products/import', { preHandler: authHook }, async (request, reply) => {
  try {
    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: 'Subí un archivo Excel (.xlsx o .xls)' });
    }

    const ext = path.extname(file.filename || '').toLowerCase();
    if (!['.xlsx', '.xls'].includes(ext)) {
      return reply.code(400).send({ error: 'El archivo debe ser .xlsx o .xls' });
    }

    const chunks = [];
    for await (const chunk of file.file) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    if (buffer.length === 0) {
      return reply.code(400).send({ error: 'El archivo está vacío' });
    }

    let workbook;
    try {
      workbook = XLSX.read(buffer);
    } catch {
      return reply.code(400).send({ error: 'Archivo inválido: no se pudo leer como Excel (.xlsx o .xls)' });
    }
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const products = parseProductRows(rows, null);

    if (products.length === 0) {
      return reply.code(400).send({
        error: 'El archivo no tiene productos válidos. La columna de códigos debe llamarse "Cod interno".',
      });
    }

    // Si el archivo repite códigos, la última fila gana (contadores claros).
    const uniqueProducts = [...new Map(products.map((p) => [p.reference, p])).values()];

    let created = 0;
    let updated = 0;

    await withTransaction(async (client) => {
      for (const product of uniqueProducts) {
        const { rows: categoryRows } = await client.query(
          `INSERT INTO categories (name, slug) VALUES ($1, $2)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [product.category, slugify(product.category)]
        );

        const { rows: inserted } = await client.query(
          `INSERT INTO products (
            reference, category_id, description, stock, stock_casa, cost,
            price_wholesale, price_retail, price_ml, active
          ) VALUES ($1, $2, $3, $4, COALESCE($5, 0), $6, $7, $8, $9, COALESCE($10, TRUE))
          ON CONFLICT (reference) DO UPDATE SET
            category_id = EXCLUDED.category_id,
            description = EXCLUDED.description,
            stock = EXCLUDED.stock,
            stock_casa = COALESCE(EXCLUDED.stock_casa, products.stock_casa),
            cost = EXCLUDED.cost,
            price_wholesale = EXCLUDED.price_wholesale,
            price_retail = EXCLUDED.price_retail,
            price_ml = EXCLUDED.price_ml,
            active = COALESCE(EXCLUDED.active, products.active),
            updated_at = NOW()
          RETURNING (xmax = 0) AS inserted`,
          [
            product.reference,
            categoryRows[0].id,
            product.description,
            product.stock,
            product.stockCasa,
            product.cost,
            product.priceWholesale,
            product.priceRetail,
            product.priceMl,
            product.active,
          ]
        );

        if (inserted[0].inserted) created += 1;
        else updated += 1;
      }
    });

    return { imported: uniqueProducts.length, created, updated };
  } catch (error) {
    return reply.code(500).send({ error: error.message || 'Error al importar productos' });
  }
});

app.post('/api/admin/reseed', { preHandler: authHook }, async (request, reply) => {
  try {
    await query('TRUNCATE order_items, orders, products, categories RESTART IDENTITY CASCADE');
    await seedDatabase();
    return { ok: true };
  } catch (error) {
    return reply.code(500).send({ error: error.message });
  }
});

// Reemplaza el catálogo con el Excel vigente (bijou.xlsx): actualiza/inserta
// todos los productos del archivo (reactivándolos) y desactiva los que ya no
// figuren. El historial de pedidos se conserva intacto.
app.post('/api/admin/import-excel', { preHandler: authHook }, async (request, reply) => {
  try {
    const excelPath = resolveExcelPath();
    const importAssetsDir = assetsDir || process.env.ASSETS_DIR || '/app/products-assets';
    const products = parseProductsFromExcel(excelPath, importAssetsDir);

    if (products.length === 0) {
      return reply.code(400).send({ error: 'El Excel no tiene productos válidos' });
    }

    const references = products.map((product) => product.reference);
    let deactivated = 0;

    await withTransaction(async (client) => {
      for (const product of products) {
        const slug = product.category.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');
        const { rows: categoryRows } = await client.query(
          `INSERT INTO categories (name, slug) VALUES ($1, $2)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [product.category, slug]
        );

        await client.query(
          `INSERT INTO products (reference, category_id, description, stock, cost, price_wholesale, price_retail, price_ml, image_path, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
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

      // Los productos que ya no están en el Excel quedan inactivos (no se
      // borran: el historial de pedidos los sigue referenciando).
      const { rowCount } = await client.query(
        'UPDATE products SET active = FALSE, updated_at = NOW() WHERE reference <> ALL($1)',
        [references]
      );
      deactivated = rowCount;
    });

    return {
      imported: products.length,
      deactivated,
      excel: path.basename(excelPath),
    };
  } catch (error) {
    return reply.code(500).send({ error: error.message });
  }
});

try {
  await migrate();
} catch (error) {
  app.log.error({ err: error }, 'Migración de base de datos fallida');
  process.exit(1);
}

const port = Number(process.env.PORT || 4000);
const host = '0.0.0.0';

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});

process.on('SIGTERM', () => pool.end());
