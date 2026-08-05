import pg from 'pg';

const { Pool } = pg;

// La zona horaria de la sesión se fija en Buenos Aires para que NOW(), los
// agrupamientos por día (reportes) y cualquier consulta temporal usen la hora
// local de Argentina. Las columnas TIMESTAMPTZ siguen guardando el instante
// absoluto (correcto), solo cambia cómo se interpreta para fechas.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c timezone=America/Argentina/Buenos_Aires',
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
