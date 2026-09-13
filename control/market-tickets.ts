import type { Pool } from "pg";
export async function readMarketTickets(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { rows } = await client.query("SELECT t.id,t.account_id AS customer_id,a.name AS customer_name,a.role AS customer_role,t.subject,t.message AS complaint,t.created_at AS submitted_at FROM two_db.support_tickets t JOIN two_db.accounts a ON a.id=t.account_id ORDER BY t.created_at DESC");
    await client.query("COMMIT");
    return rows;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
