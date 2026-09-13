import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
if (existsSync(path.join(root, '.env'))) loadEnvFile(path.join(root, '.env'));
const mode = process.argv[2];
if (!['check', 'setup'].includes(mode)) {
  console.error('Usage: node scripts/supabase.mjs check|setup');
  process.exit(1);
}
const connectionString = process.env.SUPABASE_DB_URL?.trim();
if (!connectionString) {
  console.error('Supabase is not connected: set SUPABASE_DB_URL privately in the project .env to the Session pooler URI, including your database password.');
  process.exit(1);
}
let client;
try {
  const uri = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(uri.protocol) || !uri.password)
    throw new Error('INVALID_CONNECTION');
  // Strip URI SSL overrides so credentials always use verified TLS.
  for (const key of [...uri.searchParams.keys()])
    if (key.startsWith('ssl')) uri.searchParams.delete(key);
  const ca = process.env.SUPABASE_DB_CA_FILE;
  client = new pg.Client({
    connectionString: uri.toString(),
    ssl: { rejectUnauthorized: true, ...(ca ? { ca: readFileSync(path.resolve(root, ca), 'utf8') } : {}) },
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
    application_name: '2db-supabase-setup',
  });
  await client.connect();
  await client.query('SELECT 1');
  console.log('Supabase PostgreSQL connection verified.');
  if (mode === 'setup') {
    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('2db-supabase-setup'))");
      await client.query(`CREATE SCHEMA IF NOT EXISTS two_db;
        REVOKE ALL ON SCHEMA two_db FROM PUBLIC, anon, authenticated;
        CREATE TABLE IF NOT EXISTS two_db.schema_migrations (
          name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE two_db.schema_migrations ENABLE ROW LEVEL SECURITY;`);
      const folder = path.join(root, 'supabase/migrations');
      for (const name of readdirSync(folder).filter(name => name.endsWith('.sql')).sort()) {
        const sql = readFileSync(path.join(folder, name), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const previous = await client.query('SELECT checksum FROM two_db.schema_migrations WHERE name=$1', [name]);
        if (previous.rows.length) {
          if (previous.rows[0].checksum !== checksum) throw new Error('MIGRATION_CHANGED');
          continue;
        }
        await client.query(sql);
        await client.query('INSERT INTO two_db.schema_migrations(name, checksum) VALUES ($1,$2)', [name, checksum]);
        console.log(`Applied ${name}`);
      }
      await client.query('COMMIT');
      console.log('2DB schema is ready. Existing local data and app storage have not been switched.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} catch (error) {
  // Driver messages can contain connection details. Never print the URI/password.
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'CONFIG_OR_CONNECTION_ERROR';
  console.error(`Supabase ${mode} failed (${code}). Check the URI, password, network, and CA certificate. No credentials were printed.`);
  process.exitCode = 1;
} finally {
  await client?.end();
}
