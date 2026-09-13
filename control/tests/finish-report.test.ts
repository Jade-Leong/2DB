import test from "node:test";
import assert from "node:assert/strict";
import { conclusion, finishDetails } from "../agent/policy";
import { projectRoot } from "../paths";

test("partial finish reports preserve supplied findings and explicitly mark omissions", () => {
  const report = conclusion(
    finishDetails('{"likelyCause":"Payment uses the pre-discount amount."}'),
    projectRoot,
    ["server/index.ts"],
  );
  assert.equal(report.likelyCause, "Payment uses the pre-discount amount.");
  assert.deepEqual(report.sourceReferences, ["server/index.ts"]);
  assert.match(report.uncertainties, /not been assessed/);
  assert.match(report.suggestedVerification, /Agent 2/);
  assert.deepEqual(report.missingFields, [
    "uncertainties",
    "suggestedVerification",
    "sourceReferences",
  ]);
});

test("empty or malformed finish details can reach review without invented findings", () => {
  for (const value of ["", "A prose explanation", "null", "[]", "{}"]) {
    const report = conclusion(finishDetails(value), projectRoot, [
      "server/index.ts",
    ]);
    assert.match(report.likelyCause, /Not provided/);
    assert.equal(report.missingFields.length, 4);
  }
});

test("partial reports do not relax source boundaries or accept oversized claims", () => {
  for (const sourceReferences of [
    ["../package.json"],
    ["control/private/engineer-key.json"],
    ["server/missing.ts"],
    "server/index.ts",
  ])
    assert.throws(() =>
      conclusion({ sourceReferences }, projectRoot, ["server/index.ts"]),
    );
  assert.throws(() => conclusion({}, projectRoot));
  assert.throws(() =>
    conclusion({ likelyCause: "x".repeat(4001) }, projectRoot, [
      "server/index.ts",
    ]),
  );
});
