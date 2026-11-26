import { readFile } from 'node:fs/promises';
import { pool } from './src/config/db.js';

try {
  const schema = await readFile(
    new URL('../database/schema.sql', import.meta.url),
    'utf8'
  );

  await pool.query(schema);
  console.log('CADD database schema is ready.');
} catch (error) {
  console.error('Could not apply the CADD database schema:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
