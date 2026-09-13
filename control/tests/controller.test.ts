import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Server } from "node:http";
import { createControl } from "../app";
import { portAvailable, occupiedMessage } from "../runner";
import { assessRequired, finalDecision } from "../evidence";
import { revision, hash, sourceFiles } from "../snapshots";
import { projectRoot, controlRoot } from "../paths";
import { discountRequirements } from "../../verification/discount-contract";

const testRoot = path.join(controlRoot, "data/controller-tests", randomUUID());
mkdirSync(testRoot, { recursive: true });
const source = path.join(testRoot, "submitted-test-tickets.sqlite");
const sourceDB = new DatabaseSync(source);
sourceDB.exec(
  "CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT,role TEXT); CREATE TABLE support_tickets(id TEXT PRIMARY KEY,account_id TEXT,subject TEXT,message TEXT,created_at TEXT);",
);
sourceDB
  .prepare("INSERT INTO accounts VALUES(?,?,?)")
  .run("buyer-maya", "Maya Chen (controller test fixture)", "buyer");
sourceDB
  .prepare("INSERT INTO support_tickets VALUES(?,?,?,?,?)")
  .run(
    "test-complaint-001",
    "buyer-maya",
    "Discount charged incorrectly — test fixture",
    "I used a discount code, but I was charged the full price.",
    "2026-09-12T12:00:00.000Z",
  );
sourceDB.close();
const sourceBefore = hash(readFileSync(source));
let control: ReturnType<typeof createControl>,
  server: Server,
  url: string,
  token: string;
