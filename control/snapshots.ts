import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  lstatSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";
import { projectRoot, problem } from "./paths";

const directories = ["src", "server", "public"];
const files = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "index.html",
  ".gitignore",
  "README.md",
];
export const hash = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
function visit(root: string, relative: string, result: string[]) {
  const absolute = path.join(root, relative),
    info = lstatSync(absolute);
  if (info.isSymbolicLink())
    problem("Source snapshots cannot contain symbolic links.");
  if (info.isDirectory()) {
    for (const name of readdirSync(absolute).sort())
      visit(root, path.posix.join(relative, name), result);
  } else result.push(relative);
}
export function sourceFiles(root: string) {
  const list: string[] = [];
  for (const dir of directories) visit(root, dir, list);
  for (const name of files)
    if (existsSync(path.join(root, name))) list.push(name);
  return list.sort();
}
export function revision(root: string) {
  return hash(
    JSON.stringify(
      sourceFiles(root).map((file) => [
        file,
        hash(readFileSync(path.join(root, file))),
      ]),
    ),
  );
}
export function copySnapshot(
  source: string,
  destination: string,
  original = false,
) {
  mkdirSync(destination, { recursive: true });
  const list = sourceFiles(source).filter((f) => f !== "README.md");
  for (const file of list) {
    const dest = path.join(destination, file);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(source, file), dest);
  }
  copyFileSync(
    path.join(source, original ? "INVESTIGATOR_SETUP.md" : "README.md"),
    path.join(destination, "README.md"),
  );
}
export type FixtureKind = "unchanged" | "discount-fix";
export type Fixtures = {
  base: { root: string; revision: string };
  fixed: { root: string; revision: string };
  diff: string;
};
export function initializeFixtures(dataDir: string): Fixtures {
  const manifest = path.join(dataDir, "fixtures.json");
  if (existsSync(manifest)) return JSON.parse(readFileSync(manifest, "utf8"));
  const dir = path.join(dataDir, "snapshots", randomUUID()),
    base = path.join(dir, "baseline"),
    fixed = path.join(dir, "discount-fix");
  copySnapshot(projectRoot, base, true);
  copySnapshot(base, fixed);
  const file = path.join(fixed, "server/index.ts"),
    before = readFileSync(file, "utf8");
  const match =
    /((?:db\.prepare\("INSERT INTO payments VALUES \(\?,\?,\?,\?,\?\)"\)\.run\(\s*randomUUID\(\),\s*id,\s*))q\.subtotal_cents/;
  const matches = before.match(match);
  if (!matches)
    problem(
      "The reviewed discount fixture no longer matches this baseline. No source was changed.",
    );
  const after = before.replace(match, "$1q.total_cents");
  writeFileSync(file, after);
  const lines = before.split("\n"),
    index = lines.findIndex(
      (line, i) =>
        line.includes("q.subtotal_cents") &&
        lines
          .slice(Math.max(0, i - 4), i)
          .join("\n")
          .includes("INSERT INTO payments"),
    );
  const contextBefore = lines
      .slice(index - 3, index)
      .map((l) => " " + l)
      .join("\n"),
    contextAfter = lines
      .slice(index + 1, index + 4)
      .map((l) => " " + l)
      .join("\n");
  const diff = `--- a/server/index.ts\n+++ b/server/index.ts\n@@ -${index - 2},7 +${index - 2},7 @@\n${contextBefore}\n-${lines[index]}\n+${lines[index].replace("q.subtotal_cents", "q.total_cents")}\n${contextAfter}\n`;
  const result = {
    base: { root: base, revision: revision(base) },
    fixed: { root: fixed, revision: revision(fixed) },
    diff,
  };
  writeFileSync(manifest, JSON.stringify(result, null, 2));
  return result;
}
export function selectedFixture(fixtures: Fixtures, kind: FixtureKind) {
  if (kind === "unchanged") return fixtures.base;
  if (kind === "discount-fix") return fixtures.fixed;
  return problem(
    "Only the reviewed unchanged and discount-fix fixtures are available.",
  );
}
export function assertFixtures(fixtures: Fixtures) {
  for (const f of [fixtures.base, fixtures.fixed])
    if (revision(f.root) !== f.revision)
      problem(
        "Fixture content changed. Approval is invalid; unreviewed code cannot execute.",
        409,
      );
}
export function harnessRevision() {
  const entries: string[] = [];
  visit(projectRoot, "verification", entries);
  for (const p of [
    "control/playwright.config.ts",
    "control/reporter.ts",
    "control/evidence.ts",
    "control/runner.ts",
  ])
    entries.push(p);
  visit(projectRoot, "control/agent", entries);
  return hash(
    JSON.stringify(
      entries
        .sort()
        .map((p) => [p, hash(readFileSync(path.join(projectRoot, p)))]),
    ),
  );
}
