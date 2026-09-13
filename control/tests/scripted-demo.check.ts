import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../store";
import { ScriptedDemoService } from "../scripted-demo";
import { controlRoot } from "../paths";

const root = path.join(controlRoot, "data/scripted-demo-checks", randomUUID());
mkdirSync(root, { recursive: true });
const tickets = path.join(root, "tickets.sqlite");
const database = new DatabaseSync(tickets);
database.exec(
  "CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT,role TEXT); CREATE TABLE support_tickets(id TEXT PRIMARY KEY,account_id TEXT,subject TEXT,message TEXT,created_at TEXT);",
);
database
  .prepare("INSERT INTO accounts VALUES(?,?,?)")
  .run("buyer-maya", "Maya Chen", "buyer");
database
  .prepare("INSERT INTO support_tickets VALUES(?,?,?,?,?)")
  .run(
    "discount-check",
    "buyer-maya",
    "Discount complaint",
    "I used LOOP20, and checkout showed $38.40, but the simulated payment was $48.00.",
    new Date().toISOString(),
  );
database.close();

const store = new Store(path.join(root, "controller"), tickets);
let automaticallyStarted = "";
const service = new ScriptedDemoService(store, undefined, (proposalId) => {
  automaticallyStarted = proposalId;
});
try {
  const started = await service.start("discount-check", "discount-fix");
  let finished = service.get(started.id);
  for (let i = 0; i < 360 && !finished.finished_at; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    finished = service.get(started.id);
  }
  assert.equal(finished.state, "Awaiting engineer review", finished.message);
  assert.equal(finished.evidence.length, 1);
  assert.equal(finished.evidence[0].displayedCents, 3840);
  assert.equal(finished.evidence[0].orderCents, 3840);
  assert.equal(finished.evidence[0].paymentCents, 4800);
  const proposal = store.detail(finished.proposal_id);
  for (let i = 0; i < 50 && !automaticallyStarted; i++)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(automaticallyStarted, proposal.id);
  assert.equal(proposal.state, "Ready for Agent 2");
  assert.equal(
    proposal.investigationOrigin,
    "Scripted investigation + developer-authored proposal",
  );
  console.log(
    JSON.stringify(
      {
        state: finished.state,
        modelCalls: 0,
        evidence: finished.evidence[0],
        proposal: {
          id: proposal.id,
          state: proposal.state,
          origin: proposal.investigationOrigin,
          candidateRevision: proposal.candidate_revision,
        },
        dataRoot: root,
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
