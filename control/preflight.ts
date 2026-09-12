import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  initializeFixtures,
  assertFixtures,
  copySnapshot,
  revision,
} from "./snapshots";
import { defaultData, projectRoot, controlRoot } from "./paths";
const fixtures = initializeFixtures(defaultData);
assertFixtures(fixtures);
const base = path.join(controlRoot, "data/build-preflight", randomUUID());
for (const [name, fixture] of [
  ["baseline", fixtures.base],
  ["candidate", fixtures.fixed],
] as const) {
  const root = path.join(base, name);
  copySnapshot(fixture.root, root);
  mkdirSync(root, { recursive: true });
  for (const [label, args] of [
    [
      "typecheck",
      [path.join(projectRoot, "node_modules/typescript/bin/tsc"), "--noEmit"],
    ],
    [
      "build",
      [path.join(projectRoot, "node_modules/vite/bin/vite.js"), "build"],
    ],
  ] as const) {
    const result = spawnSync(process.execPath, [...args], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 120000,
    });
    writeFileSync(
      path.join(base, `${name}-${label}.log`),
      (result.stdout ?? "") + (result.stderr ?? ""),
    );
    console.log(`${name} ${label}: exit ${result.status}`);
    if (result.status !== 0) {
      console.error(result.stdout, result.stderr);
      process.exit(1);
    }
  }
  if (revision(root) !== fixture.revision)
    throw new Error("Source changed during build");
  console.log(`${name} source SHA-256: ${fixture.revision}`);
}
console.log(
  "Both isolated fixture builds passed. No marketplace server was started or stopped.",
);
