import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../store";
import { Runner, portAvailable, occupiedMessage } from "../runner";
import { Agent2Service, agent2Status } from "../agent2";
import { controlRoot } from "../paths";

if (!(await portAvailable(3001))) throw new Error(occupiedMessage);
const root = path.join(controlRoot, "data/agent2-docker-checks", randomUUID());
mkdirSync(root, { recursive: true });
const tickets = path.join(root, "tickets.sqlite");
const source = new DatabaseSync(tickets);
source.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT,role TEXT); CREATE TABLE support_tickets(id TEXT PRIMARY KEY,account_id TEXT,subject TEXT,message TEXT,created_at TEXT);");
source.prepare("INSERT INTO accounts VALUES(?,?,?)").run("buyer-maya", "Maya Chen", "buyer");
source.prepare("INSERT INTO support_tickets VALUES(?,?,?,?,?)").run("discount-agent2", "buyer-maya", "Discount complaint", "I used LOOP20, and checkout showed $38.40, but the simulated payment was $48.00.", new Date().toISOString());
source.close();

const store = new Store(path.join(root, "controller"), tickets);
try {
  let proposal = store.create("discount-agent2", "discount-fix", "scripted-agent-1");
  proposal = store.submit(proposal.id, "Explicit test engineer");
  const status = await agent2Status();
  const isolated = { ...status, state: "Ready", authentication: { ready: true, message: "Mocked model layer; no API call" }, model: "mocked-no-api" } as any;
  assert.equal(isolated.isolation.ready, true);
  let modelCalls = 0;
  const service = new Agent2Service(
    store,
    new Runner(store),
    async () => isolated,
    async () => {
      modelCalls++;
      return {
        assessment: { status: "inconclusive", summary: "Mocked model layer; not a live run", evidenceReferences: ["D01"], unsatisfiedRequirements: ["Live model not run"] },
        actions: [],
        usage: null,
        gates: { baselineBrowser: false, candidateBrowser: false, screenshots: false, regressionEvidence: false, paymentEvidence: false },
      };
    },
  );
  const started = await service.start(proposal.id);
  for (let i = 0; i < 1800 && service.active; i++) await new Promise((resolve) => setTimeout(resolve, 500));
  const run = store.db.prepare("SELECT * FROM runs WHERE id=?").get(started.runId) as any;
  const evidence = JSON.parse(run.evidence);
  assert.equal(run.verification_mode, "live-agent-2");
  assert.equal(evidence.scriptedDecision, "Verified awaiting engineer review");
  assert.equal(evidence.baseline.isolation.network, "none");
  assert.equal(evidence.candidate.isolation.network, "none");
  assert.equal(evidence.baseline.required.assessment.checks.find((check: any) => check.id === "D01").status, "failed");
  assert.ok(evidence.candidate.required.assessment.checks.every((check: any) => check.status === "passed"));
  assert.equal(modelCalls, 1);
  assert.equal(run.state, "Inconclusive");
  console.log(JSON.stringify({
    runId: run.id,
    mode: run.verification_mode,
    baseline: evidence.baseline.required.assessment.status,
    candidate: evidence.candidate.required.assessment.status,
    docker: { baseline: evidence.baseline.isolation, candidate: evidence.candidate.isolation },
    modelLayer: "mocked incomplete; no API call",
    finalState: run.state,
  }, null, 2));
} finally {
  store.close();
}
