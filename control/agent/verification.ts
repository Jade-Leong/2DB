import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { IsolatedApp, docker, hardening } from "./docker";
import { cleanCopy } from "./policy";
import { revision } from "../snapshots";
import { now, projectRoot } from "../paths";
import { assessRequired } from "../evidence";
import type { Store } from "../store";

export async function isolatedEnvironment(
  store: Store,
  image: string,
  run: any,
  label: string,
  source: string,
  expectedRevision: string,
) {
  const root = path.join(store.dataDir, "workspaces", run.id, label),
    evidenceRoot = path.join(store.dataDir, "runs", run.id, label);
  cleanCopy(source, root);
  mkdirSync(evidenceRoot, { recursive: true });
  if (revision(root) !== expectedRevision)
    throw new Error("Approved source identity mismatch");
  const trusted = path.join(store.dataDir, "isolated-harness", run.id, label);
  mkdirSync(path.join(trusted, "control"), { recursive: true });
  cpSync(
    path.join(projectRoot, "verification"),
    path.join(trusted, "verification"),
    { recursive: true },
  );
  for (const file of ["playwright.config.ts", "paths.ts", "reporter.ts"])
    cpSync(
      path.join(projectRoot, "control", file),
      path.join(trusted, "control", file),
    );
  cpSync(
    path.join(projectRoot, "package.json"),
    path.join(trusted, "package.json"),
  );
  mkdirSync(path.join(trusted, "seed/server"), { recursive: true });
  // Trusted reset code is supplied independently, never from the candidate.
  const originalDb = readFileSync(
    path.join(projectRoot, "server/db.ts"),
    "utf8",
  );
  const anchor =
    'export const root = fileURLToPath(new URL("../", import.meta.url));';
  if (!originalDb.includes(anchor))
    throw new Error("Trusted seed adapter requires review");
  writeFileSync(
    path.join(trusted, "seed/server/db.ts"),
    originalDb.replace(anchor, "export const root = '/app';"),
  );
  cpSync(
    path.join(projectRoot, "server/reset.ts"),
    path.join(trusted, "seed/server/reset.ts"),
  );
  const app = new IsolatedApp(image),
    controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 720_000);
  controller.signal.addEventListener(
    "abort",
    () => {
      void app.close();
    },
    { once: true },
  );
  const result: any = {
    revision: expectedRevision,
    root: path.relative(store.dataDir, root),
    isolation: { image, network: "none", application: app.name },
    typecheck: { exitCode: null },
    build: { exitCode: null },
  };
  try {
    const startedAt = now();
    try {
      await app.start(root, controller.signal, (out) =>
        writeFileSync(path.join(evidenceRoot, "build.log"), out, { flag: "a" }),
      );
      result.started = true;
    } catch {
      result.build.error = "Isolated typecheck/build/start failed.";
    }
    for (const step of ["typecheck", "build"]) {
      const execution = app.processes.find((p) => p.step === step);
      if (execution) {
        const { output, ...record } = execution;
        result[step] = record;
        writeFileSync(path.join(evidenceRoot, step + ".log"), output);
      }
    }
    for (const project of ["required", "known-unresolved"]) {
      const dir = path.join(evidenceRoot, project);
      mkdirSync(dir, { recursive: true });
      let report = null,
        exitCode: number | null = null;
      const startedAt = now(),
        name = "twodb-verifier-" + randomUUID();
      if (result.started && result.build.exitCode === 0) {
        try {
          const execution = await docker(
            [
              "run",
              ...hardening(name, "container:" + app.name),
              "--mount",
              `type=bind,src=${trusted},dst=/trusted,readonly`,
              "--mount",
              `type=volume,src=${app.data},dst=/app/data`,
              "--mount",
              `type=bind,src=${dir},dst=/tmp/evidence`,
              "--env",
              "TWO_DB_RUN_ID=" + run.id,
              "--env",
              "TWO_DB_REVISION=" + expectedRevision,
              "--env",
              "TWO_DB_HARNESS=" + run.harness_hash,
              image,
              "node",
              "/opt/runtime/verify.mjs",
              project,
            ],
            360_000,
            controller.signal,
          );
          exitCode = execution.code;
          writeFileSync(path.join(dir, "process.log"), execution.out);
          report = JSON.parse(
            readFileSync(path.join(dir, "results.json"), "utf8"),
          );
        } catch {
        } finally {
          await docker(["rm", "-f", name]).catch(() => {});
        }
      }
      result[project === "required" ? "required" : "known"] = {
        exitCode,
        startedAt,
        finishedAt: now(),
        report,
      };
      if (project === "required")
        result.required.assessment = assessRequired(report, exitCode, {
          runId: run.id,
          revision: expectedRevision,
          harness: run.harness_hash,
        });
    }
    result.sourceUnchanged = revision(root) === expectedRevision;
    writeFileSync(
      path.join(evidenceRoot, "summary.json"),
      JSON.stringify(result, null, 2),
    );
    return result;
  } finally {
    clearTimeout(timeout);
    await app.close();
  }
}
