import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../store";
import { Agent2Service, agent2ToolNames } from "../agent2";
import { scriptedDemoModelCalls } from "../scripted-demo";
import { controlRoot, now } from "../paths";

const root = path.join(controlRoot, "data/agent2-tests", randomUUID());
mkdirSync(root, { recursive: true });
const ticketDb = path.join(root, "tickets.sqlite");
const db = new DatabaseSync(ticketDb);
db.exec(
  "CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT,role TEXT); CREATE TABLE support_tickets(id TEXT PRIMARY KEY,account_id TEXT,subject TEXT,message TEXT,created_at TEXT);",
);
db.prepare("INSERT INTO accounts VALUES(?,?,?)").run(
  "buyer-maya",
  "Maya Chen",
  "buyer",
);
db.prepare("INSERT INTO support_tickets VALUES(?,?,?,?,?)").run(
  "ticket",
  "buyer-maya",
  "Discount complaint",
  "I used LOOP20, and checkout showed $38.40, but the simulated payment was $48.00.",
  "2026-09-12T12:00:00Z",
);
db.close();
const store = new Store(path.join(root, "control"), ticketDb);
const ready: any = {
  state: "Ready",
  sdk: { ready: true, message: "Mocked SDK readiness" },
  authentication: { ready: true, message: "Mocked authentication" },
  model: "mock-model",
  isolation: {
    ready: true,
    browser: true,
    image: "sha256:" + "a".repeat(64),
    message: "Mocked isolation",
  },
  browser: { ready: true, message: "Mocked browser" },
};

function approved(kind: "discount-fix" | "unchanged" = "discount-fix") {
  let proposal = store.create("ticket", kind, "scripted-agent-1");
  return store.authorizeVerification(proposal.id);
}

function fakeRunner(scriptedDecision = "Verified awaiting engineer review") {
  return {
    start: async (proposalId: string, verificationMode: string) => {
      const proposal = store.proposal(proposalId);
      const approval = store.approvalFor(proposal);
      const id = randomUUID();
      store.db
        .prepare(
          "INSERT INTO runs(id,proposal_id,approval_id,candidate_revision,base_revision,requirements_hash,harness_hash,revision_number,state,started_at,finished_at,evidence,message,verification_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          proposal.id,
          approval.id,
          proposal.candidate_revision,
          proposal.base_revision,
          proposal.requirements_hash,
          proposal.harness_hash,
          proposal.revision_number,
          scriptedDecision === "Verified awaiting engineer review"
            ? "Live Agent 2 running"
            : "Failed",
          now(),
          now(),
          JSON.stringify({ scriptedDecision }),
          "Mocked integration test evidence",
          verificationMode,
        );
      store.db
        .prepare("UPDATE proposals SET state=?,last_run=? WHERE id=?")
        .run(
          scriptedDecision === "Verified awaiting engineer review"
            ? "Live Agent 2 running"
            : "Failed",
          id,
          proposal.id,
        );
      return { runId: id, state: "Verification running", verificationMode };
    },
  } as any;
}

