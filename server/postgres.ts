import pg from "pg";
import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = fileURLToPath(new URL("../", import.meta.url));
if (process.env.LOOP_TEST !== "1" && existsSync(path.join(root, ".env")))
  loadEnvFile(path.join(root, ".env"));
export const useSupabase = process.env.LOOP_TEST !== "1" && process.env.MARKET_DATABASE === "supabase";
export function createMarketPool() {
  if (process.env.LOOP_TEST === "1") throw new Error("Remote database access is disabled in automated tests.");
  const uri = new URL(process.env.SUPABASE_DB_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(uri.protocol) || !uri.password)
    throw new Error("Set the server-only SUPABASE_DB_URL.");
  for (const key of [...uri.searchParams.keys()]) if (key.startsWith("ssl")) uri.searchParams.delete(key);
  const ca = process.env.SUPABASE_DB_CA_FILE;
  const pool = new pg.Pool({ connectionString: uri.toString(), max: 5,
    options: "-c search_path=two_db,pg_catalog", connectionTimeoutMillis: 10000,
    statement_timeout: 30000, idle_in_transaction_session_timeout: 30000,
    ssl: { rejectUnauthorized: true, ...(ca ? { ca: readFileSync(path.resolve(root, ca), "utf8") } : {}) },
  });
  pool.on("error", () => console.error("Supabase connection interrupted."));
  return pool;
}
