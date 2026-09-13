import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../store";
import { AgentService } from "../agent/service";
import { probeIsolation } from "../agent/docker";
import { controlRoot } from "../paths";

// Actual Docker browser + Codex worker, with synthetic API failures and no paid calls.
const root = path.join(controlRoot, "data/worker-failure-checks", randomUUID());
mkdirSync(root, { recursive: true });
const source = path.join(root, "tickets.sqlite");
const database = new DatabaseSync(source);
database.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT,role TEXT); CREATE TABLE support_tickets(id TEXT PRIMARY KEY,account_id TEXT,subject TEXT,message TEXT,created_at TEXT);");
database.prepare("INSERT INTO accounts VALUES(?,?,?)").run("buyer-maya", "Maya Chen", "buyer");
database.prepare("INSERT INTO support_tickets VALUES(?,?,?,?,?)").run("discount", "buyer-maya", "Synthetic transport failure check", "LOOP20 showed $38.40 but the simulated payment was $48.00.", new Date().toISOString());
database.close();
const isolation = await probeIsolation();
assert.equal(isolation.ready, true, isolation.message);
const store = new Store(path.join(root, "controller"), source);
const status: any = { state: "Ready", model: "gpt-5.4-nano", isolation };
const originalFetch = globalThis.fetch;
try {
  for (const httpStatus of [200, 429]) {
    let requests = 0;
    globalThis.fetch = (async (url: any) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      requests++;
      const error = { code: "credit_balance_exhausted", message: "Synthetic private response text must not be persisted" };
      return httpStatus === 200
        ? new Response(`event: response.failed\ndata: ${JSON.stringify({ type: "response.failed", response: { status: "failed", error } })}\n\n`, { headers: { "content-type": "text/event-stream" } })
        : new Response(JSON.stringify({ error }), { status: 429 });
    }) as typeof fetch;
    const service = new AgentService(store, async () => status);
    const run = await service.start("discount");
    const deadline = Date.now() + 120000;
    while (service.active && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
    if (service.active) { service.cancel(run.id); throw new Error("Failure propagation timed out"); }
    const finished = service.get(run.id);
    assert.equal(requests, 1);
    assert.equal(finished.state, "Failed");
    assert.match(finished.message, /credits are exhausted/);
    assert.equal(finished.proposal_id, null);
    assert.deepEqual(finished.usage, []);
    const event = finished.events.find((e: any) => e.state === "Model request failed");
    assert.deepEqual(event.details, { httpStatus, code: "credit_balance_exhausted" });
    assert.ok(!JSON.stringify(finished).includes("Synthetic private response text"));
    console.log(`PASS: HTTP ${httpStatus} credit error reaches persisted investigation and UI message; no proposal, no paid request.`);
  }
} finally {
  globalThis.fetch = originalFetch;
  store.close();
}
