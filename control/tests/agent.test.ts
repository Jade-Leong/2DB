import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createControl } from "../app";
import { controlRoot, projectRoot } from "../paths";
import { hash, revision } from "../snapshots";
import { sdkAvailable } from "../agent/service";
import {
  firstComplaint,
  mismatch,
  safeFile,
  cleanCopy,
  editSource,
  readSource,
  actualDiff,
  investigationPrompt,
  parseAction,
} from "../agent/policy";
import { hardening, dockerEnv } from "../agent/docker";
import { ResearchSession, checkTavily } from "../agent/tavily";
const syntheticDocsFetch = (async () =>
  Response.json({
    request_id: "synthetic-ui-check",
    usage: { credits: 1 },
    results: [
      {
        url: "https://expressjs.com/en/guide/error-handling.html",
        title: "Synthetic documentation <img src=x onerror=alert(1)>",
        content: "Express 5 handles rejected promises automatically.",
        raw_content: "Express 5 handles rejected promises automatically.",
      },
    ],
  })) as typeof fetch;

const root = path.join(controlRoot, "data/agent-tests", randomUUID());
mkdirSync(root, { recursive: true });
const source = path.join(root, "tickets.sqlite"),
  db = new DatabaseSync(source);
db.exec(
  "CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT,role TEXT); CREATE TABLE support_tickets(id TEXT PRIMARY KEY,account_id TEXT,subject TEXT,message TEXT,created_at TEXT);",
);
db.prepare("INSERT INTO accounts VALUES(?,?,?)").run(
  "buyer-maya",
  "Maya Chen",
  "buyer",
);
db.prepare("INSERT INTO support_tickets VALUES(?,?,?,?,?)").run(
  "complaint",
  "buyer-maya",
  "Discount complaint",
  firstComplaint,
  "2026-09-12T12:00:00Z",
);
db.close();
const sourceHash = hash(readFileSync(source));
const manualDb = path.join(projectRoot, "data/local/market.sqlite");
const manualHash = existsSync(manualDb) ? hash(readFileSync(manualDb)) : null;
const blocked: any = {
  state: "Setup required",
  sdk: { ready: true, message: "Installed" },
  authentication: {
    ready: false,
    message: "Set TWO_DB_OPENAI_API_KEY privately.",
  },
  model: "",
  browser: { ready: false, message: "Docker Linux engine missing" },
  isolation: {
    ready: false,
    browser: false,
    message: "Docker Linux engine missing",
  },
};
const c = createControl({
  dataDir: path.join(root, "control"),
  privateDir: path.join(root, "private"),
  ticketSource: source,
  agentStatus: async () => blocked,
  researchCheck: () => checkTavily(syntheticDocsFetch),
});
const server = c.app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const url = "http://127.0.0.1:" + (server.address() as any).port;
const login = await fetch(url + "/engineer-api/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(JSON.parse(readFileSync(c.keyFile, "utf8"))),
});
const { token } = (await login.json()) as any;
const request = async (route: string, body?: any, authenticated = true) => {
  const response = await fetch(url + "/engineer-api" + route, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated
        ? { Authorization: "Bearer " + token }
        : { "X-Demo-Account": "buyer-maya" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as any };
};
test.after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  c.store.close();
});
test("installed official ESM-only SDK is detected without invoking a model", async () => {
  assert.equal(await sdkAvailable(), true);
});

