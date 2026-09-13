// Explicit opt-in only: exercises the running app with disposable records.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMarketPool } from "../server/postgres.js";
import { readMarketTickets } from "../control/market-tickets";
import { createControl } from "../control/app";
import { investigationPrompt } from "../control/agent/policy";
if (process.env.SUPABASE_LIVE_CHECK !== "1") throw new Error("Set SUPABASE_LIVE_CHECK=1 to run explicitly.");
const pool = createMarketPool();
const temp = mkdtempSync(path.join(os.tmpdir(), "2db-supabase-check-"));
const marker = `Supabase verification ${randomUUID()}`;
const tickets: string[] = [];
let productId: string | undefined;
let orderId: string | undefined;
const received: any[] = [];
const control = createControl({ dataDir: path.join(temp, "data"), privateDir: path.join(temp,"private"), remoteTickets: () => readMarketTickets(pool), agentStatus: async () => ({ state: "Ready" }) as any });
control.agent.investigate = async (runId, ticket) => { received.push(ticket); control.agent.finish(runId, "Needs more information", "Verification dispatch; no model call."); };
const server = control.app.listen(0, "127.0.0.1");
async function api(route: string, method = "GET", body?: unknown, account = "buyer-maya") {
  const response = await fetch(`http://127.0.0.1:3001/api${route}`, { method, headers: { "Content-Type": "application/json", "X-Demo-Account": account }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.ok(response.ok, `API ${route}: ${response.status}`);
  return response.json();
}
try {
  await new Promise<void>(resolve => server.once("listening",resolve));
  assert.equal((await api('/health')).database, 'supabase');
  assert.ok((await api('/accounts')).some((a:any) => a.id === 'buyer-maya'));
  productId = (await api('/listings','POST',{ title:marker, description:"Temporary verification listing", category:"Home",price_cents:100 },'seller-olive')).id;
  assert.ok(productId);
  await api(`/listings/${productId}`,'PUT',{title:marker,description:"Edited verification listing",category:"Home",price_cents:200},'seller-olive');
  const key = randomUUID();
  const payload = { items:[{productId,quantity:1}], code:"LOOP20", requestKey:key };
  const orders = await Promise.all([api('/checkout','POST',payload),api('/checkout','POST',payload)]);
  orderId=orders[0].id;
  assert.equal(orders[1].id,orderId,"Concurrent retries must share one order");
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM two_db.payments WHERE order_id=$1',[orderId])).rows[0].n,1);
  assert.equal((await api(`/orders/${orderId}`)).items.length,1);
  for (const mode of ['form','voice']) {
    const result=await api('/support','POST',{subject:marker,message:'Identical customer-reviewed complaint for both intake paths.'});
    tickets.push(result.id);
    const saved=(await pool.query('SELECT * FROM two_db.support_tickets WHERE id=$1',[result.id])).rows[0];
    assert.equal(saved.account_id,'buyer-maya');assert.equal(saved.subject,marker);
    console.log(`${mode} complaint persisted in Supabase`);
  }
  const base=`http://127.0.0.1:${(server.address() as any).port}/engineer-api`;
  const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:readFileSync(control.keyFile,'utf8')});
  const {token}=await login.json();const headers={Authorization:`Bearer ${token}`};
  const inbox=await (await fetch(base+'/inbox',{headers})).json();
  for(const id of tickets){
    assert.ok(inbox.some((t:any)=>t.id===id));
    const response=await fetch(`${base}/tickets/${id}/investigate`,{method:'POST',headers});
    assert.equal(response.status,202);
    await response.json();
    assert.equal(control.store.db.prepare('SELECT complaint FROM tickets WHERE id=?').get(id)?.complaint,'Identical customer-reviewed complaint for both intake paths.');
  }
  assert.equal(received.length,2);
  assert.equal(investigationPrompt(received[0]),investigationPrompt(received[1]));
  console.log('Supabase listing, checkout retry, complaint persistence, authenticated inbox and investigation handoff passed.');
} finally {
  // Delete only records created by this explicit verification run.
  if(tickets.length) await pool.query('DELETE FROM two_db.support_tickets WHERE id=ANY($1::text[])',[tickets]);
  if(orderId){
    await pool.query('DELETE FROM two_db.checkout_requests WHERE order_id=$1',[orderId]);
    await pool.query('DELETE FROM two_db.payments WHERE order_id=$1',[orderId]);
    await pool.query('DELETE FROM two_db.order_items WHERE order_id=$1',[orderId]);
    await pool.query('DELETE FROM two_db.orders WHERE id=$1',[orderId]);
  }
  if(productId) await pool.query('DELETE FROM two_db.products WHERE id=$1',[productId]);
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  control.store.close();await pool.end();rmSync(temp,{recursive:true,force:true});
}
