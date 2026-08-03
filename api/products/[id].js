const { db, isAdmin, sendError } = require('../_db');

module.exports = async (req, res) => {
  if (!isAdmin(req)) return sendError(res, 401, 'No autorizado.');
  const id = Number(req.query.id);
  if (!Number.isInteger(id)) return sendError(res, 400, 'Producto inválido.');
  try {
    const sql = db();
    if (req.method === 'DELETE') { await sql`UPDATE products SET active = false, updated_at = NOW() WHERE id = ${id}`; return res.status(204).end(); }
    if (req.method !== 'PATCH') return sendError(res, 405, 'Método no permitido.');
    const body = req.body || {}; const code = String(body.code || '').trim().toUpperCase(); const name = String(body.name || code).trim(); const category = String(body.category || '').trim(); const price = Number(body.price);
    if (!code || !name || !category || !Number.isFinite(price) || price < 0) return sendError(res, 400, 'Datos de producto inválidos.');
    const imageUrl = String(body.imageUrl || '').trim() || null; const active = body.active !== false;
    const [row] = await sql`UPDATE products SET code = ${code}, name = ${name}, category = ${category}, price = ${price}, image_url = ${imageUrl}, active = ${active}, updated_at = NOW() WHERE id = ${id} RETURNING id, code, name, category, price, image_url AS "imageUrl", active`;
    if (!row) return sendError(res, 404, 'Producto no encontrado.');
    return res.status(200).json(row);
  } catch (error) { if (error.code === '23505') return sendError(res, 409, 'Ese código ya existe.'); return sendError(res, 500, error.message || 'No se pudo actualizar.'); }
};
