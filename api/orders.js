const { db, sendError } = require('./_db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return sendError(res, 405, 'Método no permitido.');
  const body = req.body || {}; const customerName = String(body.customerName || '').trim(); const items = Array.isArray(body.items) ? body.items : [];
  const discountType = body.discountType === 'percent' ? 'percent' : 'amount'; const discountValue = Number(body.discountValue || 0);
  if (!customerName || !items.length || items.length > 100 || !Number.isFinite(discountValue) || discountValue < 0) return sendError(res, 400, 'Pedido inválido.');
  const cleanItems = items.map((item) => ({ productId: Number(item.productId) || null, code: String(item.code || '').trim(), name: String(item.name || item.code || '').trim(), quantity: Number(item.quantity), unitPrice: Number(item.unitPrice) }));
  if (cleanItems.some((item) => !item.code || !item.name || !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0)) return sendError(res, 400, 'Los productos del pedido no son válidos.');
  const subtotal = cleanItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const discountTotal = Math.min(subtotal, discountType === 'percent' ? subtotal * Math.min(discountValue, 100) / 100 : discountValue);
  try {
    const sql = db();
    const result = await sql.begin(async (transaction) => {
      const [order] = await transaction`INSERT INTO orders (customer_name, subtotal, discount_type, discount_value, discount_total, total) VALUES (${customerName}, ${subtotal}, ${discountType}, ${discountValue}, ${discountTotal}, ${subtotal - discountTotal}) RETURNING id, total, discount_total AS "discountTotal"`;
      for (const item of cleanItems) await transaction`INSERT INTO order_items (order_id, product_id, product_code, product_name, quantity, unit_price, line_total) VALUES (${order.id}, ${item.productId}, ${item.code}, ${item.name}, ${item.quantity}, ${item.unitPrice}, ${item.quantity * item.unitPrice})`;
      return order;
    });
    return res.status(201).json(result);
  } catch (error) { return sendError(res, 500, error.message || 'No se pudo guardar el pedido.'); }
};