async function waitFor(service: Agent2Service) {
  for (let i = 0; i < 100 && service.active; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
}

test.after(() => store.close());

test("Agent 2 has only browser and trusted evidence tools", () => {
  assert.deepEqual(
    [...agent2ToolNames],
    ["browser_action", "read_required_checks", "read_recorded_payment"],
  );
  assert.ok(
    !agent2ToolNames.some((name) =>
      /edit|shell|approve|merge|deploy/.test(name),
    ),
  );
});

test("scripted Agent 1 mode is explicitly zero-model and preserves its origin", () => {
  assert.equal(scriptedDemoModelCalls, 0);
  const proposal = store.create("ticket", "unchanged", "scripted-agent-1");
  assert.equal(
    proposal.investigationOrigin,
    "Scripted investigation + developer-authored proposal",
  );
  assert.equal(
    proposal.author,
    "Scripted investigation + developer-authored proposal",
  );
});

test("live Agent 2 records its own exact verification authorization without human approval", async () => {
  const proposal = store.create("ticket", "discount-fix", "live-agent-1");
  const service = new Agent2Service(
    store,
    fakeRunner("Failed"),
    async () => ready,
  );
  await service.start(proposal.id);
  await waitFor(service);
  const current = store.detail(proposal.id);
  assert.equal(current.approvals.length, 1);
  assert.equal(
    current.approvals[0].reviewer,
    "Controller verification authorization",
  );
  assert.equal(current.queueApproval, null);
});

test("mocked live integration preserves mode and requires every evidence gate", async () => {
  const proposal = approved();
  const service = new Agent2Service(
    store,
    fakeRunner(),
    async () => ready,
    async () => ({
      assessment: {
        status: "resolved",
        summary: "Mocked model assessment",
        evidenceReferences: ["D01"],
        unsatisfiedRequirements: [],
      },
      actions: [
        { environment: "baseline", artifact: "baseline-01.png" },
        { environment: "candidate", artifact: "candidate-02.png" },
      ],
      usage: null,
      gates: {
        baselineBrowser: true,
        candidateBrowser: true,
        screenshots: true,
        regressionEvidence: true,
        paymentEvidence: false,
      },
    }),
  );
  const started = await service.start(proposal.id);
  await waitFor(service);
  const run = store.db
    .prepare("SELECT * FROM runs WHERE id=?")
    .get(started.runId) as any;
  assert.equal(run.verification_mode, "live-agent-2");
  assert.equal(run.state, "Inconclusive");
  assert.match(run.message, /incomplete/i);
});

test("mocked live integration can verify only with matching approval and complete gates", async () => {
  const proposal = approved();
  const service = new Agent2Service(
    store,
    fakeRunner(),
    async () => ready,
    async () => ({
      assessment: {
        status: "resolved",
        summary: "Mocked model assessment",
        evidenceReferences: ["D01", "baseline-01.png", "candidate-02.png"],
        unsatisfiedRequirements: [],
      },
      actions: [
        { environment: "baseline", artifact: "baseline-01.png" },
        { environment: "candidate", artifact: "candidate-02.png" },
      ],
      usage: null,
      gates: {
        baselineBrowser: true,
        candidateBrowser: true,
        screenshots: true,
        regressionEvidence: true,
        paymentEvidence: true,
      },
    }),
  );
  const started = await service.start(proposal.id);
  await waitFor(service);
  const run = store.db
    .prepare("SELECT * FROM runs WHERE id=?")
    .get(started.runId) as any;
  assert.equal(run.state, "Verified awaiting engineer review");
  assert.equal(
    store.proposal(proposal.id).state,
    "Verified awaiting engineer review",
  );
  const queued = store.approve(
    proposal.id,
    proposal.candidate_revision,
    proposal.revision_number,
    "Human engineer",
  );
  assert.equal(queued.state, "Approved");
  assert.equal(queued.queueApproval.reviewer, "Human engineer");
  const revised = store.change(proposal.id, "unchanged");
  assert.equal(revised.state, "Proposal ready");
  assert.equal(revised.queueApproval, null);
});

test("failed mandatory checks never call live model and never become scripted success", async () => {
  const proposal = approved("unchanged");
  let modelCalls = 0;
  const service = new Agent2Service(
    store,
    fakeRunner("Failed"),
    async () => ready,
    async () => {
      modelCalls++;
      throw new Error("must not run");
    },
  );
  const started = await service.start(proposal.id);
  await waitFor(service);
  assert.equal(modelCalls, 0);
  assert.equal(
    (
      store.db
        .prepare("SELECT state FROM runs WHERE id=?")
        .get(started.runId) as any
    ).state,
    "Failed",
  );
  const queued = store.approve(
    proposal.id,
    proposal.candidate_revision,
    proposal.revision_number,
    "Human accepted flagged risk",
  );
  assert.equal(queued.state, "Approved");
});

test("cancellation during mandatory checks waits for evidence and prevents live exploration", async () => {
  const proposal = approved();
  const runner = fakeRunner();
  const start = runner.start;
  runner.start = async (...args: any[]) => {
    const result = await start(...args);
    store.db
      .prepare(
        "UPDATE runs SET state='Verification running',evidence=NULL WHERE id=?",
      )
      .run(result.runId);
    return result;
  };
  let modelCalls = 0;
  const service = new Agent2Service(
    store,
    runner,
    async () => ready,
    async () => {
      modelCalls++;
      throw new Error("Cancelled run must not invoke a model");
    },
  );
  const started = await service.start(proposal.id);
  service.cancel(started.runId);
  assert.equal(service.active, true);
  const evidence = JSON.stringify({
    scriptedDecision: "Verified awaiting engineer review",
  });
  store.db
    .prepare(
      "UPDATE runs SET state='Live Agent 2 running',evidence=? WHERE id=?",
    )
    .run(evidence, started.runId);
  await waitFor(service);
  const row = store.db
    .prepare("SELECT * FROM runs WHERE id=?")
    .get(started.runId) as any;
  assert.equal(service.active, false);
  assert.equal(modelCalls, 0);
  assert.equal(row.state, "Inconclusive");
  assert.equal(row.evidence, evidence);
  assert.equal(JSON.parse(row.agent_assessment).status, "cancelled");
  assert.match(row.message, /cancelled/i);
  assert.equal(store.proposal(proposal.id).state, "Inconclusive");
});

test("cancellation prevents a late resolved model response from verifying the proposal", async () => {
  const proposal = approved();
  let resolveModel!: (value: any) => void;
  const service = new Agent2Service(
    store,
    fakeRunner(),
    async () => ready,
    () =>
      new Promise((resolve) => {
        resolveModel = resolve;
      }),
  );
  const started = await service.start(proposal.id);
  service.cancel(started.runId);
  resolveModel({
    assessment: {
      status: "resolved",
      evidenceReferences: ["D01"],
      unsatisfiedRequirements: [],
    },
    actions: [],
    usage: null,
    gates: {
      baselineBrowser: true,
      candidateBrowser: true,
      screenshots: true,
      regressionEvidence: true,
      paymentEvidence: true,
    },
  });
  await waitFor(service);
  const row = store.db
    .prepare("SELECT * FROM runs WHERE id=?")
    .get(started.runId) as any;
  assert.equal(row.state, "Inconclusive");
  assert.equal(JSON.parse(row.agent_assessment).status, "cancelled");
});
