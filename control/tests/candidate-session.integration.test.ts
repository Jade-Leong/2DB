import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { CandidateSession } from "../agent/candidate-session";
import { IsolatedApp, probeIsolation } from "../agent/docker";
import { cleanCopy } from "../agent/policy";
import { revision } from "../snapshots";
import { projectRoot } from "../paths";
import { executePlan } from "../agent/plans";

test(
  "real Docker candidate rebuild serves edited bytes in a new browser with exact revision",
  { skip: process.env.TWO_DB_LOCAL_CONTAINER_TEST !== "1", timeout: 180_000 },
  async (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "2db-candidate-test-"));
    const candidate = path.join(root, "candidate");
    const isolation = await probeIsolation();
    assert.equal(isolation.ready, true);
    class ObservedApp extends IsolatedApp {
      async browserAction(a: any) {
        t.diagnostic(`Browser ${a.action} started`);
        const pending = super.browserAction(a);
        const result = await pending;
        t.diagnostic(`Browser ${a.action} finished: ${result.ok}`);
        return result;
      }
    }
    const session = new CandidateSession(
      () => new ObservedApp(isolation.image!),
      revision,
    );
    try {
      cleanCopy(projectRoot, candidate, true);
      const signal = AbortSignal.timeout(170_000);
      const initial = await session.start(
        candidate,
        "baseline",
        "buyer-maya",
        signal,
        () => {},
      );
      assert.equal(initial.ok, true);
      const product = initial.elements.find((e: any) =>
        e.href?.includes("#/products/"),
      );
      assert.ok(product);
      const detail = await session.browserAction({
        action: "open",
        target: "/" + product.href,
        safeOnly: true,
      });
      const add = detail.elements.find((e: any) =>
        e.text?.startsWith("Add to bag"),
      );
      assert.ok(add);
      const steps = [
        {
          action: "click",
          target: add.selector,
          value: "",
          summary: "Add item",
        },
        {
          action: "open",
          target: "/#/checkout",
          value: "",
          summary: "Open checkout",
        },
        {
          action: "fill",
          target: "label:Discount code",
          value: "LOOP20",
          summary: "Apply code",
        },
        { action: "inspect", target: "", value: "", summary: "Inspect total" },
      ];
      const batched = await executePlan(
        {
          action: "batch",
          target: "",
          value: JSON.stringify(steps),
          summary: "Safe checkout preparation",
        },
        async (a, safeOnly) => session.browserAction({ ...a, safeOnly }),
      );
      assert.equal(batched.completed, 4);
      assert.ok(
        batched.observations.every((o) => o.result.ok),
        JSON.stringify(
          batched.observations.map((o) => ({
            action: o.action,
            ok: o.result.ok,
            error: o.result.error,
          })),
        ),
      );
      const guarded = await session.browserAction({
        action: "click",
        target: "text:Place simulated order",
        safeOnly: true,
      });
      assert.equal(guarded.ok, false);
      const purchased = await session.browserAction({
        action: "click",
        target: "text:Place simulated order",
        safeOnly: false,
      });
      assert.equal(purchased.ok, true);
      assert.equal(purchased.receipt.checkoutStatus, 201);
      const oldName = session.app.name,
        oldBrowser = session.app.browserName,
        baseRevision = session.testedRevision;
      const source = path.join(candidate, "src", "main.tsx");
      const original = readFileSync(source, "utf8");
      assert.ok(original.includes("<main"));
      writeFileSync(
        source,
        original.replace(
          /(<main[^>]*>)/,
          "$1<div>Candidate revision probe 2DB</div>",
        ),
      );
      const expected = revision(candidate);
      assert.notEqual(expected, baseRevision);
      await assert.rejects(
        session.browserAction({ action: "inspect" }),
        /rebuild required/,
      );
      const observed = await session.start(
        candidate,
        "candidate",
        "buyer-maya",
        signal,
        () => {},
      );
      assert.equal(observed.ok, true);
      assert.match(observed.text, /Candidate revision probe 2DB/);
      assert.notEqual(session.app.name, oldName);
      assert.notEqual(session.app.browserName, oldBrowser);
      assert.deepEqual(
        session.app.processes.map((p) => [p.step, p.exitCode]),
        [
          ["typecheck", 0],
          ["build", 0],
        ],
      );
      assert.deepEqual(session.provenance(), {
        environment: "candidate",
        testedRevision: expected,
      });
      const retest = await session.browserAction({
        action: "inspect",
        safeOnly: true,
      });
      assert.match(retest.text, /Candidate revision probe 2DB/);
    } finally {
      await session.app.close();
      const absolute = path.resolve(root);
      assert.ok(
        absolute.startsWith(path.resolve(os.tmpdir()) + path.sep) &&
          path.basename(absolute).startsWith("2db-candidate-test-"),
      );
      rmSync(absolute, { recursive: true, force: true });
    }
  },
);
