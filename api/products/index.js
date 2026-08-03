const { db, isAdmin, sendError } = require('../_db');

function validProduct(body) {
  const code = String(body.code || '').trim().toUpperCase();
  const name = String(body.name || code).trim();
  const category = String(body.category || '').trim();
  const price = Number(body.price);
  if (!code || !name || !category || !Number.isFinite(price) || price < 0) return null;
  return { code, name, category, price, imageUrl: String(body.imageUrl || '').trim() || null, active: body.active !== false };
}

module.exports = async (req, res) => {
  try {
    const sql = db();
    if (req.method === 'GET') {
      const rows = isAdmin(req)
        ? await sql`SELECT id, code, name, category, price, image_url AS "imageUrl", active FROM products ORDER BY category, code`
        : await sql`SELECT id, code, name, category, price, image_url AS "imageUrl" FROM products WHERE active = true ORDER BY category, code`;
      return res.status(200).json(rows);
    }
    if (req.method !== 'POST') return sendError(res, 405, 'Método no permitido.');
    if (!isAdmin(req)) return sendError(res, 401, 'No autorizado.');
    const product = validProduct(req.body || {});
    if (!product) return sendError(res, 400, 'Completá código, nombre, categoría y precio válido.');
    const [row] = await sql`INSERT INTO products (code, name, category, price, image_url, active) VALUES (${product.code}, ${product.name}, ${product.category}, ${product.price}, ${product.imageUrl}, ${product.active}) RETURNING id, code, name, category, price, image_url AS "imageUrl", active`;
    return res.status(201).json(row);
  } catch (error) {
    if (error.code === '23505') return sendError(res, 409, 'Ese código ya existe.');
    return sendError(res, 500, error.message || 'No se pudo guardar el producto.');
  }
};