test("customer headers cannot start, view, cancel, or approve investigations", async () => {
  for (const [route, body] of [
    ["/tickets/complaint/investigate", {}],
    ["/tickets/complaint/scripted-demo", { kind: "discount-fix" }],
    ["/investigations", undefined],
    ["/research/status", undefined],
    ["/research/check", {}],
    ["/investigations/missing/cancel", {}],
    ["/proposals/missing/approve", { revision: "fake", role: "engineer" }],
    ["/proposals/missing/verify-live", {}],
  ] as const)
    assert.equal((await request(route, body, false)).status, 401);
});
test("missing worker authentication and isolation produce setup required without SDK or app execution", async () => {
  const status = await request("/agent/status");
  assert.equal(status.body.state, "Setup required");
  const run = await request("/tickets/complaint/investigate", {});
  assert.equal(run.status, 202);
  assert.equal(run.body.state, "Setup required");
  assert.equal(run.body.thread_id, null);
  assert.deepEqual(run.body.evidence, []);
  assert.equal(c.store.list().length, 0);
  assert.equal(hash(readFileSync(source)), sourceHash);
});
test("missing isolation blocks even when authentication is ready", async () => {
  c.agent.statusCheck = async () => ({
    ...blocked,
    authentication: { ready: true, message: "Explicit test authentication" },
  });
  const r = await request("/tickets/complaint/investigate", {});
  assert.equal(r.body.state, "Setup required");
  assert.equal(r.body.thread_id, null);
  c.agent.statusCheck = async () => blocked;
});
test("duplicate starts are bounded and cancellation during setup is persisted", async () => {
  let resolve!: (x: any) => void;
  c.agent.statusCheck = () =>
    new Promise((r) => {
      resolve = r;
    });
  const pending = c.agent.start("complaint");
  await assert.rejects(c.agent.start("complaint"), /already active/);
  c.agent.cancel(c.agent.activeId!);
  resolve(blocked);
  assert.equal((await pending).state, "Cancelled");
  c.agent.statusCheck = async () => blocked;
});
test("clean handoff omits controller, verification, operator notes, history and credentials", () => {
  const workspace = path.join(root, "handoff");
  cleanCopy(projectRoot, workspace, true);
  for (const p of [
    "../control/private/engineer-key.json",
    "control/app.ts",
    "operator/BUGS.md",
    "verification/control-discount.spec.ts",
    ".git/config",
    "C:/Users/jadey/.codex/auth.json",
    "src/../../control/store.ts",
    "src/main.tsx:stream",
  ])
    assert.throws(() => safeFile(workspace, p));
  assert.equal(
    readSource(workspace, "README.md"),
    readFileSync(path.join(projectRoot, "INVESTIGATOR_SETUP.md"), "utf8"),
  );
  assert.throws(() => editSource(workspace, "package.json", "{}", true));
  assert.throws(
    () => editSource(workspace, "server/index.ts", "", false),
    /evidence/,
  );
  const original = readSource(workspace, "src/style.css");
  editSource(workspace, "src/style.css", original + "\n", true);
  assert.match(actualDiff(workspace, workspace).diff, /^$/);
});
test("traversal, symlinks and unsupported structured actions are refused", () => {
  const linkRoot = path.join(root, "links");
  mkdirSync(linkRoot);
  symlinkSync(
    path.join(root, "handoff/src"),
    path.join(linkRoot, "src"),
    "junction",
  );
  assert.throws(() => safeFile(linkRoot, "src/main.tsx"));
  assert.throws(() =>
    parseAction({ action: "shell", target: "whoami", value: "", summary: "" }),
  );
  const prompt = investigationPrompt({
    complaint: firstComplaint,
    customer_id: "buyer-maya",
    customer_name: "Maya",
    customer_role: "buyer",
  });
  assert.ok(prompt.includes(firstComplaint));
  assert.ok(!prompt.includes("q.subtotal_cents"));
  assert.ok(!prompt.includes("operator/BUGS"));
});
test("a model claim or incomplete browser observation cannot establish reproduction", () => {
  assert.equal(mismatch({ reproduced: true }, "buyer-maya", "base"), false);
  const evidence = {
    origin: "trusted-browser",
    base: "base",
    buyer: "buyer-maya",
    screenshot: "browser-1.png",
    checkoutStatus: 201,
    receiptStatus: 200,
    orderId: "test-order",
    displayedCents: 3840,
    orderCents: 3840,
    paymentCents: 4800,
    discountCents: 960,
  };
  assert.equal(mismatch(evidence, "buyer-maya", "base"), true);
  for (const change of [
    { screenshot: null },
    { origin: "model" },
    { paymentCents: 3840 },
    { buyer: "buyer-jamie" },
    { base: "other" },
    { receiptStatus: 404 },
  ])
    assert.equal(
      mismatch({ ...evidence, ...change }, "buyer-maya", "base"),
      false,
    );
});
test("deterministic synthetic agent proposal requires exact verification authorization; changed bytes invalidate it", async () => {
  const id = randomUUID(),
    dir = path.join(c.store.dataDir, "investigations", id),
    base = path.join(dir, "baseline"),
    candidate = path.join(dir, "candidate"),
    evidenceDir = path.join(dir, "evidence");
  cleanCopy(projectRoot, base, true);
  cleanCopy(base, candidate);
  mkdirSync(evidenceDir);
  c.store.db
    .prepare(
      "INSERT INTO investigations(id,ticket_id,state,thread_id,started_at,base_revision,events,evidence,usage,message) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      "complaint",
      "Reproduction observed",
      "explicit-deterministic-test-thread",
      new Date().toISOString(),
      revision(base),
      "[]",
      "[]",
      "[]",
      "Synthetic controller test; not a live run",
    );
  assert.throws(
    () => c.agent.createProposal(id, candidate, base, "Test summary"),
    /evidence/,
  );
  const record = "browser-0.json",
    screenshot = "browser-0.png";
  const observation = {
    origin: "trusted-browser",
    base: revision(base),
    buyer: "buyer-maya",
    record,
    screenshot,
    checkoutStatus: 201,
    receiptStatus: 200,
    orderId: "synthetic-order",
    displayedCents: 3840,
    orderCents: 3840,
    paymentCents: 4800,
    discountCents: 960,
  };
  writeFileSync(path.join(evidenceDir, record), JSON.stringify(observation));
  writeFileSync(
    path.join(evidenceDir, screenshot),
    Buffer.from("89504e470d0a1a0a", "hex"),
  );
  c.store.db.prepare("UPDATE investigations SET evidence=? WHERE id=?").run(
    JSON.stringify([
      {
        ...observation,
        sha256: hash(readFileSync(path.join(evidenceDir, record))),
      },
    ]),
    id,
  );
  editSource(
    candidate,
    "src/style.css",
    readSource(candidate, "src/style.css") + "\n",
    true,
  );
  const research = new ResearchSession(syntheticDocsFetch);
  const found = await c.agent.researchAction(
    id,
    "search_docs",
    "express",
    "Express 5 promises",
    research,
    false,
    new AbortController().signal,
  );
  assert.equal(research.records.length, 1);
  const extracted = await c.agent.researchAction(
    id,
    "extract_docs",
    found.sources[0].id,
    "",
    research,
    true,
    new AbortController().signal,
  );
  assert.equal(
    c.agent
      .get(id)
      .events.filter((e: any) => e.details?.origin === "tavily-reference")
      .length,
    2,
  );
  const doc = extracted.sources[0];
  const p = c.agent.createProposal(
    id,
    candidate,
    base,
    "Synthetic authorization test, not a model discovery.",
    {
      likelyCause: "Test only",
      researchSummary:
        "Synthetic documentation used as background, not proof of the discount fix.",
      citations: [
        {
          sourceId: doc.id,
          sha256: doc.sha256,
          quote: "Express 5 handles rejected promises",
          relationship: "background",
          relevance:
            "Synthetic test; this reference does not establish the discount cause.",
        },
      ],
    },
  );
  assert.equal(p.agentMetadata.research.citations[0].id, doc.id);
  assert.equal(p.agentMetadata.research.records.length, 2);
  assert.deepEqual(p.agentMetadata.conclusion.sourceReferences, [
    "src/style.css",
  ]);
  assert.deepEqual(p.agentMetadata.conclusion.missingFields, [
    "uncertainties",
    "suggestedVerification",
    "sourceReferences",
  ]);
  assert.equal(p.author, "Agent-generated");
  assert.equal(p.state, "Ready for Agent 2");
  await assert.rejects(c.runner.start(p.id), /authorization/);
  assert.equal(
    (
      await request(
        "/proposals/" + p.id + "/approve",
        { revision: p.candidate_revision, revisionNumber: 1 },
        false,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/proposals/" + p.id + "/approve", {
        revision: p.candidate_revision,
        revisionNumber: 1,
      })
    ).status,
    409,
  );
  c.store.authorizeVerification(p.id);
  assert.throws(
    () => c.store.change(p.id, "discount-fix"),
    /cannot be replaced/,
  );
  editSource(
    candidate,
    "src/style.css",
    readSource(candidate, "src/style.css") + "\n",
    true,
  );
  assert.throws(() => c.store.approvalFor(c.store.proposal(p.id)), /changed/);
  assert.equal(c.store.proposal(p.id).current_approval, null);
});
test("OS-runner policy has no host network, privileges, secret environment, or Docker socket", () => {
  const args = hardening("twodb-test");
  assert.ok(args.includes("none"));
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("no-new-privileges"));
  assert.ok(!args.includes("--privileged"));
  assert.throws(() => hardening("twodb-test", "host"));
  const previous = process.env.TWO_DB_OPENAI_API_KEY;
  process.env.TWO_DB_OPENAI_API_KEY = "synthetic-test-secret";
  assert.equal(dockerEnv().TWO_DB_OPENAI_API_KEY, undefined);
  assert.equal(dockerEnv().TWO_DB_TAVILY_API_KEY, undefined);
  if (previous === undefined) delete process.env.TWO_DB_OPENAI_API_KEY;
  else process.env.TWO_DB_OPENAI_API_KEY = previous;
});
test("original intentional-defect source and manual customer database remain unchanged", () => {
  const expected = JSON.parse(
    readFileSync(
      path.join(controlRoot, "fixtures/original-source.json"),
      "utf8",
    ),
  );
  for (const [p, sha] of Object.entries(expected))
    assert.equal(hash(readFileSync(path.join(projectRoot, p))), sha, p);
  assert.equal(hash(readFileSync(source)), sourceHash);
  if (manualHash) assert.equal(hash(readFileSync(manualDb)), manualHash);
});
test("structured edit produces an isolated candidate diff without native patch execution", () => {
  const base = path.join(root, "structured-edit-base"),
    candidate = path.join(root, "structured-edit-candidate");
  cleanCopy(projectRoot, base);
  cleanCopy(projectRoot, candidate);
  const original = readSource(candidate, "src/style.css");
  const action = parseAction({
    action: "edit",
    target: "src/style.css",
    value: original + "\n/* isolated edit regression */\n",
    summary: "Update candidate style source.",
  });
  assert.throws(
    () => editSource(candidate, action.target, action.value, false),
    /evidence/,
  );
  editSource(candidate, action.target, action.value, true);
  assert.equal(readSource(base, "src/style.css"), original);
  assert.match(actualDiff(base, candidate).diff, /isolated edit regression/);
  assert.throws(() =>
    editSource(candidate, "control/app.ts", "not allowed", true),
  );
});
