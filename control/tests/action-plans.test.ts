import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  actionPlan,
  executePlan,
  recordedAction,
  ModelGate,
} from "../agent/plans";
import { CandidateSession } from "../agent/candidate-session";
import { requestModelWithRetry } from "../agent/model-transport";
import type { Action } from "../agent/policy";
import { mismatch } from "../agent/policy";
import { sourceObservation } from "../agent/source-observations";
import { projectRoot } from "../paths";
const action = (name: Action["action"], target = "", value = ""): Action => ({
  action: name,
  target,
  value,
  summary: "test",
});
const batch = (items: Action[]) => action("batch", "", JSON.stringify(items));

test("source adapter returns multiple real allowlisted reads and literal searches in one turn", async () => {
  const result = await executePlan(
    batch([
      action("read", "src/main.tsx"),
      action("read", "server/index.ts"),
      action("search", "src/", "LOOP20"),
    ]),
    async (a) => sourceObservation(projectRoot, a),
  );
  assert.equal(result.completed, 3);
  assert.ok(result.observations[0].result.content.includes("LOOP20"));
  assert.ok(result.observations[1].result.content.length > 0);
  assert.ok(result.observations[2].result.matches.length > 0);
  assert.equal(
    new Set(result.observations.map((o) => o.result.revision)).size,
    1,
  );
  const refused = await executePlan(
    batch([action("read", ".env.local")]),
    async (a) => sourceObservation(projectRoot, a),
  );
  assert.ok(refused.observations[0].result.error);
});

test("candidate evidence cannot be reused as baseline reproduction", () => {
  const evidence = {
    origin: "trusted-browser",
    base: "base",
    buyer: "buyer-maya",
    screenshot: "browser.png",
    checkoutStatus: 201,
    receiptStatus: 200,
    orderId: "order",
    displayedCents: 3840,
    orderCents: 3840,
    paymentCents: 4800,
    discountCents: 960,
  };
  assert.equal(mismatch(evidence, "buyer-maya", "base"), true);
  assert.equal(
    mismatch(
      { ...evidence, environment: "candidate", testedRevision: "patch" },
      "buyer-maya",
      "base",
    ),
    false,
  );
});

test("mock discount investigation uses 8 model turns instead of 18, preserving action order and guarded decisions", async () => {
  const safeBrowser = [
    action("open", "/#/products/p1"),
    action("click", "text:Add to bag — $48.00"),
    action("open", "/#/checkout"),
    action("fill", "label:Promo code", "LOOP20"),
    action("inspect"),
  ];
  const checkout = action("click", "text:Place order");
  const reads = [
    action("list"),
    action("read", "server/pricing.ts"),
    action("read", "server/orders.ts"),
  ];
  const turns = [
    batch(safeBrowser),
    checkout,
    action("reproduced"),
    batch(reads),
    action("edit"),
    batch(safeBrowser),
    checkout,
    action("finish"),
  ];
  const expected = turns.flatMap(actionPlan);
  const executed: Action[] = [];
  let modelCalls = 0,
    payments = 0;
  for (const turn of turns) {
    modelCalls++;
    await executePlan(turn, async (a, safeOnly) => {
      executed.push(a);
      if (a === undefined) assert.fail();
      if (a.target === checkout.target || a.action === "edit")
        assert.equal(safeOnly, false);
      if (a.target === checkout.target) payments++;
      return { ok: true };
    });
  }
  assert.deepEqual(executed, expected);
  assert.equal(expected.length, 18);
  assert.equal(modelCalls, 8);
  assert.equal(payments, 2); // one baseline, one rebuilt candidate
});

test("safe source batches execute sequentially, and a failed step never replays the prefix", async () => {
  const calls: string[] = [];
  const result = await executePlan(
    batch([action("list"), action("read"), action("search")]),
    async (a) => {
      calls.push(a.action);
      return a.action === "read"
        ? { error: "missing file" }
        : { files: ["server/a.ts"] };
    },
  );
  assert.deepEqual(calls, ["list", "read"]);
  assert.equal(result.completed, 2);
  assert.equal(result.planned, 3);
});

