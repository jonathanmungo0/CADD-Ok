
import { pool } from './src/config/db.js';

try {
  console.log('Checking CADD PostgreSQL database...');

  const result = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  console.log('\nExisting CADD database tables:');
  console.table(result.rows);

} catch (error) {
  console.error('DATABASE ERROR:', error.message);

} finally {
  await pool.end();
}
