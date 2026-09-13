import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createControl } from "../app";

const root = mkdtempSync(path.join(tmpdir(), "2db-ticket-ingestion-"));
const control = createControl({ dataDir: path.join(root, "controller"), privateDir: path.join(root, "private") });
const server = control.app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${(server.address() as any).port}`;
const post = (url: string, body: unknown, headers: Record<string, string> = {}) => fetch(origin + url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test.after(() => { server.close(); control.store.close(); });

test("support form creates a canonical ticket and duplicate request IDs return the same ticket", async () => {
  const headers = { "X-Demo-Account": "buyer-maya", "X-Support-Source": "support-form", "Idempotency-Key": "form-request-1" };
  const first = await post("/api/support", { subject: "Where is my order?", message: "I expected it yesterday." }, headers);
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  const second = await post("/api/support", { subject: "Different text", message: "Should not duplicate." }, headers);
  assert.equal(second.status, 201);
  const secondBody = await second.json();
  assert.equal(secondBody.id, firstBody.id);
  const row = control.store.db.prepare("SELECT customer_id,subject,complaint,source FROM tickets WHERE id=?").get(firstBody.id) as any;
  assert.deepEqual({ ...row }, { customer_id: "buyer-maya", subject: "Where is my order?", complaint: "I expected it yesterday.", source: "support-form" });
});

test("ElevenLabs-style webhook uses the same ticket store and rejects invalid authentication", async () => {
  const previous = process.env.ELEVENLABS_SUPPORT_WEBHOOK_SECRET;
  process.env.ELEVENLABS_SUPPORT_WEBHOOK_SECRET = "test-webhook-secret";
  try {
    const denied = await post("/api/support/elevenlabs", { account_id: "buyer-jamie", subject: "Photo issue", message: "The photo disappeared." }, { "X-ElevenLabs-Webhook-Secret": "wrong" });
    assert.equal(denied.status, 401);
    const headers = { "X-ElevenLabs-Webhook-Secret": "test-webhook-secret", "Idempotency-Key": "voice-request-1" };
    const first = await post("/api/support/elevenlabs", { account_id: "buyer-jamie", subject: "Photo issue", message: "The photo disappeared.", order_reference: "ORDER-7" }, headers);
    assert.equal(first.status, 201);
    const firstBody = await first.json();
    const retry = await post("/api/support/elevenlabs", { account_id: "buyer-jamie", subject: "Changed", message: "Changed" }, headers);
    assert.equal((await retry.json()).id, firstBody.id);
    const row = control.store.db.prepare("SELECT customer_id,subject,complaint,source,related_reference FROM tickets WHERE id=?").get(firstBody.id) as any;
    assert.deepEqual({ ...row }, { customer_id: "buyer-jamie", subject: "Photo issue", complaint: "The photo disappeared.", source: "elevenlabs", related_reference: "ORDER-7" });
  } finally { if (previous === undefined) delete process.env.ELEVENLABS_SUPPORT_WEBHOOK_SECRET; else process.env.ELEVENLABS_SUPPORT_WEBHOOK_SECRET = previous; }
});

test("canonical tickets are returned by the inbox response used by dashboard polling", async () => {
  const key = JSON.parse(readFileSync(path.join(root, "private", "engineer-key.json"), "utf8")).key;
  const login = await post("/engineer-api/login", { key });
  assert.equal(login.status, 200);
  const token = (await login.json()).token;
  const inbox = await fetch(origin + "/engineer-api/inbox", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(inbox.status, 200);
  const rows = await inbox.json();
  assert.ok(rows.some((row: any) => row.source === "support-form"));
  assert.ok(rows.some((row: any) => row.source === "elevenlabs"));
});