test("whole batch is validated before execution; edits and unbounded/nested plans refused", async () => {
  for (const items of [
    [action("read"), action("edit")],
    [batch([action("read")])],
    Array(6).fill(action("read")),
    [],
  ]) {
    let executed = false;
    await assert.rejects(
      executePlan(batch(items), async () => {
        executed = true;
      }),
    );
    assert.equal(executed, false);
  }
});

test("persisted completed and uncertain side effects cannot be replayed", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "2db-journal-"));
  try {
    let payments = 0;
    const file = path.join(dir, "checkout.json");
    const buy = () =>
      recordedAction(file, async () => ({ payment: ++payments }));
    assert.deepEqual(await buy(), { payment: 1 });
    assert.deepEqual(await buy(), { payment: 1 });
    assert.equal(payments, 1);
    const pending = path.join(dir, "uncertain.json");
    await assert.rejects(
      recordedAction(pending, async () => {
        payments++;
        throw new Error("lost response");
      }),
    );
    await assert.rejects(
      recordedAction(pending, async () => {
        payments++;
      }),
      /replay refused/,
    );
    assert.equal(payments, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("candidate retest waits for rebuild/start/health/fresh browser and carries exact revision; failed build closes access", async () => {
  const events: string[] = [];
  let rev = "base",
    fail = false;
  const session = new CandidateSession(
    () => ({
      async close() {
        events.push("close");
      },
      async start() {
        events.push("build");
        if (fail) throw new Error("build failed");
        events.push("start", "health");
      },
      async browserAction(a: any) {
        events.push(a.action);
        return { ok: true };
      },
    }),
    () => rev,
  );
  const signal = new AbortController().signal;
  await session.start("baseline", "baseline", "buyer-maya", signal, () => {});
  rev = "patch-sha256";
  events.length = 0;
  await session.start("candidate", "candidate", "buyer-maya", signal, () => {});
  await session.browserAction(action("inspect"));
  assert.deepEqual(events, [
    "close",
    "build",
    "start",
    "health",
    "init",
    "inspect",
  ]);
  assert.deepEqual(session.provenance(), {
    environment: "candidate",
    testedRevision: "patch-sha256",
  });
  fail = true;
  await assert.rejects(
    session.start("candidate", "candidate", "buyer-maya", signal, () => {}),
  );
  await assert.rejects(
    session.browserAction(action("inspect")),
    /retest refused/,
  );
  assert.equal(session.testedRevision, "");
});

test("model gate rejects concurrency and paces successive requests", async () => {
  const gate = new ModelGate(30),
    signal = new AbortController().signal;
  let release!: () => void;
  const first = gate.run(
    signal,
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  await assert.rejects(
    gate.run(signal, async () => {}),
    /Concurrent/,
  );
  release();
  await first;
  const start = Date.now();
  await gate.run(signal, async () => {});
  assert.ok(Date.now() - start >= 20);
});

test("two real broker 429 retries do not replay a completed checkout", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "2db-retry-"));
  try {
    let payments = 0,
      requests = 0,
      retries = 0;
    const buy = () =>
      recordedAction(path.join(dir, "decision-1.json"), async () => ({
        payment: ++payments,
      }));
    await executePlan(action("click", "text:Place order"), async () => buy());
    await requestModelWithRetry(
      async () => {
        requests++;
        if (requests < 3)
          return Response.json(
            { error: { code: "rate_limit_exceeded" } },
            { status: 429 },
          );
        return new Response(
          'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
          { headers: { "content-type": "text/event-stream" } },
        );
      },
      "next-model-turn",
      () => {},
      new AbortController().signal,
      () => {
        retries++;
      },
      async () => {},
      () => 0,
    );
    assert.equal(requests, 3);
    assert.equal(retries, 2);
    assert.equal(payments, 1);
    await buy(); // recovering the same persisted decision also does not execute it
    assert.equal(payments, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