const summary: any = {
  label: "Automated controller demonstration — explicit test-engineer session",
  testTicket: "test-complaint-001 (not a marketplace customer submission)",
  startedAt: new Date().toISOString(),
  outcomes: [],
};
async function request(
  route: string,
  data?: unknown,
  auth = true,
  headers: Record<string, string> = {},
) {
  const res = await fetch(url + "/engineer-api" + route, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: res.status, body: await res.json() };
}
async function proposal(kind = "discount-fix") {
  const result = await request("/proposals", {
    ticketId: "test-complaint-001",
    kind,
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body;
}
async function approve(p: any) {
  return control.store.authorizeVerification(p.id);
}
async function waitForRun(id: string) {
  const start = Date.now();
  while (Date.now() - start < 480000) {
    const p = (await request(`/proposals/${id}`)).body;
    if (p.state !== "Verification running") return p;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "Controller verification did not finish within eight minutes.",
  );
}
before(async () => {
  control = createControl({
    dataDir: path.join(testRoot, "controller"),
    privateDir: path.join(testRoot, "private"),
    ticketSource: source,
  });
  server = control.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  url = `http://127.0.0.1:${(server.address() as any).port}`;
  const key = JSON.parse(readFileSync(control.keyFile, "utf8")).key;
  const login = await request("/login", { key }, false);
  assert.equal(login.status, 200);
  token = login.body.token;
});
after(async () => {
  summary.finishedAt = new Date().toISOString();
  summary.executionStatus =
    summary.outcomes.length === 2
      ? "Complete"
      : "Incomplete: execution checks did not finish";
  summary.sourceTicketDatabaseUnchanged =
    hash(readFileSync(source)) === sourceBefore;
  mkdirSync(path.join(controlRoot, "test-results"), { recursive: true });
  writeFileSync(
    path.join(controlRoot, "test-results/latest.json"),
    JSON.stringify(summary, null, 2),
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
  control.store.close();
});

test("read-only adapter preserves original complaint fields and marketplace source bytes", async () => {
  const inbox = await request("/inbox");
  assert.equal(inbox.status, 200);
  assert.equal(
    inbox.body[0].complaint,
    "I used a discount code, but I was charged the full price.",
  );
  const imported = await request("/tickets/test-complaint-001/import", {});
  assert.equal(imported.status, 200);
  assert.deepEqual(
    {
      id: imported.body.id,
      customer: imported.body.customer_id,
      date: imported.body.submitted_at,
      reference: imported.body.related_reference,
    },
    {
      id: "test-complaint-001",
      customer: "buyer-maya",
      date: "2026-09-12T12:00:00.000Z",
      reference: null,
    },
  );
  assert.equal(hash(readFileSync(source)), sourceBefore);
});
test("human approval is blocked before live verification; customer and supplied roles cannot approve", async () => {
  const p = await proposal();
  assert.equal(
    (await request(`/proposals/${p.id}/verify`, { passed: true })).status,
    403,
  );
  await request(`/proposals/${p.id}/submit`, {});
  const customer = await request(
    `/proposals/${p.id}/approve`,
    { revision: p.candidate_revision, revisionNumber: 1, role: "engineer" },
    false,
    { "X-Demo-Account": "buyer-maya", "X-Role": "engineer" },
  );
  assert.equal(customer.status, 401);
  assert.equal(
    (await request("/login", { role: "engineer", key: "buyer-maya" }, false))
      .status,
    401,
  );
  assert.equal(
    (
      await request(
        `/proposals/${p.id}/approve`,
        { revision: p.candidate_revision, revisionNumber: 1 },
        true,
        { Origin: "http://127.0.0.1:5173" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await request(`/proposals/${p.id}/results`, { passed: true })).status,
    404,
  );
});
test("verification authorization binds the exact revision and candidate changes invalidate it", async () => {
  let p = await proposal();
  await request(`/proposals/${p.id}/submit`, {});
  p = control.store.authorizeVerification(p.id);
  assert.equal(
    p.approvals[0].reviewer,
    "Controller verification authorization",
  );
  assert.equal(p.approvals[0].revision, p.candidate_revision);
  assert.ok(p.approvals[0].created_at);
  const changed = await request(`/proposals/${p.id}/revision`, {
    kind: "unchanged",
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.current_approval, null);
  assert.equal(changed.body.revision_number, 2);
  assert.notEqual(changed.body.candidate_revision, p.candidate_revision);
  assert.ok(changed.body.approvals[0].invalidated_at);
  assert.equal((await request(`/proposals/${p.id}/verify`, {})).status, 403);
});
test("request changes and rejection prevent execution; arbitrary fixture code is not accepted", async () => {
  const p = await approve(await proposal());
  const changed = await request(`/proposals/${p.id}/changes`, {
    note: "Revisit the proposed amount.",
  });
  assert.equal(changed.body.state, "Changes requested");
  assert.equal((await request(`/proposals/${p.id}/verify`, {})).status, 403);
  const rejected = await request(`/proposals/${p.id}/reject`, {
    note: "Reject this fixture for the ticket.",
  });
  assert.equal(rejected.body.state, "Rejected");
  assert.equal((await request(`/proposals/${p.id}/verify`, {})).status, 403);
  assert.equal(
    (
      await request("/proposals", {
        ticketId: "test-complaint-001",
        kind: "uploaded-code",
        patch: "arbitrary code",
      })
    ).status,
    400,
  );
});
test("tampering with a frozen fixture invalidates approval and prevents execution", async () => {
  const p = await approve(await proposal()),
    file = path.join(control.store.fixtures.fixed.root, "server/index.ts"),
    original = readFileSync(file);
  try {
    writeFileSync(
      file,
      Buffer.concat([original, Buffer.from("\n// unreviewed test edit\n")]),
    );
    assert.equal((await request(`/proposals/${p.id}/verify`, {})).status, 409);
    assert.equal(control.store.proposal(p.id).current_approval, null);
  } finally {
    writeFileSync(file, original);
  }
});
test("occupied marketplace port blocks verification without touching the listener", async () => {
  const p = await approve(await proposal());
  let listener: Server | undefined;
  if (await portAvailable(3001)) {
    listener = (await import("node:http")).createServer((_req, res) =>
      res.end("port occupancy test"),
    );
    await new Promise<void>((resolve) =>
      listener!.listen(3001, "127.0.0.1", resolve),
    );
  }
  try {
    const result = await request(`/proposals/${p.id}/verify`, {});
    assert.equal(result.status, 409);
    assert.equal(result.body.error, occupiedMessage);
    assert.equal(
      control.store.proposal(p.id).state,
      "Authorized for verification",
    );
    assert.equal(await portAvailable(3001), false);
  } finally {
    if (listener)
      await new Promise<void>((resolve) => listener!.close(() => resolve()));
  }
});
test("missing, duplicate, skipped, timed-out, empty, failed-process and stale evidence cannot verify", () => {
  const identity = { runId: "run", revision: "candidate", harness: "harness" };
  const good: any = {
    ...identity,
    status: "passed",
    errors: [],
    tests: discountRequirements.map((r) => ({
      id: r.id,
      status: "passed",
      expectedStatus: "passed",
      retry: 0,
      errors: [],
      observation: { id: r.id, expected: r.expected, observed: r.expected },
    })),
  };
  assert.equal(assessRequired(good, 0, identity).status, "passed");
  for (const report of [
    null,
    { ...good, tests: [] },
    { ...good, revision: "old" },
    { ...good, tests: good.tests.slice(1) },
    { ...good, tests: [...good.tests, good.tests[0]] },
    {
      ...good,
      tests: good.tests.map((t: any, i: number) =>
        i === 0 ? { ...t, status: "skipped" } : t,
      ),
    },
    {
      ...good,
      tests: good.tests.map((t: any, i: number) =>
        i === 0 ? { ...t, status: "timedOut" } : t,
      ),
    },
    {
      ...good,
      tests: good.tests.map((t: any, i: number) =>
        i === 0 ? { ...t, observation: null } : t,
      ),
    },
  ])
    assert.notEqual(assessRequired(report, 0, identity).status, "passed");
  assert.notEqual(assessRequired(good, 1, identity).status, "passed");
  assert.notEqual(assessRequired(good, null, identity).status, "passed");
  const p: any = {
      current_approval: "a",
      revision_number: 2,
      candidate_revision: "candidate",
      base_revision: "base",
      harness_hash: "harness",
      requirements_hash: "requirements",
    },
    approval: any = {
      id: "a",
      revision: "candidate",
      base_revision: "base",
      revision_number: 2,
      harness_hash: "harness",
      requirements_hash: "requirements",
    },
    run: any = {
      id: "run",
      approval_id: "a",
      revision_number: 2,
      candidate_revision: "candidate",
      base_revision: "base",
      harness_hash: "harness",
      requirements_hash: "requirements",
    };
  const baseline = {
    ...good,
    revision: "base",
    status: "failed",
    tests: good.tests.map((t: any, i: number) =>
      i === 0
        ? {
            ...t,
            status: "failed",
            observation: {
              ...t.observation,
              observed: { ...t.observation.observed, payment: 4800 },
            },
          }
        : t,
    ),
  };
  const known = (revision: string) => ({
    typecheck: { exitCode: 0 },
    build: { exitCode: 0 },
    known: {
      exitCode: 1,
      report: {
        ...identity,
        revision,
        errors: [],
        tests: ["K01", "K02"].map((id) => ({
          id,
          status: "failed",
          expectedStatus: "passed",
          retry: 0,
          errors: ["expect(received).toBe(expected) failed"],
        })),
      },
    },
  });
  const evidence = {
    integrityVerified: true,
    baseline: { ...known("base"), required: { report: baseline, exitCode: 1 } },
    candidate: {
      ...known("candidate"),
      required: { report: good, exitCode: 0 },
    },
  };
  assert.equal(
    finalDecision(p, approval, run, evidence),
    "Verified awaiting engineer review",
  );
  assert.equal(
    finalDecision({ ...p, revision_number: 3 }, approval, run, evidence),
    "Inconclusive",
  );
  assert.equal(
    finalDecision(p, { ...approval, invalidated_at: "later" }, run, evidence),
    "Inconclusive",
  );
  assert.equal(
    finalDecision(p, approval, run, { ...evidence, candidate: null }),
    "Inconclusive",
  );
  assert.equal(
    finalDecision(p, approval, run, { ...evidence, integrityVerified: false }),
    "Inconclusive",
  );
});
test(
  "approved unchanged candidate fails real discount checks",
  { timeout: 480000 },
  async () => {
    assert.equal(await portAvailable(3001), true, occupiedMessage);
    const p = await approve(await proposal("unchanged"));
    const started = await request(`/proposals/${p.id}/verify`, {});
    assert.equal(started.status, 202);
    const finished = await waitForRun(p.id);
    assert.equal(finished.state, "Failed", finished.runs[0]?.message);
    const run = finished.runs[0],
      e = run.evidence;
    assert.equal(e.baseline.required.assessment.status, "failed");
    assert.equal(e.candidate.required.assessment.status, "failed");
    assert.equal(
      e.candidate.required.assessment.checks.find((c: any) => c.id === "D01")
        .observed.storedPayment,
      4800,
    );
    summary.outcomes.push({
      fixture: "Unchanged negative control",
      proposalId: p.id,
      runId: run.id,
      state: finished.state,
      baseRevision: p.base_revision,
      candidateRevision: p.candidate_revision,
      required: e.candidate.required.assessment.checks.map((c: any) => ({
        id: c.id,
        status: c.status,
        expected: c.expected,
        observed: c.observed,
      })),
      evidenceDirectory: path.relative(
        projectRoot,
        path.join(control.store.dataDir, "runs", run.id),
      ),
    });
  },
);
test(
  "approved developer-authored fix passes required checks; other scenarios stay unresolved",
  { timeout: 480000 },
  async () => {
    assert.equal(await portAvailable(3001), true, occupiedMessage);
    const p = await approve(await proposal("discount-fix"));
    assert.equal((await request(`/proposals/${p.id}/verify`, {})).status, 202);
    const finished = await waitForRun(p.id);
    assert.equal(
      finished.state,
      "Verified awaiting engineer review",
      JSON.stringify(finished.runs[0]?.evidence?.candidate?.required),
    );
    const run = finished.runs[0],
      e = run.evidence;
    assert.equal(e.candidate.required.exitCode, 0);
    assert.equal(e.candidate.required.assessment.checks.length, 8);
    assert.ok(
      e.candidate.required.assessment.checks.every(
        (c: any) => c.status === "passed",
      ),
    );
    assert.equal(
      e.candidate.required.assessment.checks.find((c: any) => c.id === "D01")
        .observed.storedPayment,
      3840,
    );
    assert.equal(run.candidate_revision, p.candidate_revision);
    assert.equal(e.baseline.required.assessment.status, "failed");
    for (const env of ["baseline", "candidate"]) {
      assert.equal(e[env].known.exitCode, 1);
      assert.deepEqual(
        e[env].known.report.tests.map((t: any) => [t.id, t.status]),
        [
          ["K01", "failed"],
          ["K02", "failed"],
        ],
      );
    }
    summary.outcomes.push({
      fixture: "Developer-authored discount fix",
      proposalId: p.id,
      runId: run.id,
      state: finished.state,
      baseRevision: p.base_revision,
      candidateRevision: p.candidate_revision,
      required: e.candidate.required.assessment.checks.map((c: any) => ({
        id: c.id,
        status: c.status,
        expected: c.expected,
        observed: c.observed,
      })),
      knownUnresolved: e.candidate.known.report.tests.map((t: any) => ({
        id: t.id,
        status: t.status,
      })),
      evidenceDirectory: path.relative(
        projectRoot,
        path.join(control.store.dataDir, "runs", run.id),
      ),
    });
  },
);
test("original marketplace source and all three intentional defects remain unchanged", () => {
  const saved = JSON.parse(
    readFileSync(
      path.join(controlRoot, "fixtures/original-source.json"),
      "utf8",
    ),
  );
  for (const [file, digest] of Object.entries(saved))
    assert.equal(
      hash(readFileSync(path.join(projectRoot, file))),
      digest,
      `Original changed: ${file}`,
    );
  assert.equal(
    revision(control.store.fixtures.base.root),
    control.store.fixtures.base.revision,
  );
  assert.notEqual(
    control.store.fixtures.base.revision,
    control.store.fixtures.fixed.revision,
  );
  const sourceFilesList = sourceFiles(control.store.fixtures.fixed.root);
  assert.ok(
    sourceFilesList.every(
      (file) =>
        !file.startsWith("control/") &&
        !file.startsWith("operator/") &&
        !file.startsWith("verification/") &&
        !file.includes("private/"),
    ),
  );
  assert.equal(
    existsSync(path.join(control.store.fixtures.fixed.root, "data/local")),
    false,
  );
  assert.equal(hash(readFileSync(source)), sourceBefore);
  summary.originalMarketplaceUnchanged = true;
});
