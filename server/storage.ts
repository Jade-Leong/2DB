import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient } from "pg";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createMarketPool, root, useSupabase } from "./postgres.js";
export { root };
export const uploadsDir = path.join(root, process.env.LOOP_TEST === "1" ? "data/test/uploads" : "data/local/uploads");
mkdirSync(uploadsDir, { recursive: true });
const pool = useSupabase ? createMarketPool() : undefined;
const sqlite = pool ? undefined : (await import("./db.js")).db;
const context = new AsyncLocalStorage<PoolClient>();
// Current repository SQL uses ? only as parameter markers, never in literals.
function parameters(sql: string) { let n = 0; return sql.replace(/\?/g, () => `$${++n}`); }
let sqliteQueue = Promise.resolve();
export const db = {
  prepare(sql: string) {
    return {
      async all(...values: any[]): Promise<any[]> {
        if (pool) return (await (context.getStore() ?? pool).query(parameters(sql), values)).rows;
        return sqlite!.prepare(sql).all(...values);
      },
      async get(...values: any[]): Promise<any> { return (await this.all(...values))[0]; },
      async run(...values: any[]) {
        if (pool) return (await (context.getStore() ?? pool).query(parameters(sql), values)).rowCount;
        return sqlite!.prepare(sql).run(...values).changes;
      },
    };
  },
  async transaction<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
        const result = await context.run(client, work);
        await client.query("COMMIT");
        return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    const previous = sqliteQueue;
    let release!: () => void;
    sqliteQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    sqlite!.exec("BEGIN IMMEDIATE");
    try { const result = await work(); sqlite!.exec("COMMIT"); return result; }
    catch (error) { sqlite!.exec("ROLLBACK"); throw error; }
    finally { release(); }
  },
  async close() { if (pool) await pool.end(); else sqlite!.close(); },
};
// Fail startup rather than silently writing complaints to a fallback database.
await db.prepare("SELECT id FROM accounts LIMIT 1").all();
