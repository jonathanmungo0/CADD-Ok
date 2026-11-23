import dotenv from 'dotenv';
import { pool } from './config/db.js';
import { hashPassword } from './auth.js';

dotenv.config();

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const fullName = process.env.ADMIN_FULL_NAME?.trim() || 'System Administrator';

if (!email || !password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD to provision an administrator.');
  process.exitCode = 1;
} else if (password.length < 10) {
  console.error('ADMIN_PASSWORD must be at least 10 characters long.');
  process.exitCode = 1;
} else {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const passwordHash = await hashPassword(password);
    await client.query(
      `INSERT INTO users (full_name,email,phone,password_hash,role)
       VALUES ($1,$2,NULL,$3,'administrator')
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role='administrator',is_active=true,updated_at=now()`,
      [fullName, email, passwordHash]
    );
    await client.query('COMMIT');
    console.log(`Administrator account ready for ${email}.`);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(rollbackError => console.error('Administrator setup rollback failed:', rollbackError.message));
    console.error('Could not provision administrator:', error.message);
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}
