import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import path from "node:path";
import { createMarketPool, root } from "../server/postgres.js";

// Explicit one-time cutover. Never overwrite a populated destination.
const tables = ["accounts", "products", "discounts", "orders", "order_items", "payments", "support_tickets", "checkout_requests"];
const source = new DatabaseSync(path.join(root, "data/local/market.sqlite"), { readOnly: true });
const pool = createMarketPool();
const client = await pool.connect();
function digest(rows: any[]) {
  return createHash("sha256").update(JSON.stringify(rows.map(row =>
    Object.keys(row).sort().map(key => [key, row[key] === null ? null : String(row[key])])
  ).map(row => JSON.stringify(row)).sort())).digest("hex");
}
try {
  source.exec("BEGIN");
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('2db-market-import'))");
  await client.query(`LOCK TABLE ${tables.map(t => `two_db.${t}`).join(',')} IN ACCESS EXCLUSIVE MODE`);
  for (const table of tables) {
    const existing = await client.query(`SELECT count(*)::int AS count FROM two_db.${table}`);
    if (existing.rows[0].count !== 0) throw new Error("Destination contains data; import refused.");
  }
  for (const table of tables) {
    const rows = source.prepare(`SELECT * FROM ${table}`).all();
    for (const row of rows) {
      const columns = Object.keys(row);
      await client.query(`INSERT INTO two_db.${table} (${columns.join(',')}) VALUES (${columns.map((_,i) => `$${i+1}`).join(',')})`, Object.values(row));
    }
    const imported = await client.query(`SELECT * FROM two_db.${table}`);
    if (digest(rows) !== digest(imported.rows)) throw new Error("Import verification failed.");
    console.log(`${table}: ${rows.length} records verified`);
  }
  await client.query("SELECT setval(pg_get_serial_sequence('two_db.order_items','id'), COALESCE((SELECT max(id) FROM two_db.order_items),1), EXISTS(SELECT 1 FROM two_db.order_items))");
  await client.query("COMMIT");
  console.log("Import complete. Local data was read only and is retained.");
} catch (error) {
  await client.query("ROLLBACK");
  console.error(error instanceof Error && ['Destination contains data; import refused.', 'Import verification failed.'].includes(error.message) ? error.message : "Import failed; remote transaction rolled back.");
  process.exitCode = 1;
} finally { source.exec("ROLLBACK"); source.close(); client.release(); await pool.end(); }
