const postgres = require('postgres');

let sql;
function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no está configurada.');
  if (!sql) sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1 });
  return sql;
}

function isAdmin(req) {
  const key = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  return key === (process.env.ADMIN_KEY || '123456');
}

function sendError(res, status, message) { res.status(status).json({ error: message }); }
module.exports = { db, isAdmin, sendError };
