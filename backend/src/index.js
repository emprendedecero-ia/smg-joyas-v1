import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import jwt from 'jsonwebtoken';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { pool, query, withTransaction } from './db.js';
import { MAX_PER_ITEM, parseProductsFromExcel, seedDatabase } from './seed.js';

function formatMoney(value) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  }).format(value);
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
      .text('Catálogo mayorista · Ventas', left, 62);

    doc
      .fillColor(GOLD_DARK)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text('FACTURA', rightEdge - 120, 32, { width: 120, align: 'right' });
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text(`N.º ${String(order.id).padStart(5, '0')}`, rightEdge - 120, 58, { width: 120, align: 'right' });

    // Datos del pedido
    const dateStr = new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date(order.created_at));

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
        'Documento generado por SMG Joyería — detalle de venta mayorista. No es comprobante fiscal.',
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

function formatProduct(row) {
  return {
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

  return rows.map(formatProduct);
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
        const unitPrice = Number(product.price_wholesale);
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
            quantity, unit_price, line_total
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            orderRecord.id,
            line.product.id,
            line.product.reference,
            line.product.description,
            line.quantity,
            line.unitPrice,
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
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `attachment; filename="factura-SMG-${orderId}.pdf"`)
      .send(pdf);
  } catch (error) {
    app.log.error(error);
    return reply.code(500).send({ error: 'Error al generar la factura' });
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

  if (group === 'client') {
    const { rows } = await query(
      `SELECT o.customer_name AS customer,
              COUNT(o.id)::int AS orders,
              COUNT(o.id) FILTER (WHERE o.status = 'delivered')::int AS delivered_orders,
              COALESCE(SUM(item.qty), 0)::int AS units,
              SUM(o.total) AS revenue
       FROM orders o
       LEFT JOIN (
         SELECT order_id, SUM(quantity)::int AS qty
         FROM order_items
         GROUP BY order_id
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
              COALESCE(SUM(o.total), 0) AS revenue
       FROM orders o
       WHERE o.status <> 'cancelled'
         AND o.created_at >= $1::date
         AND o.created_at < ($2::date + INTERVAL '1 day')`,
      [fromDate, toDate]
    );

    return {
      groupBy: 'client',
      from: fromDate,
      to: toDate,
      totals: { orders: totals[0].orders, revenue: Number(totals[0].revenue) },
      rows: rows.map((row) => ({
        customer: row.customer,
        orders: row.orders,
        deliveredOrders: row.delivered_orders,
        units: row.units,
        revenue: Number(row.revenue),
      })),
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
            SUM(oi.line_total * ${discountRatio}) AS revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
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
            COALESCE(SUM(oi.line_total * ${discountRatio}), 0) AS revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
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
    },
    rows: rows.map((row) => ({
      reference: row.reference,
      description: row.description,
      orders: row.orders,
      units: row.units,
      revenue: Number(row.revenue),
      stockViaje: stockByReference.get(row.reference)?.stockViaje ?? 0,
      stockCasa: stockByReference.get(row.reference)?.stockCasa ?? 0,
    })),
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
  return rows.map(formatProduct);
});

app.put('/api/admin/products/:id', { preHandler: authHook }, async (request, reply) => {
  const id = Number(request.params.id);
  const {
    description,
    stock,
    stockCasa,
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
      price_wholesale = COALESCE($5, price_wholesale),
      price_retail = COALESCE($6, price_retail),
      price_ml = COALESCE($7, price_ml),
      active = COALESCE($8, active),
      updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, description, stock, stockCasa, priceWholesale, priceRetail, priceMl, active]
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

  return formatProduct(full[0]);
});

app.post('/api/admin/products/:id/transfer', { preHandler: authHook }, async (request, reply) => {
  const productId = Number(request.params.id);
  const { from, to, quantity } = request.body || {};

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1) {
    return reply.code(400).send({ error: 'Cantidad inválida' });
  }

  if (!['casa', 'viaje'].includes(from) || !['casa', 'viaje'].includes(to) || from === to) {
    return reply.code(400).send({ error: 'Origen o destino de traslado inválido' });
  }

  const fromColumn = from === 'casa' ? 'stock_casa' : 'stock';
  const toColumn = to === 'casa' ? 'stock_casa' : 'stock';
  const fromLabel = from === 'casa' ? 'casa' : 'viaje';

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

app.post('/api/admin/reseed', { preHandler: authHook }, async (request, reply) => {
  try {
    await query('TRUNCATE order_items, orders, products, categories RESTART IDENTITY CASCADE');
    await seedDatabase();
    return { ok: true };
  } catch (error) {
    return reply.code(500).send({ error: error.message });
  }
});

app.post('/api/admin/import-excel', { preHandler: authHook }, async (request, reply) => {
  try {
    const excelPath = process.env.EXCEL_PATH || '/app/precios.xlsx';
    const importAssetsDir = assetsDir || process.env.ASSETS_DIR || '/app/products-assets';
    const products = parseProductsFromExcel(excelPath, importAssetsDir);

    for (const product of products) {
      const slug = product.category.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-');
      const { rows: categoryRows } = await query(
        `INSERT INTO categories (name, slug) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [product.category, slug]
      );

      await query(
        `INSERT INTO products (reference, category_id, description, stock, cost, price_wholesale, price_retail, price_ml, image_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
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

    return { imported: products.length };
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
