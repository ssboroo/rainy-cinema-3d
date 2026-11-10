import argon2 from 'argon2';
import pg from 'pg';

const { Pool } = pg;
const { DATABASE_URL, BOOTSTRAP_TENANT_NAME, BOOTSTRAP_TENANT_SLUG, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL || !BOOTSTRAP_TENANT_NAME || !BOOTSTRAP_TENANT_SLUG || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('Set DATABASE_URL, BOOTSTRAP_TENANT_NAME, BOOTSTRAP_TENANT_SLUG, ADMIN_EMAIL and ADMIN_PASSWORD.');
}
if (ADMIN_PASSWORD.length < 16) throw new Error('ADMIN_PASSWORD must be at least 16 characters.');
if (!/^[a-z0-9-]{2,80}$/.test(BOOTSTRAP_TENANT_SLUG)) throw new Error('BOOTSTRAP_TENANT_SLUG must be a 2–80 character lowercase slug.');
const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
try {
  const passwordHash = await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query(
      'INSERT INTO tenants(name,slug) VALUES($1,$2) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id',
      [BOOTSTRAP_TENANT_NAME, BOOTSTRAP_TENANT_SLUG]
    );
    await client.query(
      `INSERT INTO users(tenant_id,email,password_hash,role) VALUES($1,$2,$3,'OWNER')
       ON CONFLICT (tenant_id, (lower(email))) DO NOTHING`,
      [tenant.rows[0].id, ADMIN_EMAIL.toLowerCase(), passwordHash]
    );
    await client.query('COMMIT');
    process.stdout.write('Tenant and owner account bootstrapped.\n');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
} finally { await pool.end(); }
